import {read,write,replace} from './edit.mjs';
const p='apps/desktop/src/renderer/features/creation/CreationWorkspace.tsx';
replace(p,"import { timelineNavigate }","import { useOwnedDraft,timelineNavigate }");
replace(p,"} = useRevisionDraft(() => scriptDraft(projectId, initial));","} = useRevisionDraft(() => scriptDraft(projectId, initial));\n  useOwnedDraft({dirty:dirty||saving,save:()=>save(value=>runtime.command('creation.saveScript',value),result=>scriptDraft(projectId,result),onSaved),discard:()=>reload(scriptDraft(projectId,initial))},draft);");
replace(p,"} = useRevisionDraft(() => make(initial));","} = useRevisionDraft(() => make(initial));\n  useOwnedDraft({dirty:dirty||saving,save:()=>save(value=>runtime.command('creation.saveShot',value),make,onSaved),discard:()=>reload(make(initial))},draft);");
replace(p,"onClose={() => setEditing(null)}","onClose={() => timelineNavigate(()=>setEditing(null))}");
const q='apps/desktop/src/renderer/features/entities/EntityWorkspace.tsx';
replace(q,"import { timelineNavigate }","import { useOwnedDraft,timelineNavigate }");
replace(q,"} = useRevisionDraft(() => make(initial));","} = useRevisionDraft(() => make(initial));\n  useOwnedDraft({dirty:dirty||saving,save:()=>save(value=>runtime.command('creation.saveEntity',value),make,onSaved),discard:()=>reload(make(initial))},draft);");

