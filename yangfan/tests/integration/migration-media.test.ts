import {CURRENT_SCHEMA_VERSION} from '../../packages/contracts/src/schema.ts';
import { expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, rm, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { openLibrary } from '../../packages/storage/src/database.ts';
import { removeLocalMediaSchema } from './local-media-migration-fixture.ts';
it('upgrades schema 14 without scanning or rewriting historical object facts', async () => {
  const module = await import('../../packages/storage/src/migrations/0015-media-info.ts').catch(() => null); expect(module).not.toBeNull(); if (!module) return;
  const db = new DatabaseSync(':memory:');
  try {
    db.exec("CREATE TABLE library(schema_version INTEGER); INSERT INTO library VALUES(14); CREATE TABLE migration_log(version INTEGER,applied_at TEXT); CREATE TABLE old_asset(payload TEXT); INSERT INTO old_asset VALUES('{\"mime\":\"video/mp4\"}'); PRAGMA user_version=14");
    module.migrateMediaInfo(db); expect(db.prepare('PRAGMA user_version').get()?.user_version).toBe(15); expect(db.prepare('SELECT payload FROM old_asset').get()?.payload).toBe('{"mime":"video/mp4"}');
    expect(db.prepare('SELECT count(*) n FROM media_probe').get()?.n).toBe(0); expect(db.prepare('SELECT count(*) n FROM media_cache').get()?.n).toBe(0);
    module.migrateMediaInfo(db); expect(db.prepare('SELECT count(*) n FROM migration_log').get()?.n).toBe(1);
  } finally { db.close(); }
});
it('opens and backs up a real schema14 library without scanning a missing historical object', async () => {
  const root = await mkdtemp(join(tmpdir(), 'p4-migration-'));
  try {
    const initial = await openLibrary({ root }); if (!initial.ok) throw Error('initial'); const id = initial.value.libraryId; await initial.value.close();
    const db = new DatabaseSync(join(root, 'library.sqlite'));
    db.exec('DROP TABLE IF EXISTS voice_provider_catalog; DROP TABLE IF EXISTS voice_clone_job; DROP TABLE IF EXISTS voice_qualification; DROP TABLE IF EXISTS dialogue_audio_assembly; DROP TABLE IF EXISTS character_voice_binding'); removeLocalMediaSchema(db);
    for (const table of ['audio_publication', 'transcript_revision', 'audio_take', 'audio_batch_item', 'audio_batch', 'voice_line_revision']) db.exec('DROP TABLE IF EXISTS ' + table);
    for(const table of ['dialogue_selection','dialogue_review','voice_audition','dialogue_production_item','dialogue_take','dialogue_production_plan','character_voice_media','shot_dialogue_current','shot_dialogue_revision','character_voice_current','character_voice_revision','finish_action','finish_message','finish_run','timeline_source_reference','timeline_assembly_receipt','timeline_assembly_plan','timeline_revision','timeline'])db.exec('DROP TABLE IF EXISTS '+table);
    db.exec('DROP TABLE media_probe; DROP TABLE media_cache; DROP TABLE media_verification; DELETE FROM migration_log WHERE version>=15; UPDATE library SET schema_version=14; PRAGMA user_version=14');
    db.prepare('INSERT INTO blob_object VALUES(?,?,?,?,?,?,?)').run('a'.repeat(64), 'a'.repeat(64), 123, `objects/aa/${'a'.repeat(64)}`, 'video/mp4', 24, 12);
    db.prepare('INSERT INTO asset(id,library_id,name,created_at) VALUES(?,?,?,?)').run('old', id, 'Existing video', '2026-01-01');
    db.prepare('INSERT INTO asset_version(asset_id,version,library_id,object_id,created_at) VALUES(?,?,?,?,?)').run('old', 1, id, 'a'.repeat(64), '2026-01-01'); db.close();
    const upgraded = await openLibrary({ root });
    if (!upgraded.ok) {
      const { readFile } = await import('node:fs/promises');
      const files = (await readdir(join(root, 'logs'))).filter(name => name.startsWith('migration-'));
      throw Error(await readFile(join(root, 'logs', files[0]!), 'utf8'));
    }
    expect(upgraded, JSON.stringify(upgraded)).toMatchObject({ ok: true, value: { schemaVersion: CURRENT_SCHEMA_VERSION } });
    try { expect(upgraded.value.db.prepare('SELECT mime,width,height,byte_length FROM blob_object').get()).toMatchObject({ mime: 'video/mp4', width: 24, height: 12, byte_length: 123 }); expect(upgraded.value.db.prepare('SELECT count(*) n FROM media_probe').get()?.n).toBe(0); }
    finally { await upgraded.value.close(); }
    expect((await readdir(join(root, 'backups'))).some(name => name.startsWith('schema-14-'))).toBe(true);
  } finally { await rm(root, { recursive: true, force: true }); }
});
