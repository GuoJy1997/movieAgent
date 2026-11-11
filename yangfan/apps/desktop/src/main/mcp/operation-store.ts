import {DatabaseSync} from 'node:sqlite';
import {mkdirSync} from 'node:fs';
import {dirname} from 'node:path';
import {createHash} from 'node:crypto';
import type {McpImportInput,McpImportOperation,McpSourceInfo} from '../../../../../packages/contracts/src/mcp.ts';
import type {AssetVersionRef} from '../../../../../packages/contracts/src/assets.ts';
import type {ReceivedImage} from './import-files.ts';
export interface ImportRecord {hash:string;input:McpImportInput;public:McpImportOperation;received?:ReceivedImage;results:Record<string,unknown>;payloads:Record<string,unknown>;cancelRequested?:boolean}
export function stableHash(value:unknown):string {
 const sort=(v:unknown):unknown=>Array.isArray(v)?v.map(sort):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b)).map(([k,x])=>[k,sort(x)])):v;
 return createHash('sha256').update(JSON.stringify(sort(value))).digest('hex');
}
export class McpOperationStore {
 private db:DatabaseSync;private closed=false;
 constructor(path:string){mkdirSync(dirname(path),{recursive:true});this.db=new DatabaseSync(path);this.db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=1000; CREATE TABLE IF NOT EXISTS mcp_operation(id TEXT PRIMARY KEY, data TEXT NOT NULL); CREATE TABLE IF NOT EXISTS mcp_action(id TEXT PRIMARY KEY, data TEXT NOT NULL); CREATE TABLE IF NOT EXISTS mcp_provenance(ref TEXT PRIMARY KEY, source TEXT, imported_at TEXT NOT NULL, hash TEXT NOT NULL);');}
 get(id:string):ImportRecord|null{const row=this.db.prepare('SELECT data FROM mcp_operation WHERE id=?').get(id);return row?JSON.parse(String(row.data)) as ImportRecord:null;}
 save(record:ImportRecord){if(this.get(record.public.operationId)?.cancelRequested)record.cancelRequested=true;record.public.updatedAt=new Date().toISOString();this.db.prepare('INSERT INTO mcp_operation VALUES(?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data').run(record.public.operationId,JSON.stringify(record));}
 pending():ImportRecord[]{return this.db.prepare('SELECT data FROM mcp_operation').all().map(r=>JSON.parse(String(r.data)) as ImportRecord).filter(r=>['received','collecting','asset_ready','binding','cancelling'].includes(r.public.state));}
 rememberSource(ref:AssetVersionRef,source:McpSourceInfo|undefined,hash:string){this.db.prepare('INSERT OR IGNORE INTO mcp_provenance VALUES(?,?,?,?)').run(stableHash(ref),source?JSON.stringify(source):null,new Date().toISOString(),hash);}
 provenance(ref:AssetVersionRef):McpSourceInfo|null{const row=this.db.prepare('SELECT source FROM mcp_provenance WHERE ref=?').get(stableHash(ref));return row?.source?JSON.parse(String(row.source)) as McpSourceInfo:null;}
 action<T>(id:string):T|null{const row=this.db.prepare('SELECT data FROM mcp_action WHERE id=?').get(id);return row?JSON.parse(String(row.data)) as T:null;}
 saveAction(id:string,value:unknown){this.db.prepare('INSERT INTO mcp_action VALUES(?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data').run(id,JSON.stringify(value));}
 close(){if(!this.closed){this.closed=true;this.db.close();}}
}
