import {read,write,replace} from './edit.mjs';
replace('packages/contracts/src/project-memory.ts',"expectedRevision:number;note?:string;","expectedRevision:number;note?:string;memoryInput?:'adopted'|'completion-note';");
replace('packages/contracts/src/project-memory.ts',"'timelineRef','scriptRef'].includes(k)","'timelineRef','scriptRef','memoryInput'].includes(k)");
replace('packages/contracts/src/project-memory.ts',"(x.profileRef===undefined||isRevisionRef(x.profileRef))","(x.memoryInput===undefined||['adopted','completion-note'].includes(String(x.memoryInput)))&&(x.memoryInput!=='completion-note'||typeof x.note==='string'&&x.note.trim().length>0)&&(x.profileRef===undefined||isRevisionRef(x.profileRef))");
replace('packages/engine/src/project-memory-service.ts',"const sources={adoptedTimeline,","const sources={memoryInput:i.memoryInput??'adopted',adoptedTimeline,");
replace('packages/engine/src/project-memory-service.ts',"completedWork:source});","completedWork:source.memoryInput==='completion-note'?{title:source.title,note:source.note,scriptRefs:source.scripts.map((s:ScriptRevision)=>({id:s.id,revision:s.revision})),timelineRef:source.timelineRef,inputNotice:'用户明确选择仅依据本次完成说明整理，未读取完整剧本和镜头正文。'}:source});");
replace('packages/engine/src/project-memory-service.ts',"factStatus:'model_summary_unverified',conflicts","factStatus:'model_summary_unverified',inputBasis:JSON.parse(String(row.source_json)).memoryInput??'adopted',conflicts");
replace('packages/engine/src/project-memory-service.ts',"SET state='pending',task_id=NULL,prepared_json=NULL,error_code=NULL WHERE id=?\").run(String(row.id))","SET state='pending',task_id=NULL,prepared_json=NULL,error_code=NULL,profile_json=COALESCE((SELECT profile_json FROM project_memory_settings WHERE project_id=?),profile_json) WHERE id=?\").run(scope.projectId,String(row.id))");
const p='apps/desktop/src/renderer/features/subprojects/SubprojectWorkspace.tsx';
replace(p,"[noteSaved,setNoteSaved]=useState(0);","[noteSaved,setNoteSaved]=useState(0),[memoryInput,setMemoryInput]=useState<'adopted'|'completion-note'>('adopted');");
replace(p,"<Field label=\"本次完成说明\">","<Field label=\"记忆整理依据\"><select value={memoryInput} onChange={e=>setMemoryInput(e.target.value as typeof memoryInput)}><option value=\"adopted\">采用的剧本与剪辑</option><option value=\"completion-note\">仅本次完成说明</option></select></Field><p className=\"hint\">作品材料超过整理预算时，可写下已采用剧情与结论，再选择“仅本次完成说明”。原剧本与剪辑快照仍完整保留。</p><Field label=\"本次完成说明\">");
replace(p,"expectedRevision:item.revision,note,...","expectedRevision:item.revision,note,memoryInput,...");

