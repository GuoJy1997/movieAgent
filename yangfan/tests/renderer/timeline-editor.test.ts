import { afterAll,beforeAll,expect,it } from 'vitest';
import { harness,mounted,calls,timeline,queries } from './p4-harness.ts';
import { applyTimelineOps } from '../../packages/domain/src/timeline-edit.ts';
import type { TimelineOp } from '../../packages/contracts/src/timeline.ts';
let h:Awaited<ReturnType<typeof harness>>;
beforeAll(async()=>{h=await harness();});afterAll(async()=>{await h?.browser.close();await h?.server.close();});
it('saves undo of a replacement with exact fixed provenance and an unsaved intermediate recipe',async()=>{
 const provenance={shotId:'shot',shotRevision:1,selectionRevision:1,productionId:null,productionShotRevision:null};
 const t={...timeline,videoClips:[{...timeline.videoClips[0]!,provenance}]};
 await mounted(h,async page=>{
  await page.getByLabel('editor draft').waitFor();
  await page.evaluate(()=>window.p4Fixture.editor!.edit([{kind:'setSettings',settings:{fps:{num:30,den:1},canvas:{width:1920,height:1080}},title:'intermediate'}]));
  await page.evaluate(()=>window.p4Fixture.editor!.edit([{kind:'replaceMedia',clipId:'clip-a',media:{kind:'assetVersion',libraryId:'library',assetId:'new-picture',version:1},sourceHash:'b'.repeat(64),sourceProbeId:null,sourceInTicks:0,durationTicks:240000}]));
  await page.evaluate(()=>{void window.p4Fixture.editor!.save();});await calls(page,1);
  const p=await page.evaluate(()=>window.p4Fixture.calls[0]!.payload),applied=applyTimelineOps(t,p.operations as TimelineOp[]);if(!applied.ok)throw Error(applied.error.code);
  await page.evaluate(t=>window.p4Fixture.resolve({...t,revision:2}),applied.value);await expect.poll(()=>page.evaluate(()=>window.p4Fixture.editor!.saving)).toBe(false);
  await page.evaluate(()=>window.p4Fixture.editor!.undo());await page.evaluate(()=>{void window.p4Fixture.editor!.save();});await calls(page,2);
  const restore=await page.evaluate(()=>window.p4Fixture.calls[1]!);expect(restore.kind).toBe('timeline.restore');expect(restore.payload).toMatchObject({sourceRevision:1,expectedRevision:2,operations:[{kind:'setSettings',title:'intermediate'}]});
  const restored=applyTimelineOps(t,restore.payload.operations as TimelineOp[]);if(!restored.ok)throw Error(restored.error.code);await page.evaluate(t=>window.p4Fixture.resolve({...t,revision:3}),restored.value);
  await expect.poll(()=>page.evaluate(()=>window.p4Fixture.editor!.draft.videoClips[0])).toEqual(t.videoClips[0]);
  await page.evaluate(()=>window.p4Fixture.editor!.undo());await page.evaluate(()=>{void window.p4Fixture.editor!.save();});await calls(page,3);expect(await page.evaluate(()=>window.p4Fixture.calls[2]!.payload.sourceRevision)).toBe(1);
 },{__editor:t});
});
it('saves one legal ripple affecting 101 cues and undoes it across the save boundary',async()=>{
 const t={...timeline,videoClips:[{...timeline.videoClips[0]!,durationTicks:48000}],subtitleCues:Array.from({length:101},(_,i)=>({id:`q${i}`,text:`cue${i}`,startTicks:(i+1)*48000,endTicks:(i+2)*48000}))};
 await mounted(h,async page=>{
  await page.getByRole('button',{name:'选择片段 clip-a',exact:true}).click();await page.getByRole('button',{name:'预览波纹删除',exact:true}).click();await page.getByRole('button',{name:'采用波纹删除',exact:true}).click();
  await page.getByRole('button',{name:'保存时间线',exact:true}).click();await calls(page,1);
  const p=await page.evaluate(()=>window.p4Fixture.calls[0]!.payload);expect(p.operations).toHaveLength(1);expect((p.operations as TimelineOp[])[0]!.kind).toBe('rippleDelete');
  const applied=applyTimelineOps(t,p.operations as TimelineOp[]);if(!applied.ok)throw Error(applied.error.code);await page.evaluate(t=>window.p4Fixture.resolve({...t,revision:2}),applied.value);
  await expect.poll(()=>page.getByRole('button',{name:'保存时间线',exact:true}).isDisabled()).toBe(true);
  await page.getByRole('button',{name:'撤销',exact:true}).click();await page.getByRole('button',{name:'保存时间线',exact:true}).click();await calls(page,2);
  expect(await page.evaluate(()=>window.p4Fixture.calls[1])).toMatchObject({kind:'timeline.restore',payload:{sourceRevision:1,expectedRevision:2}});
  await page.evaluate(t=>window.p4Fixture.resolve({...t,revision:3}),t);await expect.poll(()=>page.locator('.caption-clip').count()).toBe(101);expect(await page.getByRole('button',{name:'选择片段 clip-a',exact:true}).count()).toBe(1);
  await page.getByRole('button',{name:'重做',exact:true}).click();await page.getByRole('button',{name:'保存时间线',exact:true}).click();await calls(page,3);expect(await page.evaluate(()=>window.p4Fixture.calls[2])).toMatchObject({kind:'timeline.restore',payload:{sourceRevision:2,expectedRevision:3}});
 },{...queries(),'timeline.read:timeline-a':t});
});
it('retains input B while an explicit historical restore acknowledgement is delayed',async()=>{
 const old={...timeline,title:'old',revision:1},current={...timeline,title:'current',revision:2};
 await mounted(h,async page=>{
  await page.getByText('持久修订历史（显式恢复）',{exact:true}).click();await page.getByRole('button',{name:'恢复此修订 r1',exact:true}).click();await calls(page,1);
  await page.getByLabel('时间线名称',{exact:true}).fill('newer B');await page.evaluate(t=>window.p4Fixture.resolve({...t,revision:3}),old);
  await expect.poll(()=>page.getByLabel('时间线名称',{exact:true}).inputValue()).toBe('newer B');
  await page.getByRole('button',{name:'保存时间线',exact:true}).click();await calls(page,2);expect(await page.evaluate(()=>window.p4Fixture.calls[1]!.payload.expectedRevision)).toBe(3);
 },{...queries(),'timeline.read:timeline-a':current,'timeline.history':{revisions:[old,current]}});
});
it('mounts a read-only workbench; saves A while retaining B and advances CAS',async()=>{
 await mounted(h,async page=>{
  await page.getByLabel('时间线名称',{exact:true}).fill('提交 A');
  expect(await page.evaluate(()=>window.p4Fixture.calls)).toEqual([]);
  await page.getByRole('button',{name:'保存时间线',exact:true}).click();await calls(page,1);
  await page.getByLabel('时间线名称',{exact:true}).fill('后续 B');
  await page.evaluate(t=>window.p4Fixture.resolve({...t,title:'提交 A',revision:2}),timeline);
  await expect.poll(()=>page.getByLabel('时间线名称',{exact:true}).inputValue()).toBe('后续 B');
  await page.getByRole('button',{name:'保存时间线',exact:true}).click();await calls(page,2);
  expect(await page.evaluate(()=>window.p4Fixture.calls[1]?.payload)).toMatchObject({expectedRevision:2,operations:[{kind:'setSettings',title:'后续 B'}]});
 });
});
it('ignores a late save after explicit discard and timeline selection',async()=>{
 await mounted(h,async page=>{
  await page.getByLabel('时间线名称',{exact:true}).fill('A');await page.getByRole('button',{name:'保存时间线',exact:true}).click();await calls(page,1);
  await page.getByLabel('当前时间线',{exact:true}).selectOption('timeline-b');
  await page.getByRole('button',{name:'放弃草稿并离开',exact:true}).click();
  await page.evaluate(t=>window.p4Fixture.resolve({...t,title:'A',revision:2}),timeline);
  await expect.poll(()=>page.getByLabel('时间线名称',{exact:true}).inputValue()).toBe('剪辑 B');
 });
});
it('commits a drag once at release and keyboard shortcuts ignore input fields',async()=>{
 await mounted(h,async page=>{
  const clip=page.getByRole('button',{name:'选择片段 clip-a',exact:true});await clip.click();
  const box=await clip.boundingBox();expect(box).toBeTruthy();
  await page.mouse.move(box!.x+20,box!.y+15);await page.mouse.down();await page.mouse.move(box!.x+100,box!.y+15,{steps:8});
  expect(await page.evaluate(()=>window.p4Fixture.calls)).toEqual([]);await page.mouse.up();
  await page.getByRole('button',{name:'保存时间线',exact:true}).click();await calls(page,1);
  expect(await page.evaluate(()=>window.p4Fixture.calls[0]?.payload.operations)).toHaveLength(1);
  await page.getByLabel('时间线名称',{exact:true}).focus();await page.keyboard.press('Delete');
  expect(await clip.count()).toBe(1);
 });
});
it('retains exactly 50 session undo steps and keeps all workbench controls reachable at 1100px',async()=>{
 await mounted(h,async page=>{
  const title=page.getByLabel('时间线名称',{exact:true});
  for(let i=1;i<=55;i++)await title.fill(`剪辑 ${i}`);
  for(let i=0;i<50;i++)await page.getByRole('button',{name:'撤销',exact:true}).click();
  expect(await title.inputValue()).toBe('剪辑 5');expect(await page.getByRole('button',{name:'撤销',exact:true}).isDisabled()).toBe(true);
  await page.getByRole('button',{name:'重做',exact:true}).click();expect(await title.inputValue()).toBe('剪辑 6');
  await page.getByRole('button',{name:'选择片段 clip-a',exact:true}).click();
  for(const name of ['采用入出点','选择替换素材','保存时间线']){const control=page.getByRole('button',{name,exact:true});await control.scrollIntoViewIfNeeded();const box=await control.boundingBox();expect(box!.x).toBeGreaterThanOrEqual(0);expect(box!.x+box!.width).toBeLessThanOrEqual(1100);}
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(1100);
  await page.getByLabel('时间线名称',{exact:true}).scrollIntoViewIfNeeded();
  await page.screenshot({path:'.superpowers/sdd/2026-10-27-p4-audio-timeline/task-6-1100-workbench.png',fullPage:true});
  await page.getByLabel('当前时间线',{exact:true}).selectOption('timeline-b');
  await page.getByRole('dialog',{name:'保存当前剪辑',exact:true}).waitFor();
  await page.keyboard.press('Tab');expect(await page.evaluate(()=>document.activeElement?.closest('dialog')!==null)).toBe(true);
 });
});
it('adopts a validated 101-cue SRT through explicit 100/1 chunks with no lost or duplicate cue',async()=>{
 await mounted(h,async page=>{
  const stamp=(ms:number)=>`00:00:${String(Math.floor(ms/1000)).padStart(2,'0')},${String(ms%1000).padStart(3,'0')}`;
  const text=Array.from({length:101},(_,i)=>`${i+1}\n${stamp(i*100)} --> ${stamp(i*100+33)}\n字幕${i+1}`).join('\n\n');
  await page.evaluate(text=>window.p4Fixture.setSubtitle(text),text);await page.getByRole('button',{name:'手动字幕',exact:true}).click();await page.getByRole('button',{name:'从系统选择 SRT',exact:true}).click();
  await page.getByRole('button',{name:'采用导入字幕（下100条）',exact:true}).click();
  await page.getByText('待采用 1条 · 本次明确采用 1条（每批最多100）。保存当前草稿后可继续下一批。',{exact:true}).waitFor();
  await page.getByRole('button',{name:'采用导入字幕',exact:true}).click();await page.getByText('待保存操作超过100条，请先保存，再继续编辑。',{exact:true}).waitFor();
  await page.getByRole('button',{name:'保存时间线',exact:true}).click();await calls(page,1);
  const operations=await page.evaluate(()=>window.p4Fixture.calls[0]!.payload.operations) as TimelineOp[];expect(operations).toHaveLength(100);
  const applied=applyTimelineOps(timeline,operations);if(!applied.ok)throw Error(applied.error.code);
  await page.evaluate(t=>window.p4Fixture.resolve({...t,revision:2}),applied.value);
  await expect.poll(()=>page.getByRole('button',{name:'保存时间线',exact:true}).isDisabled()).toBe(true);
  await page.getByRole('button',{name:'采用导入字幕',exact:true}).click();await page.getByRole('button',{name:'保存时间线',exact:true}).click();await calls(page,2);
  const second=await page.evaluate(()=>window.p4Fixture.calls[1]!.payload);expect(second.expectedRevision).toBe(2);expect(second.operations).toHaveLength(1);
  const all=applyTimelineOps(applied.value,second.operations as TimelineOp[]);if(!all.ok)throw Error(all.error.code);expect(all.value.subtitleCues).toHaveLength(101);expect(new Set(all.value.subtitleCues.map(c=>c.id)).size).toBe(101);
 });
});
