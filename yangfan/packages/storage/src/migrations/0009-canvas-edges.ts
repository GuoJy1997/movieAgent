import type { DatabaseSync } from 'node:sqlite';
export function migrateCanvasEdges(db: DatabaseSync): void {
    if (Number(db.prepare('PRAGMA user_version').get()!.user_version) >= 9)
        return;
    db.exec('BEGIN IMMEDIATE');
    try {
        db.exec(`CREATE TABLE canvas_edge(canvas_id TEXT NOT NULL REFERENCES canvas(id),id TEXT NOT NULL,edge_json TEXT NOT NULL,PRIMARY KEY(canvas_id,id)) STRICT; CREATE TABLE run_graph_input(run_binding_id TEXT PRIMARY KEY REFERENCES run_binding(id),signature TEXT NOT NULL) STRICT;`);
        db.prepare('INSERT INTO migration_log(version,applied_at) VALUES(9,?)').run(new Date().toISOString());
        db.exec('UPDATE library SET schema_version=9; PRAGMA user_version=9; COMMIT');
    }
    catch (error) {
        db.exec('ROLLBACK');
        throw error;
    }
}
