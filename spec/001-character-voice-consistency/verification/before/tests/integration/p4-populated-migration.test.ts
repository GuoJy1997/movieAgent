import { expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { mkdtemp, readdir, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { openLibrary } from '../../packages/storage/src/database.ts';

// Build each historical schema forwards using only migrations existing then.
// Never manufacture schema19 by dropping its audio/timeline/finish tables.
for (const version of [14, 19, 22]) it(`preserves populated schema${version} bytes, task refs, config and all old rows during upgrade to23`, async () => {
  const root = await mkdtemp(join(tmpdir(), `p4-upgrade-${version}-`));
  const object = Buffer.from('owned historical media bytes'), hash = createHash('sha256').update(object).digest('hex');
  let db: DatabaseSync | undefined;
  try {
    db = new DatabaseSync(join(root, 'library.sqlite'));
    db.exec('PRAGMA foreign_keys=ON');
    const directory = resolve('packages/storage/src/migrations');
    for (const file of (await readdir(directory)).filter(file => /^\d{4}-.*\.ts$/.test(file)).sort()) {
      if (Number(file.slice(0, 4)) > version) break;
      const module = await import(pathToFileURL(join(directory, file)).href);
      const migrate = Object.entries(module).find(([name]) => name.startsWith('migrate'))?.[1] as (db: DatabaseSync, id: string) => void;
      expect(migrate).toBeTypeOf('function'); migrate(db, 'historical-library');
    }
    expect(db.prepare('PRAGMA user_version').get()?.user_version).toBe(version);
    const createdAt = '2026-01-01T00:00:00.000Z', json = JSON.stringify;
    db.prepare('INSERT INTO project VALUES(?,?,?,?)').run('project', 'historical-library', '旧项目', createdAt);
    db.prepare('INSERT INTO connection_revision VALUES(?,?,?,?)').run('connection', 1, 'historical-library', json({ id: 'connection', adapter: 'local-fixture', credential: null }));
    db.prepare('INSERT INTO model_revision VALUES(?,?,?,?,?,?)').run('model', 1, 'historical-library', 'connection', 1, json({ id: 'model', upstreamModel: 'historical-fixture' }));
    db.prepare('INSERT INTO profile_revision VALUES(?,?,?,?,?,?)').run('profile', 1, 'historical-library', 'model', 1, json({ id: 'profile', parameters: { voice: 'old-voice' } }));
    db.prepare('INSERT INTO blob_object VALUES(?,?,?,?,?,?,?)').run('object', hash, object.length, hash, 'video/mp4', 1920, 1080);
    db.prepare('INSERT INTO asset(id,library_id,name) VALUES(?,?,?)').run('asset', 'historical-library', '旧视频');
    db.prepare('INSERT INTO artifact VALUES(?,?,?,?)').run('artifact', 'historical-library', 'object', createdAt);
    db.prepare('INSERT INTO asset_version VALUES(?,?,?,?,?,?)').run('asset', 1, 'historical-library', 'object', 'artifact', createdAt);
    const task = { libraryId: 'historical-library', taskId: 'task', attemptId: 'attempt' };
    db.prepare('INSERT INTO generation_prepared VALUES(?,?,?)').run('prepared', 'project', json({ preparedId: 'prepared', profileRef: { libraryId: 'historical-library', id: 'profile', revision: 1 } }));
    db.prepare('INSERT INTO generation_task VALUES(?,?,?,?,?,?)').run('task', 'prepared', 'project', json({ approved: true }), 'CNY', 1234);
    db.prepare('INSERT INTO task_attempt(attempt_id,task_id,view_json,output_json) VALUES(?,?,?,?)').run('attempt', 'task', json({ ...task, state: 'SUCCEEDED' }), json({ artifactId: 'artifact', hash }));
    if (version >= 19) {
      const line = { libraryId: 'historical-library', projectId: 'project', id: 'line', revision: 1, text: '旧配音台词', createdAt };
      db.prepare('INSERT INTO voice_line_revision VALUES(?,?,?,?)').run('project', 'line', 1, json(line));
      db.prepare('INSERT INTO audio_take VALUES(?,?,?)').run('task', 'project', json({ id: 'audio-take', lineId: 'line', lineRevision: 1, task, sourceHash: hash }));
      db.prepare('INSERT INTO timeline VALUES(?,?,?,?)').run('timeline', 'project', 'historical-library', 1);
      db.prepare('INSERT INTO timeline_revision VALUES(?,?,?,?)').run('timeline', 1, 'project', json({ id: 'timeline', source: { kind: 'assetVersion', libraryId: 'historical-library', assetId: 'asset', version: 1 }, sourceHash: hash, task }));
      db.prepare('INSERT INTO timeline_source_reference VALUES(?,?,?,?,?,?,?)').run('revision', 'timeline', 1, 'clip', json({ kind: 'artifact', libraryId: 'historical-library', artifactId: 'artifact' }), hash, null);
    }
    if (version >= 22) {
      db.prepare('INSERT INTO dialogue_take(id,project_id,shot_id,dialogue_id,dialogue_revision,origin_kind,task_id,data_json) VALUES(?,?,?,?,?,?,?,?)').run('take', 'project', 'shot', 'dialogue', 1, 'provider', 'task', json({ id: 'take', task, audioHash: hash }));
      db.prepare('INSERT INTO dialogue_review VALUES(?,?,?)').run('take', 1, json({ takeId: 'take', checks: { timbre: 'pass', accent: 'pass', dialogue: 'pass', lipsync: 'pass' } }));
    }
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all().map(row => row.name as string);
    const before = new Map(tables.filter(name => !['library', 'migration_log', 'engine_owner'].includes(name)).map(name => [name, db!.prepare(`SELECT * FROM "${name}" ORDER BY rowid`).all()]));
    await mkdir(join(root, 'objects')); await writeFile(join(root, 'objects', hash), object);
    db.close(); db = undefined;
    const opened = await openLibrary({ root }); expect(opened).toMatchObject({ ok: true, value: { schemaVersion: 23, libraryId: 'historical-library' } });
    if (!opened.ok) throw Error(JSON.stringify(opened));
    try {
      for (const [table, rows] of before) expect(opened.value.db.prepare(`SELECT * FROM "${table}" ORDER BY rowid`).all(), table).toEqual(rows);
      expect(opened.value.db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
      expect(opened.value.db.prepare('SELECT version FROM migration_log ORDER BY version').all()).toHaveLength(23);
      expect(createHash('sha256').update(await readFile(join(root, 'objects', hash))).digest('hex')).toBe(hash);
      const backups = await readdir(join(root, 'backups'));
      const backup = backups.find(name => name.startsWith(`schema-${version}-`)); expect(backup).toBeTruthy();
      const historical = new DatabaseSync(join(root, 'backups', backup!));
      try { expect(historical.prepare('PRAGMA user_version').get()?.user_version).toBe(version); for (const [table, rows] of before) expect(historical.prepare(`SELECT * FROM "${table}" ORDER BY rowid`).all(), table).toEqual(rows); } finally { historical.close(); }
    } finally { await opened.value.close(); }
  } finally { db?.close(); await rm(root, { recursive: true, force: true }); }
});
