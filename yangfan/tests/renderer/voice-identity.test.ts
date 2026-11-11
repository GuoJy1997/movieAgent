import {beforeAll,afterAll,expect,it} from 'vitest';
import {voice,media,dialogue} from './voice-fixtures.ts';
import {harness,mounted,queries} from './p4-harness.ts';
let h:Awaited<ReturnType<typeof harness>>;beforeAll(async()=>{h=await harness();});afterAll(async()=>{await h?.browser.close();await h?.server.close();});
it('saves a provider voice without a sample or API call, preserving spaces and parentheses',async()=>{
 const ref={libraryId:'library',id:'speech',revision:1};
 await mounted(h,async page=>{
 await page.getByRole('button',{name:'编辑 角色 A',exact:true}).click();await page.getByRole('button',{name:'声音档案',exact:true}).click();
 await page.getByLabel('声音来源',{exact:true}).selectOption('provider-voice');await page.getByLabel('声音名称',{exact:true}).fill('我的音色');await page.getByLabel('旁白 TTS 预设',{exact:true}).selectOption('speech:1');
 await page.getByLabel('服务 voice ID',{exact:true}).fill('Speaker A (regional)');await page.getByRole('button',{name:'保存声音档案',exact:true}).click();
 expect(await page.evaluate(()=>window.p4Fixture.calls)).toHaveLength(1);expect(await page.evaluate(()=>window.p4Fixture.calls[0])).toMatchObject({kind:'voice.save',payload:{draft:{reference:null,sourceKind:'provider-voice',ttsBinding:{providerVoiceId:'Speaker A (regional)',profileRef:ref}}}});
 },{...queries(),__entity:true,'creation.read':{entities:[{id:'a',revision:1,kind:'character',name:'角色 A',description:'',constraints:'',references:[]}],shots:[],scripts:[],selections:[]},'voice.list':{voices:[],defaultBindings:[]},'profile.list':{profiles:[{...ref,name:'Speech',modelRef:ref,parameters:{}}]},'model.list':{models:[{...ref,connectionRef:ref,capabilities:{taskTypes:['text_to_speech']}}]}});
});

it('keeps a pinned historical voice available for dialogue speech preparation',async()=>{
 const ref={libraryId:'library',id:'speech',revision:1};
 await mounted(h,async page=>{
 expect(await page.getByRole('button',{name:'固定台词并准备旁白批次',exact:true}).isDisabled()).toBe(false);
 await page.getByRole('button',{name:'固定台词并准备旁白批次',exact:true}).click();
 expect(await page.evaluate(()=>window.p4Fixture.calls[0])).toMatchObject({kind:'audio.saveVoiceLine',payload:{dialogueSource:{voiceRef:{id:'voice-a',revision:1}}}});
 },{...queries(),__voiceover:dialogue,'dialogue.read':{current:dialogue},'voice.list':{voices:[{...voice,revision:2}]},'voice.history':{voices:[{...voice,ttsProfileRef:ref},{...voice,revision:2,ttsProfileRef:ref}]}});
});
it('clears an old derived video reference when choosing a replacement source sample',async()=>{
 const other={...media,assetId:'replacement'};
 await mounted(h,async page=>{
 await page.getByRole('button',{name:'编辑 角色 A',exact:true}).click();await page.getByRole('button',{name:'声音档案',exact:true}).click();await page.getByLabel('现有声音修订').selectOption(voice.id);
 await page.getByLabel('固定音频',{exact:true}).selectOption('replacement:1');
 await page.evaluate(ref=>window.p4Fixture.resolve({ref,hash:'b'.repeat(64),probe:{probeId:'new-probe',durationTicks:96000}}),other);
 await page.getByRole('button',{name:'保存声音档案',exact:true}).click();
 const saved=await page.evaluate(()=>window.p4Fixture.calls[1]);expect(saved).toMatchObject({kind:'voice.save',payload:{draft:{reference:{ref:other},sourceSample:{ref:other}}}});expect((saved!.payload.draft as any).videoReference).toBeUndefined();
 },{...queries(),__entity:true,__localMedia:[media,other],'creation.read':{entities:[{id:'a',revision:1,kind:'character',name:'角色 A',description:'',constraints:'',references:[]}],shots:[],scripts:[],selections:[]},'voice.list':{voices:[{...voice,videoReference:voice.reference}]},'asset.search':{assets:[{ref:other,name:'New.wav'}]}});
});
it('explicitly replaces the preferred video reference with the chosen audition output',async()=>{
 const output={kind:'artifact',libraryId:'library',artifactId:'voice-take'},ref={libraryId:'library',id:'speech',revision:1};
 await mounted(h,async page=>{
 await page.getByRole('button',{name:'将此输出绑定为视频声音参考新版本',exact:true}).click();
 await page.evaluate(ref=>window.p4Fixture.resolve({ref,hash:'c'.repeat(64),probe:{probeId:'new-probe',durationTicks:96000}}),output);
 await page.waitForFunction(()=>window.p4Fixture.calls.length===2);
 expect(await page.evaluate(()=>window.p4Fixture.calls[1])).toMatchObject({kind:'voice.save',payload:{draft:{videoReference:{ref:output,hash:'c'.repeat(64)},reference:{ref:output}}}});
 },{...queries(),__auditions:{...voice,ttsProfileRef:ref,videoReference:voice.reference},'audio.read':{voiceLines:[{id:'line',revision:1,voiceRef:{id:voice.id,revision:1}}],takes:[{id:'take',lineId:'line',lineRevision:1,output}],transcripts:[],diagnostics:[]}});
});

