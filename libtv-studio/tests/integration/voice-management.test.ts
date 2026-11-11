import {expect,it,vi} from 'vitest';
import {audioFixture,audioExecute,audioValue,fixtureWav} from '../fixtures/audio-generation.ts';
import {createVoiceManagementCapability} from '../../apps/desktop/src/main/provider-capability.ts';
async function setup(options:{cloneBody?:unknown;beforeClone?:(s:Awaited<ReturnType<typeof audioFixture>>)=>Promise<void>}={}){
  let s:Awaited<ReturnType<typeof audioFixture>>;
  s=await audioFixture('minimax-speech-v1',{native:true,providerContext:{requestVoiceManagement:async(input,dispatch,operation,bytes)=>{
    if(operation.kind==='clone')await options.beforeClone?.(s);
    s.response(operation.kind==='catalog'?{system_voice:[{voice_id:'system-A',voice_name:'A'}],base_resp:{status_code:0}}:operation.kind==='upload'?Buffer.from('{"file":{"file_id":123456789012345680},"base_resp":{"status_code":0}}'):options.cloneBody??{base_resp:{status_code:0}});
    return createVoiceManagementCapability(s.engine.identity.libraryId,s.vault)(input,dispatch,operation,bytes);
  }}});
  audioValue(await audioExecute(s.engine,'creation.saveEntity',{projectId:s.projectId,id:'a',expectedRevision:0,kind:'character',name:'A',description:'',constraints:'',references:[]}));
  const source=await s.importAudio(fixtureWav(10),'clone.wav');
  return {...s,source};
}
const input=(s:Awaited<ReturnType<typeof setup>>)=>({projectId:s.projectId,entityRef:{id:'a',revision:1},source:s.source,profileRef:s.profileRef,name:'A voice',dialect:'山东话',performanceNotes:'克制',verificationText:'我在这儿。',executionOwner:'human',runId:'clone-a'});
it('fetches the real configured service catalog and retains cache without calling synthesis',async()=>{
  const s=await setup();
  const list=audioValue(await audioExecute(s.engine,'voice.refreshCatalog',{projectId:s.projectId,profileRef:s.profileRef}));
  expect(list.voices[0].id).toBe('system-A');
  expect(s.requests.map(r=>r.url)).toEqual(['/v1/get_voice']);
  const cached=(s.engine as any).voiceManagement.catalog({projectId:s.projectId,profileRef:s.profileRef});
  expect(audioValue(cached).stale).toBe(false);
  expect(s.requests).toHaveLength(1);
});
it('persists upload and clone once with the original int64, leaving voice quality unverified',async()=>{
  const s=await setup();const job=audioValue(await audioExecute(s.engine,'voice.clone.prepare',input(s)));
  expect(s.requests).toHaveLength(0);
  const approval={projectId:s.projectId,jobId:job.jobId,planHash:job.planHash,approval:s.approval};
  const done=audioValue(await audioExecute(s.engine,'voice.clone.approve',approval));
  expect(done.state).toBe('cloned-unverified');
  expect(s.requests.map(r=>r.url)).toEqual(['/v1/files/upload','/v1/voice_clone']);
  expect(s.requests[1]!.body.toString()).toContain('"file_id":123456789012345680');
  expect(JSON.parse(s.requests[1]!.body.toString()).voice_id).toBe(job.candidateVoiceId);
  expect(audioValue(await audioExecute(s.engine,'voice.clone.approve',approval)).candidateVoiceId).toBe(job.candidateVoiceId);
  expect(s.requests).toHaveLength(2);
  expect(audioValue(s.engine.voices.read({projectId:s.projectId,voiceRef:done.voiceRef})).ttsBinding.providerVoiceId).toBe(job.candidateVoiceId);
},120000);
it('does not resubmit unknown clone steps after reopen',async()=>{
  const s=await setup();const job=audioValue(await audioExecute(s.engine,'voice.clone.prepare',input(s)));
  s.cut();
  const approval={projectId:s.projectId,jobId:job.jobId,planHash:job.planHash,approval:s.approval};
  const unknown=audioValue(await audioExecute(s.engine,'voice.clone.approve',approval));expect(unknown.state).toBe('unknown');
  const count=s.requests.length;await s.engine.close();const engine=await s.open();
  const restored=audioValue((engine as any).voiceManagement.get({projectId:s.projectId,jobId:job.jobId}));
  expect(restored.state).toBe('unknown');expect(restored.candidateVoiceId).toBe(job.candidateVoiceId);
  expect(await audioExecute(engine,'voice.clone.approve',approval)).toMatchObject({ok:false,error:{code:'VOICE_CLONE_UNKNOWN'}});
  expect(s.requests).toHaveLength(count);
},120000);

