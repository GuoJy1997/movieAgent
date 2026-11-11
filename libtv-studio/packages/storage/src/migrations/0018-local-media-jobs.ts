import type { DatabaseSync } from 'node:sqlite';
export function migrateLocalMediaJobs(db: DatabaseSync): void {
    if (Number(db.prepare('PRAGMA user_version').get()!.user_version) >= 18)
        return;
    db.exec('BEGIN IMMEDIATE');
    try {
        db.exec(`
      CREATE TABLE render_plan(plan_id TEXT PRIMARY KEY,project_id TEXT NOT NULL REFERENCES project(id),kind TEXT NOT NULL,plan_hash TEXT NOT NULL,owner TEXT NOT NULL,run_id TEXT NOT NULL,expires_at INTEGER NOT NULL,data_json TEXT NOT NULL) STRICT;
      CREATE TABLE local_media_job(job_id TEXT PRIMARY KEY,plan_id TEXT NOT NULL REFERENCES render_plan(plan_id),attempt INTEGER NOT NULL,approval_run_id TEXT NOT NULL,state TEXT NOT NULL,phase TEXT NOT NULL,progress_ticks INTEGER NOT NULL DEFAULT 0,cancel_requested INTEGER NOT NULL DEFAULT 0,needs_resume INTEGER NOT NULL DEFAULT 0,error_code TEXT,lease_owner TEXT,created_at INTEGER NOT NULL,UNIQUE(plan_id,approval_run_id),UNIQUE(plan_id,attempt)) STRICT;
      CREATE TABLE local_media_attempt(job_id TEXT PRIMARY KEY REFERENCES local_media_job(job_id),plan_id TEXT NOT NULL REFERENCES render_plan(plan_id),attempt INTEGER NOT NULL,state TEXT NOT NULL,started_at INTEGER,ended_at INTEGER,error_code TEXT,UNIQUE(plan_id,attempt)) STRICT;
      CREATE TABLE local_media_publication(job_id TEXT PRIMARY KEY REFERENCES local_media_job(job_id),output_id TEXT NOT NULL UNIQUE,object_hash TEXT NOT NULL,receipt_json TEXT NOT NULL,state TEXT NOT NULL CHECK(state IN ('verified','durable','published'))) STRICT;
      CREATE TABLE local_media_output(output_id TEXT PRIMARY KEY,job_id TEXT NOT NULL UNIQUE REFERENCES local_media_job(job_id),attempt INTEGER NOT NULL,object_id TEXT NOT NULL REFERENCES blob_object(object_id),asset_id TEXT NOT NULL,version INTEGER NOT NULL,FOREIGN KEY(asset_id,version) REFERENCES asset_version(asset_id,version),UNIQUE(asset_id,version)) STRICT;
      CREATE TABLE local_media_cache_lease(plan_id TEXT NOT NULL REFERENCES render_plan(plan_id),cache_id TEXT NOT NULL,PRIMARY KEY(plan_id,cache_id)) STRICT;
      CREATE TABLE local_media_derived_output(job_id TEXT NOT NULL REFERENCES local_media_job(job_id),cache_id TEXT NOT NULL REFERENCES media_cache(cache_id),data_json TEXT NOT NULL,PRIMARY KEY(job_id,cache_id)) STRICT;
      ALTER TABLE media_cache ADD COLUMN hash TEXT;
      ALTER TABLE media_cache ADD COLUMN mime TEXT;
      ALTER TABLE media_cache ADD COLUMN kind TEXT;
      ALTER TABLE media_cache ADD COLUMN extra_json TEXT;
      CREATE TABLE timeline_export_operation(operation_id TEXT PRIMARY KEY,project_id TEXT NOT NULL REFERENCES project(id),job_id TEXT REFERENCES local_media_job(job_id),request_hash TEXT NOT NULL,receipt_json TEXT,state TEXT NOT NULL,created_at INTEGER NOT NULL) STRICT;
      CREATE TRIGGER immutable_render_plan BEFORE UPDATE ON render_plan BEGIN SELECT RAISE(ABORT,'immutable local plan'); END;
      CREATE TRIGGER immutable_render_plan_delete BEFORE DELETE ON render_plan BEGIN SELECT RAISE(ABORT,'immutable local plan'); END;
      CREATE TRIGGER immutable_local_media_output BEFORE UPDATE ON local_media_output BEGIN SELECT RAISE(ABORT,'immutable local output'); END;
      CREATE TRIGGER immutable_local_media_output_delete BEFORE DELETE ON local_media_output BEGIN SELECT RAISE(ABORT,'immutable local output'); END;
      CREATE TRIGGER immutable_local_job_identity BEFORE UPDATE OF plan_id,attempt,approval_run_id ON local_media_job BEGIN SELECT RAISE(ABORT,'immutable local job identity'); END;
      CREATE TRIGGER immutable_local_attempt_identity BEFORE UPDATE OF job_id,plan_id,attempt ON local_media_attempt BEGIN SELECT RAISE(ABORT,'immutable local attempt identity'); END;
      CREATE TRIGGER immutable_local_publication_identity BEFORE UPDATE OF job_id,output_id,object_hash,receipt_json ON local_media_publication BEGIN SELECT RAISE(ABORT,'immutable local publication identity'); END;
      CREATE TRIGGER immutable_media_cache_identity BEFORE UPDATE OF cache_id,source_hash,recipe_hash,runtime_hash,storage_key ON media_cache BEGIN SELECT RAISE(ABORT,'immutable media cache identity'); END;
    `);
        db.prepare('INSERT INTO migration_log(version,applied_at) VALUES(18,?)').run(new Date().toISOString());
        db.exec('UPDATE library SET schema_version=18; PRAGMA user_version=18; COMMIT');
    }
    catch (error) {
        db.exec('ROLLBACK');
        throw error;
    }
}
