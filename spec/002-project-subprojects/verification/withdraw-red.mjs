import {replace} from './edit.mjs';
replace('tests/integration/subproject-memory.test.ts',"conflicts:['和项目设定待核对']})]));","conflicts:['和项目设定待核对']})]));\n const current=value(e.projectMemory.read(p)).entries.find((x:any)=>x.kind==='summary');value(await execute(e,'project.memorySave',{projectId:p,id:current.id,expectedRevision:current.revision,kind:'summary',body:current.body,status:'withdrawn'}));expect(value(e.projectMemory.context(scope)).entries.some((x:any)=>x.kind==='summary')).toBe(false);");

