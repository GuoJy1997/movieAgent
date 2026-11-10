import {read,write,replace} from './edit.mjs';
replace('tests/electron/subprojects.test.ts',"const a=children.find((s:any)=>s.title==='第一集'),sa={projectId:p.id,subprojectId:a.id};","const a=children.find((s:any)=>s.title==='第一集'),sa={projectId:p.id,subprojectId:a.id};await ui(page.getByLabel('当前子项目')).toHaveValue(a.id);");
replace('tests/electron/subprojects.test.ts',"sb={projectId:p.id,subprojectId:b.id};","sb={projectId:p.id,subprojectId:b.id};await ui(page.getByLabel('当前子项目')).toHaveValue(b.id);");
const p='apps/desktop/src/renderer/features/subprojects/SubprojectWorkspace.tsx';
replace(p,"useEffect,useState","useEffect,useRef,useState");
replace(p,"const [title,setTitle]=useState(''),","const alive=useRef(true);useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);\n const [title,setTitle]=useState(''),");
replace(p,"if(made){setTitle('');","if(made&&alive.current){setTitle('');");

