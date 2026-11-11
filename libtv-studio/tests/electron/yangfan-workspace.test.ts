import {it,expect} from 'vitest';
import {_electron} from '@playwright/test';
import {mkdtemp,writeFile,rm,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
it('opens the packaged Yangfan shell, creates a local project and preserves the library on reopen',async()=>{
 const root=await mkdtemp(join(tmpdir(),'yangfan-spec005-'));
 const config=join(root,'models.json');await writeFile(config,'{"schemaVersion":1,"providers":[]}');
 const app=await _electron.launch({executablePath:resolve(process.env.MOVIEAGENT_TEST_PACKAGE!,'MovieAgent.exe'),args:['--library-root='+join(root,'library'),'--user-data-dir='+join(root,'profile'),'--model-config='+config],timeout:30000});
 try{
  const page=await app.firstWindow();page.setDefaultTimeout(15000);
  await page.waitForFunction(()=>!!window.studio);
  expect(await page.title()).toBe('羊番TV');
  expect(await app.evaluate(({app})=>app.getName())).toBe('MovieAgent'); // stable profile identity
  await page.getByRole('button',{name:'新建短剧',exact:true}).click();
  await page.getByLabel('项目名称',{exact:true}).fill('羊番界面验证');
  await page.getByRole('button',{name:'创建短剧',exact:true}).click();
  await expect.poll(()=>page.getByRole('tab',{name:'分集与分期',exact:true}).getAttribute('aria-selected')).toBe('true');
  const saved=await page.evaluate(()=>window.studio.listProjects());expect(saved.ok&&saved.value.some(p=>p.name==='羊番界面验证')).toBe(true);
  expect(await page.getByRole('navigation',{name:'工作区导航'}).getByRole('button').count()).toBe(5);
  await page.getByRole('button',{name:'设置',exact:true}).click();
  await page.getByRole('tab',{name:'MCP 接入',exact:true}).click();
  expect(await page.getByRole('region',{name:'MCP Agent 接入'}).count()).toBe(1);
  await page.getByRole('button',{name:'返回工作区'}).click();
  expect(await page.getByRole('tab',{name:'分集与分期',exact:true}).getAttribute('aria-selected')).toBe('true');
  await page.reload();await page.getByRole('button',{name:'继续制作',exact:true}).click();
  expect(await page.getByRole('tab',{name:'分集与分期',exact:true}).getAttribute('aria-selected')).toBe('true');
  expect(await page.evaluate(()=>({require:typeof (window as any).require,process:typeof (window as any).process}))).toEqual({require:'undefined',process:'undefined'});
  const out=resolve('../verification/2026-11-07-spec005-ui/screenshots');await mkdir(out,{recursive:true});await page.screenshot({path:join(out,'packaged-workspace.png')});
 }finally{await app.close();await rm(root,{recursive:true,force:true,maxRetries:3,retryDelay:200});}
},60000);