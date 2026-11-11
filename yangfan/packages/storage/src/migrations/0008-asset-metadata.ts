import type { DatabaseSync } from 'node:sqlite';
export function migrateAssetMetadata(db: DatabaseSync): void {
  if ((db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version >= 8) return;
  db.exec('BEGIN IMMEDIATE');
  try {
    db.exec(`
      ALTER TABLE asset ADD COLUMN metadata_revision INTEGER NOT NULL DEFAULT 1 CHECK(metadata_revision>0);
      ALTER TABLE asset ADD COLUMN tags_json TEXT NOT NULL DEFAULT '[]';
      ALTER TABLE asset ADD COLUMN deleted_at TEXT;
      ALTER TABLE asset ADD COLUMN created_at TEXT NOT NULL DEFAULT '';
      UPDATE asset SET created_at=COALESCE((SELECT MIN(created_at) FROM asset_version WHERE asset_id=asset.id),'');
      ALTER TABLE import_batch ADD COLUMN terminal_error TEXT;
      CREATE TABLE import_collection_v8(
        import_id TEXT NOT NULL REFERENCES import_batch(import_id),
        collection_id TEXT PRIMARY KEY REFERENCES collection_job(collection_id),
        asset_id TEXT NOT NULL, name TEXT NOT NULL,
        expected_version INTEGER CHECK(expected_version IS NULL OR expected_version>0)
      ) STRICT;
      INSERT INTO import_collection_v8(import_id,collection_id,asset_id,name) SELECT import_id,collection_id,asset_id,name FROM import_collection ORDER BY rowid;
      DROP TABLE import_collection;
      ALTER TABLE import_collection_v8 RENAME TO import_collection;
      CREATE INDEX import_collection_asset ON import_collection(asset_id);
    `);
    db.prepare('INSERT INTO migration_log(version,applied_at) VALUES(8,?)').run(new Date().toISOString());
    db.exec('UPDATE library SET schema_version=8; PRAGMA user_version=8; COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}
