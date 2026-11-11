import type { DatabaseSync } from 'node:sqlite';
export function migrateMediaInfo(db: DatabaseSync): void {
  if (Number(db.prepare('PRAGMA user_version').get()!.user_version) >= 15) return;
  db.exec('BEGIN IMMEDIATE');
  try {
    db.exec(`CREATE TABLE media_probe(probe_id TEXT PRIMARY KEY,object_hash TEXT NOT NULL,runtime_hash TEXT NOT NULL,probe_json TEXT NOT NULL,created_at INTEGER NOT NULL,UNIQUE(object_hash,runtime_hash)) STRICT;
      CREATE TABLE media_verification(object_hash TEXT PRIMARY KEY,byte_length INTEGER NOT NULL,device TEXT NOT NULL,inode TEXT NOT NULL,mtime_ns TEXT NOT NULL,ctime_ns TEXT NOT NULL,verified_at INTEGER NOT NULL) STRICT;
      CREATE TABLE media_cache(cache_id TEXT PRIMARY KEY,source_hash TEXT NOT NULL,recipe_hash TEXT NOT NULL,runtime_hash TEXT NOT NULL,storage_key TEXT NOT NULL,byte_length INTEGER NOT NULL,created_at INTEGER NOT NULL,last_used_at INTEGER NOT NULL,UNIQUE(source_hash,recipe_hash,runtime_hash)) STRICT;`);
    db.prepare('INSERT INTO migration_log(version,applied_at) VALUES(15,?)').run(new Date().toISOString());
    db.exec('UPDATE library SET schema_version=15; PRAGMA user_version=15; COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}
