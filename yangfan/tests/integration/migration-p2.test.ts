import {CURRENT_SCHEMA_VERSION} from '../../packages/contracts/src/schema.ts';
import { expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { migrateProjects } from '../../packages/storage/src/migrations/0001-projects.ts';
import { migrateCommandEvents } from '../../packages/storage/src/migrations/0002-command-events.ts';
import { migrateModelConfig } from '../../packages/storage/src/migrations/0003-model-config.ts';
import { migrateAssets } from '../../packages/storage/src/migrations/0004-assets-collection.ts';
import { migrateGeneration } from '../../packages/storage/src/migrations/0005-generation.ts';
import { migrateProviderVerification } from '../../packages/storage/src/migrations/0006-provider-verification.ts';
import { migrateCanvas } from '../../packages/storage/src/migrations/0007-canvas.ts';
import { openLibrary } from '../../packages/storage/src/database.ts';
import sharp from 'sharp';

it('migrates a real schema7 library through a retained backup without changing fixed image/video objects or sources', async () => {
  const root = await mkdtemp(join(tmpdir(), 'migration-p2-'));
  try {
    const db = new DatabaseSync(join(root, 'library.sqlite')); db.exec('PRAGMA foreign_keys=ON');
    migrateProjects(db, 'historical-library'); migrateCommandEvents(db, 'stream'); migrateModelConfig(db); migrateAssets(db); migrateGeneration(db); migrateProviderVerification(db); migrateCanvas(db);
    expect(db.prepare('PRAGMA user_version').get()).toMatchObject({ user_version: 7 });
    const originals = [{ id: 'image', mime: 'image/png', bytes: await sharp({ create: { width: 24, height: 12, channels: 3, background: '#234567' } }).png().toBuffer() }, { id: 'video', mime: 'video/mp4', bytes: await readFile(new URL('../fixtures/video-sample.mp4', import.meta.url)) }];
    for (const original of originals) {
      const hash = createHash('sha256').update(original.bytes).digest('hex'), key = `objects/${hash.slice(0, 2)}/${hash}`;
      await mkdir(join(root, 'objects', hash.slice(0, 2)), { recursive: true }); await writeFile(join(root, key), original.bytes);
      db.prepare('INSERT INTO blob_object VALUES(?,?,?,?,?,?,?)').run(hash, hash, original.bytes.length, key, original.mime, 24, 12);
      db.prepare('INSERT INTO artifact VALUES(?,?,?,?)').run(`source-${original.id}`, 'historical-library', hash, '2025-original');
      db.prepare('INSERT INTO asset VALUES(?,?,?)').run(original.id, 'historical-library', original.id);
      db.prepare('INSERT INTO asset_version VALUES(?,?,?,?,?,?)').run(original.id, 1, 'historical-library', hash, `source-${original.id}`, '2025-original');
    }
    const versions = db.prepare('SELECT * FROM asset_version ORDER BY asset_id').all(), blobs = db.prepare('SELECT * FROM blob_object ORDER BY object_id').all(); db.close();
    const opened = await openLibrary({ root }); if (!opened.ok) throw Error('migration');
    try {
      expect(opened).toMatchObject({ ok: true, value: { schemaVersion: CURRENT_SCHEMA_VERSION } });
      expect(opened.value.db.prepare('SELECT * FROM canvas_edge').all()).toEqual([]);
      expect(opened.value.db.prepare('SELECT * FROM workflow').all()).toEqual([]);
      expect(opened.value.db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
      expect(opened.value.db.prepare('SELECT * FROM asset_version ORDER BY asset_id').all()).toEqual(versions);
      expect(opened.value.db.prepare('SELECT * FROM blob_object ORDER BY object_id').all()).toEqual(blobs);
      expect(opened.value.db.prepare('SELECT metadata_revision,tags_json,deleted_at,created_at FROM asset').all()).toEqual([{ metadata_revision: 1, tags_json: '[]', deleted_at: null, created_at: '2025-original' }, { metadata_revision: 1, tags_json: '[]', deleted_at: null, created_at: '2025-original' }]);
      for (const blob of blobs) expect(createHash('sha256').update(await readFile(join(root, blob.storage_key as string))).digest('hex')).toBe(blob.hash);
      const backupName = (await readdir(join(root, 'backups'))).find(f => f.startsWith('schema-7-'))!;
      const backup = new DatabaseSync(join(root, 'backups', backupName)); expect(backup.prepare('PRAGMA user_version').get()).toMatchObject({ user_version: 7 }); expect(backup.prepare('SELECT * FROM asset_version ORDER BY asset_id').all()).toEqual(versions); backup.close();
    } finally { await opened.value.close(); }
  } finally { await rm(root, { recursive: true, force: true }); }
});
