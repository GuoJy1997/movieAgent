import type { DatabaseSync } from 'node:sqlite';
export function migrateVoiceIdentity(db: DatabaseSync): void {
  if(Number(db.prepare('PRAGMA user_version').get()!.user_version)>=24)return;
  db.exec('BEGIN IMMEDIATE');
  try {
    db.exec(`CREATE TABLE character_voice_binding(project_id TEXT NOT NULL REFERENCES project(id),character_id TEXT NOT NULL,revision INTEGER NOT NULL,data_json TEXT NOT NULL,PRIMARY KEY(project_id,character_id,revision)) STRICT;`);
    // Migration enrichment keeps the exact identity/revision and never creates quality evidence.
    db.exec('DROP TRIGGER immutable_character_voice_update');
    for(const row of db.prepare('SELECT id,revision,data_json FROM character_voice_revision').all()){
      const voice=JSON.parse(row.data_json as string);if(voice.ttsBinding||!voice.ttsProfileRef)continue;
      const ref=voice.ttsProfileRef;if(ref.libraryId!==db.prepare('SELECT id FROM library').get()!.id)continue;
      const pr=db.prepare('SELECT data_json FROM profile_revision WHERE id=? AND revision=? AND library_id=?').get(ref.id,ref.revision,ref.libraryId);if(!pr)continue;const profile=JSON.parse(pr.data_json as string);
      const mr=db.prepare('SELECT data_json FROM model_revision WHERE id=? AND revision=? AND library_id=?').get(profile.modelRef.id,profile.modelRef.revision,ref.libraryId);if(!mr)continue;const model=JSON.parse(mr.data_json as string);
      if(model.capabilities.taskTypes[0]!=='text_to_speech')continue;const cr=db.prepare('SELECT 1 FROM connection_revision WHERE id=? AND revision=? AND library_id=?').get(model.connectionRef.id,model.connectionRef.revision,ref.libraryId);if(!cr)continue;
      const providerVoiceId=profile.parameters.voice??model.parameters.voice?.default;if(typeof providerVoiceId!=='string'||!providerVoiceId.trim()||providerVoiceId.length>256||/[\u0000-\u001f\u007f]/.test(providerVoiceId))continue;
      const next={...voice,sourceKind:voice.sourceKind??'sample',ttsBinding:{providerVoiceId,profileRef:ref,modelRef:profile.modelRef,connectionRef:model.connectionRef,voiceOrigin:'custom'}};
      db.prepare('UPDATE character_voice_revision SET data_json=? WHERE id=? AND revision=?').run(JSON.stringify(next),row.id as string,row.revision as number);
    }
    db.exec("CREATE TRIGGER immutable_character_voice_update BEFORE UPDATE ON character_voice_revision BEGIN SELECT RAISE(ABORT,'immutable character voice'); END;");
    const candidates=db.prepare('SELECT project_id,entity_id,MIN(id) AS id,MIN(revision) AS revision FROM character_voice_current GROUP BY project_id,entity_id HAVING COUNT(*)=1').all();
    const libraryId=db.prepare('SELECT id FROM library').get()!.id;
    for(const row of candidates){const value={libraryId,projectId:row.project_id,characterId:row.entity_id,voiceRef:{id:row.id,revision:row.revision},revision:1,updatedAt:new Date().toISOString()};db.prepare('INSERT INTO character_voice_binding VALUES(?,?,?,?)').run(row.project_id as string,row.entity_id as string,1,JSON.stringify(value));}
    db.prepare('INSERT INTO migration_log(version,applied_at) VALUES(24,?)').run(new Date().toISOString());
    db.exec('UPDATE library SET schema_version=24; PRAGMA user_version=24; COMMIT');
  }catch(error){db.exec('ROLLBACK');throw error;}
}
