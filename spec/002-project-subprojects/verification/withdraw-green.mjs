import {read,write,replace} from './edit.mjs';
replace('packages/engine/src/project-memory-context.ts',"SELECT * FROM project_memory WHERE project_id=? AND subproject_id=? AND kind='summary' AND revision=?","SELECT m.* FROM project_memory m JOIN project_memory_head h ON h.id=m.id JOIN project_memory current ON current.id=h.id AND current.revision=h.revision WHERE m.project_id=? AND m.subproject_id=? AND m.kind='summary' AND m.revision=? AND current.status='active' AND m.status='active'");
write('apps/desktop/src/renderer/style.css',read('apps/desktop/src/renderer/style.css')+"\n.subproject-grid{align-items:start}.project-task-filter{padding:20px 32px 0}.project-task-filter select{min-width:220px}\n");
replace('tests/electron/subprojects.test.ts',"await page.screenshot({path:join(evidence,packaged?","await page.evaluate(()=>{document.querySelectorAll('*').forEach(el=>{if(el.scrollTop>0)el.scrollTop=0;});});await page.screenshot({path:join(evidence,packaged?");

