import {read,write,replace} from './edit.mjs';
replace('packages/engine/src/content-scope.ts',"for(const [table,kind]of [['audio_batch_item','audio'],['dialogue_production_item','dialogue']]as const)","for(const table of ['audio_batch_item','dialogue_production_item']as const)");
replace('tests/integration/subproject-hardening.test.ts',"e.generation.prepare(f.prepareInput())","e.generation.prepare(f.prepareInput() as any)");
replace('packages/contracts/src/project-memory.ts',"entries:MemoryEntry[];completions:","entries:MemoryEntry[];history:MemoryEntry[];completions:");
replace('packages/engine/src/project-memory-service.ts',"entries:db.prepare(","history:db.prepare('SELECT * FROM project_memory WHERE project_id=? ORDER BY rowid').all(projectId).map(memoryRow),entries:db.prepare(");
replace('packages/engine/src/project-memory-service.ts',"title:v.value.title,note:i.note??'',scripts,shots,","title:v.value.title,note:i.note??'',projectRules:(read(i.projectId) as {ok:true;value:ProjectMemory}).value.entries.filter(e=>e.kind==='rule'&&e.status==='active'),scripts,shots,");
replace('packages/engine/src/project-memory-service.ts',"projectRules:read(item.projectId).ok?(read(item.projectId) as {ok:true;value:ProjectMemory}).value.entries.filter(e=>e.kind==='rule'&&e.status==='active'):[]","projectRules:source.projectRules??[]");
replace('apps/desktop/src/renderer/features/subprojects/SubprojectWorkspace.tsx',"memory?.entries.filter(e=>e.subprojectId===s.id&&e.kind==='summary')","memory?.history?.filter(e=>e.subprojectId===s.id&&e.kind==='summary')");
replace('apps/desktop/src/renderer/features/subprojects/SubprojectWorkspace.tsx',"<QueryState loading={memory.isPending} error={memory.error}/>","<details><summary>记忆修订历史</summary>{memory.data?.history?.map(e=><div key={e.id+'/'+e.revision}><strong>{e.kind} · r{e.revision} · {e.status}</strong><p className=\"memory-body\">{e.body}</p></div>)}</details><QueryState loading={memory.isPending} error={memory.error}/>");
replace('apps/desktop/src/renderer/features/subprojects/SubprojectWorkspace.tsx',"useEffect,useRef,useState","useEffect,useState");
replace('apps/desktop/src/renderer/features/subprojects/SubprojectWorkspace.tsx',"saved=useRef('');","[saved,setSaved]=useState('');");
replace('apps/desktop/src/renderer/features/subprojects/SubprojectWorkspace.tsx',"saved.current=note;","setSaved(note);");
replace('apps/desktop/src/renderer/features/subprojects/SubprojectWorkspace.tsx',"dirty:value!==saved.current","dirty:value!==saved");
replace('apps/desktop/src/renderer/features/subprojects/SubprojectWorkspace.tsx',"saved.current=value;","setSaved(value);");
replace('apps/desktop/src/renderer/features/subprojects/SubprojectWorkspace.tsx',"onChange(saved.current)","onChange(saved)");

