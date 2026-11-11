import {removeSubprojectSchema} from './subproject-migration-fixture.ts';
import type { DatabaseSync } from 'node:sqlite';
/** A historical downgrade fixture must remove later additive schema as well. */
export function removeLocalMediaSchema(db: DatabaseSync): void {
    removeSubprojectSchema(db);
    db.exec('DROP TABLE IF EXISTS dialogue_review_context; DROP TABLE IF EXISTS dialogue_batch_approval');
    db.exec('DROP TRIGGER IF EXISTS immutable_media_cache_identity');
    for (const table of [
        'timeline_export_operation', 'local_media_output', 'local_media_publication', 'local_media_derived_output', 'local_media_cache_lease', 'local_media_attempt', 'local_media_job', 'render_plan'
    ])
        db.exec('DROP TABLE IF EXISTS ' + table);
    const columns = db.prepare('PRAGMA table_info(media_cache)').all().map(value => value.name);
    for (const column of ['hash', 'mime', 'kind', 'extra_json'])
        if (columns.includes(column))
            db.exec('ALTER TABLE media_cache DROP COLUMN ' + column);
}