it('changes only the explicitly checked dialogue scope from the usage preview',async()=>{
 await mounted(h,async page=>{
 await page.getByRole('button',{name:'编辑 角色 A',exact:true}).click();await page.getByRole('button',{name:'声音档案',exact:true}).click();await page.getByLabel('现有声音修订').selectOption(voice.id);
 await page.getByText('使用位置：2 个当前镜头 · 2 句',{exact:true}).click();await page.getByLabel(/更换对白 dialogue v1/).check();
 await page.getByRole('button',{name:'为所选 1 份对白创建换声修订',exact:true}).click();
 expect(await page.evaluate(()=>window.p4Fixture.calls[0])).toMatchObject({kind:'voice.replaceDialogues',payload:{characterId:'a',voiceRef:{id:voice.id,revision:1},dialogueRefs:[{id:'dialogue',revision:1}]}});
 },{...queries(),__entity:true,'creation.read':{entities:[{id:'a',revision:1,kind:'character',name:'角色 A',description:'',constraints:'',references:[]}],shots:[],scripts:[],selections:[]},'voice.list':{voices:[voice],dialogues:[dialogue,{...dialogue,id:'dialogue2',shotRef:{id:'shot2',revision:1}}]}});
});
it('reopens an unknown clone and only checks its original operation without a new upload',async()=>{
 const ref={libraryId:'library',id:'speech',revision:1},job={jobId:'clone-job',state:'unknown',input:{entityRef:{id:'a',revision:1},name:'Saved clone'},source:{hash:'a'.repeat(64)},candidateVoiceId:'Original_candidate',providerFileId:'123456789012345680',voiceRef:null,diagnostic:'VOICE_CLONE_UNKNOWN'};
 await mounted(h,async page=>{
 await page.getByRole('button',{name:'编辑 角色 A',exact:true}).click();await page.getByRole('button',{name:'声音档案',exact:true}).click();await page.getByLabel('现有声音修订').selectOption(voice.id);
 await page.getByLabel('恢复已有克隆任务').selectOption(job.jobId);expect(await page.evaluate(()=>window.p4Fixture.calls)).toEqual([]);
 await page.getByRole('button',{name:'核对原操作，保持不重发',exact:true}).click();expect(await page.evaluate(()=>window.p4Fixture.calls)).toEqual([{kind:'voice.clone.reconcile',payload:{projectId:'project',jobId:job.jobId,decision:'check-only',reason:''}}]);
 },{...queries(),__entity:true,'creation.read':{entities:[{id:'a',revision:1,kind:'character',name:'角色 A',description:'',constraints:'',references:[]}],shots:[],scripts:[],selections:[]},'voice.list':{voices:[{...voice,ttsProfileRef:ref}]},'voice.clone.list':{jobs:[job]},'voice.clone.get':job});
});
