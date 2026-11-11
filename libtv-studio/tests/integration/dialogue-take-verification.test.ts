import { expect, it } from 'vitest';
import { audioFixture, audioValue, audioExecute, fixtureWav } from '../fixtures/audio-generation.ts';
import { dialogueCoordinatorFor } from '../../packages/engine/src/dialogue-coordinator.ts';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { stat, realpath } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { ok } from '../../packages/contracts/src/result.ts';

it('verifies a provider repair and preserves the original source and fixed-audio hashes', async () => {
  const s = await audioFixture('openai-speech-v1', { native: true });
  async function importVideo(color: string, name: string) {
    const path = join(s.root, name);
    expect(spawnSync(s.runtime!.ffmpegPath, ['-v', 'error', '-y', '-f', 'lavfi', '-i', `color=${color}:s=32x32:r=30:d=1`, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', path], { shell: false, windowsHide: true }).status).toBe(0);
    const info = await stat(path), grantId = crypto.randomUUID();
    audioValue(s.engine.assets.registerGrant({ grantId, importId: crypto.randomUUID(), libraryId: s.engine.identity.libraryId, expiresAt: Date.now() + 60000, files: [{ path, realPath: await realpath(path), allowedRoot: s.root, name, size: info.size, mtimeMs: info.mtimeMs, dev: info.dev, ino: info.ino }] }));
    return audioValue(await audioExecute(s.engine, 'asset.importGrantedFiles', { grantId })).versions[0];
  }
  const source = await importVideo('red', 'source.mp4'), repaired = await importVideo('blue', 'repaired.mp4'), audio = await s.importAudio(fixtureWav(1));
  const sourceMetadata = audioValue(s.engine.assets.metadata(source)), repairedMetadata = audioValue(s.engine.assets.metadata(repaired)), audioMetadata = audioValue(s.engine.assets.metadata(audio));
  expect(repairedMetadata.hash).not.toBe(sourceMetadata.hash);
  const db = new DatabaseSync(join(s.root, 'library.sqlite'));
  const repairedObjectId = db.prepare('SELECT object_id FROM asset_version WHERE asset_id=? AND version=?').get(repaired.assetId, repaired.version)!.object_id as string;
  db.prepare('INSERT INTO artifact(id,library_id,object_id,created_at) VALUES(?,?,?,?)').run('repair-artifact', s.engine.identity.libraryId, repairedObjectId, new Date().toISOString());
  const sourceProbe=audioValue(await s.engine.mediaInfo.ensure(source));
  const plan = { projectId: s.projectId, route: 'dubbed-lipsync', items: [{ dialogue: { id: 'dialogue', revision: 1, shotRef: { id: 'shot', revision: 1 }, turns: [{ voiceRef: { id: 'voice', revision: 1 } }] }, prepared: { lipSyncVideo: { ref:source,probeId:sourceProbe.probeId,hash: sourceMetadata.hash, durationTicks: 48000 }, lipSyncAudio: { ref: audio, hash: audioMetadata.hash } } }] };
  db.prepare('INSERT INTO dialogue_production_plan VALUES(?,?,?,?,?,?,?,?)').run('repair-plan', s.projectId, 'a'.repeat(64), 'human', 'run', Date.now() + 600000, 'approved', JSON.stringify(plan));
  db.prepare('INSERT INTO dialogue_production_item VALUES(?,?,?,?,NULL)').run('repair-plan', 'dialogue', 'prepared', 'sync-task');
  const generation: any = { read: () => ok({ libraryId: s.engine.identity.libraryId, taskId: 'sync-task', attemptId: 'attempt', state: 'SUCCEEDED', artifactRef: { kind: 'artifact', libraryId: s.engine.identity.libraryId, artifactId: 'repair-artifact' }, errorCode: null }) };
  const library: any = { db, root: s.root, libraryId: s.engine.identity.libraryId, checkOwnership: () => ok(undefined) };
  const coordinator = dialogueCoordinatorFor(library, generation, s.engine.assets, s.runtime);
  try {
    audioValue(await coordinator.start());
    const snapshot = audioValue(s.engine.dialogueProduction.takes({ projectId: s.projectId, shotId: 'shot' }));
    expect(snapshot.takes).toHaveLength(1);
    expect(snapshot.takes[0]).toMatchObject({ sourceVideoHash: sourceMetadata.hash, audioHash: audioMetadata.hash, video: { artifactId: 'repair-artifact' }, audio });
    const nativePlan={...plan,route:'native-reference',items:[{...plan.items[0],dialogue:{...plan.items[0]!.dialogue,id:'native-dialogue'},prepared:{config:{parameters:{duration:1}}}}]};
    db.prepare('INSERT INTO dialogue_production_plan VALUES(?,?,?,?,?,?,?,?)').run('native-plan',s.projectId,'b'.repeat(64),'human','native',Date.now()+600000,'approved',JSON.stringify(nativePlan));
    db.prepare('INSERT INTO dialogue_production_item VALUES(?,?,?,?,NULL)').run('native-plan','native-dialogue','native-prepared','native-task');
    generation.read=(taskId:string)=>ok({libraryId:s.engine.identity.libraryId,taskId,attemptId:'attempt',state:'SUCCEEDED',artifactRef:{kind:'artifact',libraryId:s.engine.identity.libraryId,artifactId:'repair-artifact'},errorCode:null});
    audioValue(await coordinator.wake());
    expect(db.prepare('SELECT diagnostic FROM dialogue_production_item WHERE plan_id=?').get('native-plan')?.diagnostic).toBe('DIALOGUE_AUDIO_MISSING');
    expect(db.prepare('SELECT COUNT(*) AS n FROM dialogue_take').get()?.n).toBe(1);
  } finally { await coordinator.close(); db.close(); }
});
