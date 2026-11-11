import {beforeAll,afterAll,it,expect} from 'vitest';
import {harness,mounted,queries} from './p4-harness.ts';
let h:Awaited<ReturnType<typeof harness>>;
beforeAll(async()=>{h=await harness();},30000);afterAll(async()=>{await h.browser.close();await h.server.close();});
const data=(n=3)=>({...queries(),__shell:true,'project.list':{projects:Array.from({length:n},(_,i)=>({libraryId:'library',id:i?'p'+i:'project',name:i?'短剧'+i:'周末出逃',createdAt:'2026-11-07'}))},'subproject.list':{items:[{id:'ep03',projectId:'project',title:'EP03 出发前夜',primaryCanvasId:null,status:'producing'}]},'subproject.canvases':{items:[]},'project.tasks':{items:[]},'project.assets':{items:[]},'creation.read':{scripts:[],shots:[],entities:[],selections:[]}});
it('previews another project without changing the working episode, with explicit playback control',async()=>{
 await mounted(h,async page=>{
  const gallery=page.getByRole('region',{name:'项目画廊'});
  await gallery.getByRole('button',{name:'下一项目'}).click();
  expect(await page.getByLabel('当前子项目').inputValue()).toBe('ep03');
  expect(await gallery.getByRole('button',{name:'预览 短剧1',exact:true}).getAttribute('aria-pressed')).toBe('true');
  await gallery.getByRole('button',{name:'暂停自动切换'}).click();
  await page.clock.runFor(12000);
  expect(await gallery.getByRole('button',{name:'预览 短剧1',exact:true}).getAttribute('aria-pressed')).toBe('true');
 },data());
});
it('does not autoplay a single project or under reduced motion',async()=>{
 await mounted(h,async page=>{
  expect(await page.getByRole('button',{name:'下一项目'}).isDisabled()).toBe(true);
 },data(1));
 await mounted(h,async page=>{
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.clock.runFor(18000);
  expect(await page.getByRole('button',{name:'预览 周末出逃',exact:true}).getAttribute('aria-pressed')).toBe('true');
 },data());
});
it('loads each visible project cover in its own scope and starts at the working project',async()=>{
 const d=data(4);
 d['project.list'].projects=[d['project.list'].projects[1]!,d['project.list'].projects[2]!,d['project.list'].projects[0]!,d['project.list'].projects[3]!];
 const scoped:Record<string,unknown>={...d};
 for(const p of d['project.list'].projects){
  scoped['subproject.list:'+p.id]={items:[{id:p.id+'-episode',projectId:p.id,title:'分集',status:'producing'}]};
  scoped['project.assets:'+p.id]={items:[{name:p.name,mime:'image/png',ref:{kind:'assetVersion',libraryId:'library',assetId:p.id+'-poster',version:1}}]};
 }
 await mounted(h,async page=>{
  const gallery=page.getByRole('region',{name:'项目画廊'});
  await page.waitForFunction(()=>window.p4Fixture.bridgeCalls.some(c=>c.kind==='mediaUrl'&&(c.payload as any).ref.assetId==='p1-poster'));
  expect(await gallery.getByRole('button',{name:'预览 周末出逃',exact:true}).getAttribute('aria-pressed')).toBe('true');
  await page.clock.runFor(6100);
  expect(await gallery.getByRole('button',{name:'预览 短剧3',exact:true}).getAttribute('aria-pressed')).toBe('true');
  expect(await page.getByLabel('当前子项目').inputValue()).toBe('project-episode');
  await gallery.getByRole('button',{name:'上一项目'}).click();
  expect(await gallery.getByRole('button',{name:'预览 周末出逃',exact:true}).getAttribute('aria-pressed')).toBe('true');
 },scoped);
});

