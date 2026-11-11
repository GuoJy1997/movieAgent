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
import { migrateAssetMetadata } from '../../packages/storage/src/migrations/0008-asset-metadata.ts';
import { migrateCanvasEdges } from '../../packages/storage/src/migrations/0009-canvas-edges.ts';
import { migrateWorkflows } from '../../packages/storage/src/migrations/0010-workflows.ts';
import { openLibrary } from '../../packages/storage/src/database.ts';
import { CURRENT_SCHEMA_VERSION } from '../../packages/contracts/src/schema.ts';

it('migrates schema10 through backup preserving all preexisting rows and fixed original bytes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'creation-migration-'));
  try {
    const db = new DatabaseSync(join(root, 'library.sqlite')); db.exec('PRAGMA foreign_keys=ON');
    migrateProjects(db, 'old-library'); migrateCommandEvents(db, 'old-stream'); migrateModelConfig(db); migrateAssets(db); migrateGeneration(db); migrateProviderVerification(db); migrateCanvas(db); migrateAssetMetadata(db); migrateCanvasEdges(db); migrateWorkflows(db);
    db.prepare('INSERT INTO project VALUES(?,?,?,?)').run('project', 'old-library', 'Existing', '2025');
    db.prepare('INSERT INTO canvas(id,project_id,library_id) VALUES(?,?,?)').run('project', 'project', 'old-library');
    const bytes = await readFile(new URL('../fixtures/video-sample.mp4', import.meta.url)), hash = createHash('sha256').update(bytes).digest('hex'), key = `objects/${hash.slice(0, 2)}/${hash}`;
    await mkdir(join(root, 'objects', hash.slice(0, 2)), { recursive: true }); await writeFile(join(root, key), bytes);
    db.prepare('INSERT INTO blob_object VALUES(?,?,?,?,?,?,?)').run(hash, hash, bytes.length, key, 'video/mp4', 24, 12);
    db.prepare('INSERT INTO artifact VALUES(?,?,?,?)').run('artifact', 'old-library', hash, '2025');
    db.prepare('INSERT INTO asset(id,library_id,name) VALUES(?,?,?)').run('asset', 'old-library', 'Existing');
    db.prepare('INSERT INTO asset_version VALUES(?,?,?,?,?,?)').run('asset', 1, 'old-library', hash, 'artifact', '2025');
    const libraryId = 'old-library', createdAt = '2025-01-01T00:00:00.000Z';
    const connection = { id:'fixture', revision:1, libraryId, createdAt, name:'Fixture connection', adapterType:'openai-chat-v1', baseUrl:'https://fixture.example/v1', credentialRef:null, headers:{}, networkPolicy:{privateEndpoint:null}, timeoutMs:1000, concurrency:1 };
    const model = { id:'fixture', revision:1, libraryId, createdAt, name:'Fixture text', modelId:'fixture', connectionRef:{libraryId,id:'fixture',revision:1}, capabilities:{taskTypes:['text_to_text'],inputKinds:['text'],outputKinds:['text'],maxBatch:1}, parameters:{max_tokens:{type:'integer',min:1,max:8192,default:1024}},pricing:{status:'unknown'} };
    const profile = { id:'fixture', revision:1, libraryId, createdAt, name:'Fixture profile',modelRef:{libraryId,id:'fixture',revision:1},parameters:{max_tokens:1024} };
    db.prepare('INSERT INTO connection_revision VALUES(?,?,?,?)').run('fixture',1,libraryId,JSON.stringify(connection));
    db.prepare('INSERT INTO model_revision VALUES(?,?,?,?,?,?)').run('fixture',1,libraryId,'fixture',1,JSON.stringify(model));
    db.prepare('INSERT INTO profile_revision VALUES(?,?,?,?,?,?)').run('fixture',1,libraryId,'fixture',1,JSON.stringify(profile));
    const prepared = {libraryId,preparedId:'prepared',projectId:'project',planHash:'a'.repeat(64),expiresAt:1800000000000,inputVersion:'v1',executionOwner:'human',runId:'run',config:{schemaVersion:1,connection,model,profile,parameters:{max_tokens:1024},pricing:{status:'unknown'}},prompt:'Fixture planning input',adapterId:'openai-chat-v1',estimateMicros:null,currency:null};
    const approval = {preparedId:'prepared',approvedPlanHash:prepared.planHash,currency:'CNY',allowanceMicros:1000,budgetLimitMicros:10000,acknowledgeUnknown:true,executionOwner:'human',runId:'run'};
    const task = {libraryId,taskId:'task',attemptId:'attempt',state:'FAILED',providerState:'rejected',collectionState:'pending',providerTaskId:null,clientRequestId:'client',cancelRequested:false,cancelStatus:'none',reconcileStatus:'none',estimateMicros:null,reportedActualMicros:null,reservationMicros:0,currency:'CNY',settlementStatus:'unspent',artifactRef:null,errorCode:'FIXTURE_REJECTED'};
    db.prepare('INSERT INTO generation_prepared VALUES(?,?,?)').run('prepared','project',JSON.stringify(prepared));
    db.prepare('INSERT INTO generation_task VALUES(?,?,?,?,?,?)').run('task','prepared','project',JSON.stringify(approval),'CNY',0);
    db.prepare('INSERT INTO task_attempt(attempt_id,task_id,view_json,client_request_id) VALUES(?,?,?,?)').run('attempt','task',JSON.stringify(task),'client');
    db.prepare('INSERT INTO scheduler_job VALUES(?,?,?,?)').run('attempt',1700000000000,1,1800000000000);
    const observation = {nodeId:'node',incarnation:'incarnation',semanticRevision:1,selectionRevision:1};
    const workflow = {libraryId,planId:'workflow',planHash:'b'.repeat(64),projectId:'project',canvasId:'project',mode:'current',nodeIds:['node'],executionOwner:'human',runId:'run',observedRevision:0,expiresAt:1800000000000,observations:[observation],externalInputs:[],steps:[{...observation,stepId:'step',template:prepared,graphInputs:{edges:[],nodes:[]},inputs:[]}],currency:null,estimateMicros:null,limits:{steps:32,dependencies:128}};
    db.prepare('INSERT INTO workflow VALUES(?,?,?,?,?,?)').run('workflow','project','project',JSON.stringify(workflow),JSON.stringify({planId:'workflow',approvedPlanHash:workflow.planHash,currency:'CNY',budgetLimitMicros:10000,stepAllowances:{step:1000},acknowledgeUnknown:true,executionOwner:'human',runId:'run'}),'failed');
    db.prepare('INSERT INTO workflow_step VALUES(?,?,?,?,?,?,?,?,?)').run('workflow','step','workflow-command','prepared','task','failed',0,'CNY','FIXTURE_REJECTED');
    // Snapshot every preexisting user table, including populated task/config/workflow records.
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT IN ('library','migration_log','engine_owner') ORDER BY name").all().map(x => x.name as string);
    const rows = new Map(tables.map(name => [name, db.prepare(`SELECT * FROM "${name}" ORDER BY rowid`).all()])); db.close();
    const opened = await openLibrary({ root }); if (!opened.ok) throw Error(opened.error.code);
    try {
      expect(opened.value.schemaVersion).toBe(CURRENT_SCHEMA_VERSION); expect(opened.value.schemaVersion).toBeGreaterThan(10);
      for (const [table, before] of rows) expect(opened.value.db.prepare(`SELECT * FROM "${table}" ORDER BY rowid`).all()).toEqual(before);
      expect(opened.value.db.prepare('SELECT * FROM creation_revision').all()).toEqual([]);
      expect(opened.value.db.prepare('SELECT * FROM shot_production').all()).toEqual([]);
      expect(opened.value.db.prepare('SELECT * FROM shot_canvas_binding').all()).toEqual([]);
      expect(opened.value.db.prepare('SELECT * FROM shot_production_output').all()).toEqual([]);
      expect(opened.value.db.prepare('SELECT * FROM shot_production_collection_issue').all()).toEqual([]);
      expect(opened.value.db.prepare('PRAGMA user_version').get()).toMatchObject({ user_version: CURRENT_SCHEMA_VERSION });
      expect(opened.value.db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
      expect(createHash('sha256').update(await readFile(join(root, key))).digest('hex')).toBe(hash);
      const backupFile = (await readdir(join(root, 'backups'))).find(x => x.startsWith('schema-10-'))!; expect(backupFile).toBeTruthy();
      const backup = new DatabaseSync(join(root, 'backups', backupFile)); expect(backup.prepare('PRAGMA user_version').get()).toMatchObject({ user_version: 10 }); backup.close();
    } finally { await opened.value.close(); }
  } finally { await rm(root, { recursive: true, force: true }); }
});
