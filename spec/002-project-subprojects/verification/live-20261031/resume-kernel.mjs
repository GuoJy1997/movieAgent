import fs from'node:fs';const file='D:/movieAgent/spec/002-project-subprojects/verification/live-20261031/kernel.mjs';let s=fs.readFileSync(file,'utf8');s=s.replace('{createDirectoryProject,bindDirectoryProject}','{createDirectoryProject,bindDirectoryProject,inspectDirectoryProject}');
const start=s.indexOf("const name='连续创作真实验收");const end=s.indexOf('const save=async()',start);
s=s.slice(0,start)+`let old;try{old=JSON.parse(await fs.readFile(path.join(evidence,'state.json'),'utf8'))}catch{}
const name=old?.name??('连续创作真实验收-20261031-'+Date.now().toString().slice(-6));
const project=old?take(await inspectDirectoryProject(old.projectRoot)):take(await createDirectoryProject({mode:'new',directory:parent,name}));
let p;
if(old)p={id:old.projectId};else{
const e=take(await startEngine({root:project.libraryRoot}));
p=take(await e.commands.execute({schemaVersion:1,libraryId:e.identity.libraryId,connectionEpoch:'live-init',commandId:'live-init',kind:'project.create',payload:{name}})).result;
take(await bindDirectoryProject(project.root,{workspaceId:project.manifest.workspaceId,libraryId:e.identity.libraryId,projectId:p.id}));take(await e.close());
}
const registry=take(await RecentProjects.open(path.join(evidence,'launcher/recent-projects.json')));take(await registry.remember(project));
const data=old??{runId:randomUUID(),projectId:p.id,projectRoot:project.root,libraryRoot:project.libraryRoot,name,requestedVideoCount:1,requestedVideoSeconds:4,steps:[]};
`+s.slice(end);
s=s.replace("data.a=await execute(","data.a??=await execute(").replace("data.b=await execute(","data.b??=await execute(");fs.writeFileSync(file,s);
