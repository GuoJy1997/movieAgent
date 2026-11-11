import {beforeAll,afterAll,it,expect} from 'vitest';
import {harness,mounted,calls} from './p4-harness.ts';
import {agentData} from './yangfan-fixtures.ts';
let h:Awaited<ReturnType<typeof harness>>;
beforeAll(async()=>{h=await harness();},30000);afterAll(async()=>{await h.browser.close();await h.server.close();});
it('opens skills and preferences, returns focus, and prepares without approving',async()=>{
 await mounted(h,async page=>{
  await page.getByRole('button',{name:'技能',exact:true}).click();
  expect(await page.getByRole('dialog',{name:'创作技能'}).count()).toBe(1);
  await page.keyboard.press('Escape');
  expect(await page.getByRole('button',{name:'技能',exact:true}).evaluate(el=>el===document.activeElement)).toBe(true);
  await page.getByRole('button',{name:'偏好',exact:true}).click();
  await page.getByLabel('输出 token 预算（留空沿用预设）').fill('512');
  await page.keyboard.press('Escape');
  await page.getByLabel('创作需求',{exact:true}).fill('把开场写得更自然');
  await page.getByLabel('创作需求',{exact:true}).press('Control+Enter');
  await calls(page,1);
  expect(await page.evaluate(()=>window.p4Fixture.calls[0])).toMatchObject({kind:'agent.prepareTurn',payload:{message:'把开场写得更自然',outputTokens:512}});
 },agentData());
});
it('keeps IME composition and ordinary Enter from submitting',async()=>{
 await mounted(h,async page=>{
  const input=page.getByLabel('创作需求',{exact:true});
  await input.fill('海边');
  await input.press('Enter');
  expect(await input.inputValue()).toContain('\n');
  await input.evaluate(el=>{el.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true}));el.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',ctrlKey:true,isComposing:true,bubbles:true}));});
  expect(await page.evaluate(()=>window.p4Fixture.calls.length)).toBe(0);
 },agentData());
});