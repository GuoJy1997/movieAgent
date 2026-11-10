import {read,write,replace} from './edit.mjs';
replace('tests/electron/subprojects.test.ts',"import {startEngine}","import {RecentProjects} from '../../apps/desktop/src/main/recent-projects.ts';\nimport {startEngine}");
replace('tests/electron/subprojects.test.ts',"const packaged=process.env.MOVIEAGENT_SUBPROJECT_PACKAGED==='1';","const registry=take(await RecentProjects.open(join(root,'launcher/recent-projects.json')));take(await registry.remember(project));\n const packaged=process.env.MOVIEAGENT_SUBPROJECT_PACKAGED==='1';");
replace('tests/electron/subprojects.test.ts',"'--workspace-child','--project-root='","'--user-data-dir='+join(root,'isolated-user-data'),'--workspace-child','--project-root='");

