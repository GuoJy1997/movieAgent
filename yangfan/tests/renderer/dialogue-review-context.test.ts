import { afterAll,beforeAll,expect,it } from 'vitest';
import {harness,mounted} from './p4-harness.ts';
import {dialogueData,media,openDialogue,reviewContext} from './voice-fixtures.ts';
let h:Awaited<ReturnType<typeof harness>>;
beforeAll(async()=>{h=await harness();});afterAll(async()=>{await h?.browser.close();await h?.server.close();});
const take={id:'take',projectId:'project',shotId:'shot',dialogueRef:{id:'dialogue',revision:1},voiceRef:{id:'voice-a',revision:1},route:'dubbed-lipsync',video:media,audio:media,reviewRevision:0};
const checks={timbre:'pass',accent:'pass',dialogue:'pass',lipsync:'pass'};
const data=()=>({...dialogueData(),'dialogue.takes':{takes:[take],reviews:[]},'dialogue.reviewContext':{...reviewContext,stale:true,shotRef:{id:'shot',revision:2},voiceRefs:[{id:'voice-a',revision:2},{id:'voice-b',revision:3}],profileRef:{libraryId:'library',id:'sync',revision:4},modelRef:{libraryId:'library',id:'model',revision:5},connectionRef:{libraryId:'library',id:'connection',revision:6}}});
async function open(page:import('@playwright/test').Page){await openDialogue(page);await page.getByRole('button',{name:'配音与口型',exact:true}).click();}
async function choose(page:import('@playwright/test').Page){const review=page.getByRole('region',{name:'对白人工审核'});for(const label of ['音色','口音','台词','口型'])await review.getByLabel(label,{exact:true}).selectOption('pass');}
it('shows current evidence and saves only its displayed context hash after explicit checks',async()=>{
  await mounted(h,async page=>{
    await open(page);await page.getByText('当前声音 voice-b v3',{exact:true}).waitFor();await page.getByText('当前镜头 shot v2',{exact:true}).waitFor();await page.getByText('当前模型 model v5',{exact:true}).waitFor();
    expect(await page.getByRole('button',{name:'保存人工审核'}).isDisabled()).toBe(true);await choose(page);await page.getByRole('button',{name:'保存人工审核'}).click();
    expect(await page.evaluate(()=>window.p4Fixture.calls[0])).toMatchObject({kind:'dialogue.reviewTake',payload:{reviewContextHash:'a'.repeat(64),checks}});
  },data());
});
it('invalidates old choices and late review acknowledgements when current context changes',async()=>{
  await mounted(h,async page=>{
    await open(page);await choose(page);await page.getByRole('button',{name:'保存人工审核'}).click();
    await page.evaluate(context=>window.p4Fixture.update({'dialogue.reviewContext':{...context,contextHash:'b'.repeat(64),shotRef:{id:'shot',revision:3},stale:true}}),reviewContext);
    await expect.poll(()=>page.getByRole('region',{name:'对白人工审核'}).getByLabel('音色',{exact:true}).inputValue()).toBe('');
    await page.evaluate(({take,checks})=>{window.p4Fixture.resolve({takeId:'take',revision:1,checks,notes:''});window.p4Fixture.update({'dialogue.takes':{takes:[{...take,reviewRevision:1}],reviews:[{takeId:'take',revision:1,checks,notes:''}]}});},{take,checks});
    expect(await page.getByRole('button',{name:'保存人工审核'}).isDisabled()).toBe(true);expect(await page.getByRole('button',{name:'采用此 take'}).count()).toBe(0);
    await page.getByRole('button',{name:'读取最新审核基准'}).click();await choose(page);await page.getByRole('button',{name:'保存人工审核'}).click();
    expect(await page.evaluate(()=>window.p4Fixture.calls[1])).toMatchObject({kind:'dialogue.reviewTake',payload:{expectedReviewRevision:1,reviewContextHash:'b'.repeat(64)}});
  },data());
});
it('blocks review and adoption while current evidence is unavailable',async()=>{
  await mounted(h,async page=>{
    await open(page);await page.getByText(/当前审核依据不可用.*当前声音来源缺失/).waitFor();
    expect(await page.getByRole('button',{name:'保存人工审核'}).count()).toBe(0);expect(await page.getByRole('button',{name:'采用此 take'}).count()).toBe(0);expect(await page.evaluate(()=>window.p4Fixture.calls)).toEqual([]);
  },{...data(),__queryErrors:{'dialogue.reviewContext':'当前声音来源缺失'}});
});

it('removes an enabled saved approval on context failure and requires new choices after recovery',async()=>{
  await mounted(h,async page=>{
    await open(page);expect(await page.getByRole('button',{name:'采用此 take'}).isDisabled()).toBe(false);
    await page.evaluate(()=>window.p4Fixture.update({__queryErrors:{'dialogue.reviewContext':'当前媒体不可用'}}));
    await page.getByText(/当前审核依据不可用.*当前媒体不可用/).waitFor();expect(await page.getByRole('button',{name:'采用此 take'}).count()).toBe(0);
    await page.evaluate(()=>window.p4Fixture.update({__queryErrors:{}}));
    await expect.poll(()=>page.getByRole('region',{name:'对白人工审核'}).getByLabel('音色',{exact:true}).inputValue()).toBe('');
    expect(await page.getByRole('button',{name:'采用此 take'}).count()).toBe(0);expect(await page.getByRole('button',{name:'保存人工审核'}).isDisabled()).toBe(true);
    expect(await page.evaluate(()=>window.p4Fixture.calls)).toEqual([]);
  },{...data(),'dialogue.reviewContext':reviewContext,'dialogue.takes':{takes:[{...take,reviewRevision:1}],reviews:[{takeId:'take',revision:1,checks,notes:''}]}});
});

it('has no enabled approval while current context is pending or belongs to another take',async()=>{
  await mounted(h,async page=>{
    await open(page);await page.getByText(/当前审核依据不可用/).waitFor();expect(await page.getByRole('button',{name:'采用此 take'}).count()).toBe(0);
    await page.evaluate(context=>window.p4Fixture.update({'dialogue.reviewContext':{...context,takeId:'foreign-take'}}),reviewContext);
    expect(await page.getByRole('button',{name:'保存人工审核'}).count()).toBe(0);expect(await page.evaluate(()=>window.p4Fixture.calls)).toEqual([]);
  },{...data(),'dialogue.reviewContext':undefined});
});

it('keeps changed-dialogue history explicitly ineligible when its context query rejects',async()=>{
  await mounted(h,async page=>{
    await open(page);await page.getByText('结果基于旧对白修订，只能查看历史，不能采用到当前对白。',{exact:true}).waitFor();
    expect(await page.getByRole('button',{name:'采用此 take'}).count()).toBe(0);expect(await page.getByRole('button',{name:'保存人工审核'}).count()).toBe(0);
    expect(await page.evaluate(()=>window.p4Fixture.calls)).toEqual([]);
  },{...data(),'dialogue.takes':{takes:[{...take,dialogueRef:{id:'dialogue',revision:0}}],reviews:[]},__queryErrors:{'dialogue.reviewContext':'REVISION_CONFLICT · 台词已有新修订。'}});
});