it('keeps a perspective gallery and reachable controls at desktop and minimum width',async()=>{
 await mounted(h,async page=>{
  await page.setViewportSize({width:1536,height:1024});
  const gallery=page.getByRole('region',{name:'项目画廊'});
  await gallery.getByRole('button',{name:'暂停自动切换'}).click();
  const side=gallery.getByRole('button',{name:'预览 短剧1',exact:true});
  expect(await side.evaluate(e=>getComputedStyle(e).transform)).toContain('matrix3d');
  expect(await page.getByRole('button',{name:'项目记忆',exact:true}).isVisible()).toBe(true);
  await page.setViewportSize({width:800,height:560});
  expect(await page.evaluate(()=>document.body.scrollWidth<=innerWidth)).toBe(true);
  const settings=await page.getByRole('button',{name:'设置',exact:true}).boundingBox();
  expect(settings!.y+settings!.height).toBeLessThanOrEqual(560);
 },data(4));
});

it('keeps the complete poster ratio and original image in every carousel position',async()=>{
 const d:Record<string,unknown>={...data(4),'project.assets':{items:[{name:'周末出逃',mime:'image/png',ref:{kind:'assetVersion',libraryId:'library',assetId:'full-poster',version:1}}]},__mediaUrl:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jZ1kAAAAASUVORK5CYII='};
 await mounted(h,async page=>{
  await page.setViewportSize({width:1536,height:1024});
  const gallery=page.getByRole('region',{name:'项目画廊'});
  await gallery.getByRole('button',{name:'暂停自动切换'}).click();
  await gallery.locator('img').first().waitFor();
  for(const title of ['周末出逃','短剧1','短剧2','短剧3']){
   await gallery.getByRole('button',{name:'切换预览 '+title,exact:true}).click();
   const ratios=await gallery.locator('.circular-carousel__poster').evaluateAll(elements=>elements.map(e=>(e as HTMLElement).offsetWidth/(e as HTMLElement).offsetHeight));
   for(const ratio of ratios)expect(Math.abs(ratio-2)).toBeLessThan(.02);
   const fits=await gallery.locator('.gallery-artwork img').evaluateAll(elements=>elements.map(e=>getComputedStyle(e).objectFit));
   expect(fits.every(fit=>fit==='contain')).toBe(true);
  }
  const variants=await page.evaluate(()=>window.p4Fixture.bridgeCalls.filter(c=>c.kind==='mediaUrl').map(c=>(c.payload as any).variant));
  expect(variants.length).toBeGreaterThan(0);
  expect(variants.every(v=>v==='original')).toBe(true);
 },d);
});

it('tracks the pointer continuously then snaps without opening or changing the working episode',async()=>{
 await mounted(h,async page=>{
  await page.setViewportSize({width:1536,height:1024});
  const gallery=page.getByRole('region',{name:'项目画廊'});
  await gallery.getByRole('button',{name:'暂停自动切换'}).click();
  const selected=gallery.getByRole('button',{name:'预览 周末出逃',exact:true});
  const box=(await selected.boundingBox())!;
  const before=await selected.evaluate(e=>getComputedStyle(e).transform);
  const x=box.x+box.width/2,y=box.y+box.height/2;
  await page.mouse.move(x,y);await page.mouse.down();
  await page.mouse.move(x-20,y);await page.clock.runFor(30);
  await page.mouse.move(x-280,y,{steps:6});await page.clock.runFor(100);
  expect(await selected.evaluate(e=>getComputedStyle(e).transform)).not.toBe(before);
  await page.mouse.up();await page.clock.runFor(1800);
  expect(await gallery.getByRole('button',{name:'预览 短剧1',exact:true}).getAttribute('aria-pressed')).toBe('true');
  expect(await page.getByLabel('当前子项目').inputValue()).toBe('ep03');
  expect(await page.getByRole('heading',{name:'继续你的故事'}).isVisible()).toBe(true);
  // The next deliberate click still works after a suppressed drag click.
  await gallery.getByRole('button',{name:'切换预览 周末出逃',exact:true}).click();
  await page.clock.runFor(1600);
  expect(await selected.getAttribute('aria-pressed')).toBe('true');
 },data(4));
});