it('verifies a clone with one real speech request and leaves perceptual quality for manual review',async()=>{
 const s=await setup();const job=audioValue(await audioExecute(s.engine,'voice.clone.prepare',input(s)));
 const request={projectId:s.projectId,jobId:job.jobId,planHash:job.planHash,approval:s.approval};
 audioValue(await audioExecute(s.engine,'voice.clone.approve',request));s.response({data:{audio:fixtureWav(1).toString('hex')},base_resp:{status_code:0}});
 const verifying=audioValue(await audioExecute(s.engine,'voice.clone.verify',request));
 expect(verifying.state).toBe('verifying');
 const task=audioValue(s.engine.generation.read(verifying.verificationTaskId));
 expect(audioValue(await s.engine.scheduler.run(task.attemptId)).state).toBe('SUCCEEDED');
 const ready=audioValue((s.engine as any).voiceManagement.get({projectId:s.projectId,jobId:job.jobId}));
 expect(ready.state).toBe('ready');
 expect(s.requests.filter(r=>r.url==='/v1/t2a_v2')).toHaveLength(1);
 expect(JSON.parse(s.requests.at(-1)!.body.toString()).voice_setting.voice_id).toBe(job.candidateVoiceId);
 expect(audioValue(s.engine.voices.read({projectId:s.projectId,voiceRef:ready.voiceRef})).production.ready).toBe(false);
},120000);

it('retains an ambiguous accepted clone and refreshes approval after explicit reconciliation without reuploading',async()=>{
 let now=Date.now();const clock=vi.spyOn(Date,'now').mockImplementation(()=>now);try{
 const s=await setup({cloneBody:{}}),job=audioValue(await audioExecute(s.engine,'voice.clone.prepare',input(s)));
 const request={projectId:s.projectId,jobId:job.jobId,planHash:job.planHash,approval:s.approval};
 const unknown=audioValue(await audioExecute(s.engine,'voice.clone.approve',request));expect(unknown.state).toBe('unknown');expect(unknown.providerFileId).toBe('123456789012345680');
 now=job.prepared.expiresAt+600000;
 const recovered=audioValue(await audioExecute(s.engine,'voice.clone.reconcile',{projectId:s.projectId,jobId:job.jobId,decision:'confirmed-not-submitted',reason:'服务控制台明确确认原克隆未提交'}));
 expect(recovered.candidateVoiceId).toBe(job.candidateVoiceId);expect(recovered.providerFileId).toBe(unknown.providerFileId);expect(recovered.planHash).not.toBe(job.planHash);expect(recovered.prepared.expiresAt).toBeGreaterThan(Date.now());
 expect(await audioExecute(s.engine,'voice.clone.approve',request)).toMatchObject({ok:false,error:{code:'APPROVAL_MISMATCH'}});
 audioValue(await audioExecute(s.engine,'voice.clone.approve',{...request,planHash:recovered.planHash}));
 expect(s.requests.filter(r=>r.url==='/v1/files/upload')).toHaveLength(1);expect(s.requests.filter(r=>r.url==='/v1/voice_clone')).toHaveLength(2);
 }finally{clock.mockRestore();}
},120000);
it('retains a late successful clone under the original character snapshot without changing its default',async()=>{
 const s=await setup({beforeClone:async s=>{audioValue(await audioExecute(s.engine,'creation.saveEntity',{projectId:s.projectId,id:'a',expectedRevision:1,kind:'character',name:'A new',description:'',constraints:'',references:[]}));}});
 const job=audioValue(await audioExecute(s.engine,'voice.clone.prepare',input(s))),request={projectId:s.projectId,jobId:job.jobId,planHash:job.planHash,approval:s.approval};
 const done=audioValue(await audioExecute(s.engine,'voice.clone.approve',request));expect(done.state).toBe('cloned-unverified');expect(done.cloneConfirmedAt).toBeTruthy();
 const voice=audioValue(s.engine.voices.read({projectId:s.projectId,voiceRef:done.voiceRef}));expect(voice.entityRef).toEqual({id:'a',revision:1});expect(audioValue(s.engine.voices.list({projectId:s.projectId})).defaultBindings).toEqual([]);
 expect(s.requests.filter(r=>r.url==='/v1/voice_clone')).toHaveLength(1);
},120000);
