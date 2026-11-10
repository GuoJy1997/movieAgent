import { expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openLibrary } from '../../packages/storage/src/database.ts';
import { CURRENT_SCHEMA_VERSION } from '../../packages/contracts/src/schema.ts';
import { removeLocalMediaSchema } from './local-media-migration-fixture.ts';
import { migrateCharacterVoices } from '../../packages/storage/src/migrations/0020-character-voices.ts';

it('appends schema20 immutably and upgrades real schema14 and19 libraries with backups', async () => {
  const memory = new DatabaseSync(':memory:');
  memory.exec("CREATE TABLE library(schema_version INTEGER); INSERT INTO library VALUES(19); CREATE TABLE migration_log(version INTEGER,applied_at TEXT); CREATE TABLE project(id TEXT PRIMARY KEY); INSERT INTO project VALUES('p'); PRAGMA user_version=19");
  migrateCharacterVoices(memory);
  expect(memory.prepare('PRAGMA user_version').get()?.user_version).toBe(20);
  memory.prepare("INSERT INTO character_voice_revision VALUES('v',1,'p','e','{}')").run();
  expect(() => memory.prepare("UPDATE character_voice_revision SET data_json='{}'").run()).toThrow();
  memory.close();

  for (const version of [14, 19]) {
    const root = await mkdtemp(join(tmpdir(), 'voice-migration-'));
    try {
      const initial = await openLibrary({ root }); expect(initial.ok).toBe(true); if (!initial.ok) continue;
      await initial.value.close();
      const db = new DatabaseSync(join(root, 'library.sqlite'));
      removeLocalMediaSchema(db);
      for (const table of ['dialogue_selection', 'dialogue_review', 'voice_audition', 'dialogue_production_item', 'dialogue_take', 'dialogue_production_plan', 'character_voice_media', 'shot_dialogue_current', 'shot_dialogue_revision', 'character_voice_current', 'character_voice_revision', 'finish_action', 'finish_message', 'finish_run', 'audio_publication', 'transcript_revision', 'audio_take', 'audio_batch_item', 'audio_batch', 'voice_line_revision', 'timeline_source_reference', 'timeline_assembly_receipt', 'timeline_assembly_plan', 'timeline_revision', 'timeline']) db.exec('DROP TABLE IF EXISTS ' + table);
      if (version === 14) for (const table of ['media_probe', 'media_cache', 'media_verification']) db.exec('DROP TABLE IF EXISTS ' + table);
      db.exec(`DELETE FROM migration_log WHERE version>${version}; UPDATE library SET schema_version=${version}; PRAGMA user_version=${version}`);
      db.close();
      const upgraded = await openLibrary({ root });
      expect(upgraded).toMatchObject({ ok: true, value: { schemaVersion: CURRENT_SCHEMA_VERSION } });
      if (upgraded.ok) await upgraded.value.close();
      expect((await readdir(join(root, 'backups'))).some(name => name.startsWith(`schema-${version}-`))).toBe(true);
    } finally { await rm(root, { recursive: true, force: true }); }
  }
});
