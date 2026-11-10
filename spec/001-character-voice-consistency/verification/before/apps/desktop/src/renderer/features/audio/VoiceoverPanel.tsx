import { useEffect, useRef, useState } from 'react';
import type { ShotDialogueRevision } from '../../../../../../packages/contracts/src/character-voice.ts';
import type { AudioBatchPlan } from '../../../../../../packages/contracts/src/audio.ts';
import type { VoiceoverContext, VoiceoverReviewInput, VoiceoverReview } from '../../../../../../packages/contracts/src/voiceover.ts';
import { Button, Field, QueryState } from '../../../../../../packages/ui/src/controls.tsx';
import { useRuntime, useWorkspaceQuery } from '../../services/runtime.tsx';
import { GenerationApproval } from '../canvas/GenerationApproval.tsx';
import { MediaPreview } from '../assets/MediaPreview.tsx';
import { useRevisionDraft } from '../creation/useRevisionDraft.ts';
import { useOwnedDraft } from '../../state/DraftNavigationGuard.tsx';

export function VoiceoverPanel({projectId,dialogue}:{projectId:string;dialogue:ShotDialogueRevision}) {
  const runtime=useRuntime(),voices=useWorkspaceQuery('voice.list',{projectId}),audio=useWorkspaceQuery('audio.read',{projectId}),current=useWorkspaceQuery('dialogue.read',{projectId,shotId:dialogue.shotRef.id});
  const [plan,setPlan]=useState<AudioBatchPlan|null>(null),[batchId,setBatchId]=useState(''),[busy,setBusy]=useState(false);
  const batch=useWorkspaceQuery('audio.batch',{projectId,planId:batchId},!!batchId),alive=useRef(true),intent=useRef(0);
  const sourceKey=JSON.stringify([projectId,dialogue.id,dialogue.revision,current.data?.current?.revision,voices.data?.voices.map(v=>[v.id,v.revision,v.ttsProfileRef])]),key=useRef(sourceKey);key.current=sourceKey;
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;intent.current++;};},[]);
  const refs=dialogue.turns.map(turn=>voices.data?.voices.find(v=>v.id===turn.voiceRef.id&&v.revision===turn.voiceRef.revision)?.ttsProfileRef);
  const stale=current.data?.current?.id!==dialogue.id||current.data.current.revision!==dialogue.revision;
  const locked=runtime.busy||runtime.pending||!runtime.online||busy||stale;
  return <section aria-label="独立旁白配音" className="form-stack"><h3>独立旁白配音</h3><p>每句使用角色声音中保存的 TTS 预设。逐条试听审核音色、口音和台词后，再到「剪辑成片 → 声音与字幕」分析并插入独立配音轨。口型不适用；此路线不使用视频试镜的三情绪与角色组合记录。</p>
    {dialogue.turns.map((turn,i)=><p key={turn.turnId}>{turn.text} · 声音 {turn.voiceRef.id} v{turn.voiceRef.revision} · {refs[i]?`TTS ${refs[i]!.id} v${refs[i]!.revision}`:'请在角色声音档案选择 TTS 预设，保存后更新对白声音修订'} · 镜头内起点 {turn.startTicks/48000}秒</p>)}
    {stale&&<p role="alert">对白已有新修订，请重新读取并核对。</p>}
    <Button disabled={locked||refs.some(ref=>!ref)} onClick={async()=>{
      const token=++intent.current,captured=key.current;setBusy(true);setPlan(null);
      const valid=()=>alive.current&&token===intent.current&&captured===key.current;
      try{const lines=[];
        for(const [i,turn] of dialogue.turns.entries()){
          const existing=audio.data?.voiceLines.find(line=>line.dialogueSource?.dialogueRef.id===dialogue.id&&line.dialogueSource.dialogueRef.revision===dialogue.revision&&line.dialogueSource.turnId===turn.turnId);
          const line=existing??await runtime.command('audio.saveVoiceLine',{projectId,id:crypto.randomUUID(),expectedRevision:0,text:turn.text,shotRef:{libraryId:dialogue.libraryId,...dialogue.shotRef},entityRef:{libraryId:dialogue.libraryId,...turn.characterRef},dialogueSource:{dialogueRef:{id:dialogue.id,revision:dialogue.revision},turnId:turn.turnId,voiceRef:turn.voiceRef}});
          if(!line||!valid())return;lines.push({lineId:line.id,revision:line.revision,profileRef:refs[i]!});
        }
        const result=await runtime.command('audio.prepareSpeech',{projectId,lines,executionOwner:'desktop-user',runId:crypto.randomUUID()});if(result&&valid())setPlan(result);
      }finally{if(alive.current)setBusy(false);}
    }}>固定台词并准备旁白批次</Button>
    {plan&&<GenerationApproval key={plan.planHash} confirmLabel="批准旁白配音批次" prepared={{...plan.items[0]!.prepared,estimateMicros:plan.estimateMicros,currency:plan.currency}} summary={<>{plan.items.map(item=><p key={item.lineId}>{item.prepared.prompt} · {item.prepared.config.profile.name} · voice {String(item.prepared.config.parameters.voice??'默认')}</p>)}</>} onClose={()=>setPlan(null)} onApprove={async input=>{if(stale)return;const result=await runtime.command('audio.approveSpeech',{planId:plan.planId,planHash:plan.planHash,executionOwner:plan.executionOwner,runId:plan.runId,approval:{currency:input.currency,allowanceMicros:input.allowanceMicros,budgetLimitMicros:input.budgetLimitMicros,acknowledgeUnknown:input.acknowledgeUnknown}});if(result&&alive.current)setBatchId(plan.planId);return result;}}/>}
    {batch.data&&<p>旁白批次 {batch.data.state}<Button disabled={locked||batch.data.state==='stopped'} onClick={()=>void runtime.command('audio.stopBatch',{projectId,planId:batch.data!.plan.planId,executionOwner:batch.data!.plan.executionOwner})}>停止旁白批次</Button></p>}
    {audio.data?.takes.filter(take=>audio.data!.voiceLines.some(line=>line.id===take.lineId&&line.revision===take.lineRevision&&line.dialogueSource?.dialogueRef.id===dialogue.id)).map(take=><VoiceoverReviewPanel key={take.id} projectId={projectId} takeId={take.id}/>)}
  </section>;
}

export function VoiceoverReviewPanel({projectId,takeId,onAdopt}:{projectId:string;takeId:string;onAdopt?:()=>void}) {
  const context=useWorkspaceQuery('audio.voiceoverContext',{projectId,takeId});
  return <section aria-label="旁白人工审核" className="creation-reference"><QueryState loading={context.isLoading} error={context.error}/>{context.data&&<Review key={`${projectId}/${takeId}/${context.data.contextHash}`} context={context.data} onAdopt={onAdopt}/>}</section>;
}
function Review({context,onAdopt}:{context:VoiceoverContext;onAdopt?:()=>void}){
  const runtime=useRuntime();
  const make=(review?:VoiceoverReview|null)=>({expectedRevision:0,checks:review?.contextHash===context.contextHash?review.checks:{} as Partial<VoiceoverReviewInput['checks']>,notes:review?.contextHash===context.contextHash?review.notes:''});
  const draft=useRevisionDraft(()=>make(context.review)),{checks,notes}=draft.draft;
  const complete=Object.values(checks).filter(Boolean).length===3;
  const persist=()=>complete?draft.save(value=>runtime.command('audio.reviewVoiceover',{projectId:context.projectId,takeId:context.take.id,contextHash:context.contextHash,checks:value.checks as VoiceoverReviewInput['checks'],notes:value.notes}),make,()=>{}):Promise.resolve(false);
  useOwnedDraft({dirty:draft.dirty||draft.saving,save:persist,discard:()=>draft.reload(make(context.review))},draft.draft);
  const passed=context.review?.contextHash===context.contextHash&&Object.values(context.review.checks).every(value=>value==='pass');
  return <><p>{context.line.text} · 对白 v{context.line.dialogueSource!.dialogueRef.revision} · TTS {context.take.profileRef.id} v{context.take.profileRef.revision}</p><MediaPreview media={context.take.output} original/><p>口型：不适用。音色、口音和台词由人工逐项试听确认。</p>
    {(['timbre','accent','dialogue'] as const).map((kind,i)=><Field key={kind} label={`旁白${['音色','口音','台词'][i]}`}><select value={checks[kind]??''} onChange={e=>draft.change({checks:{...checks,[kind]:e.target.value}})}><option value="">请选择</option><option value="pass">通过</option><option value="needs-fix">需修正</option></select></Field>)}
    <Field label="旁白审核备注"><textarea maxLength={2000} value={notes} onChange={e=>draft.change({notes:e.target.value})}/></Field>
    <Button disabled={draft.saving||runtime.busy||runtime.pending||!runtime.online||!complete} onClick={()=>void persist()}>保存旁白人工审核</Button>
    <p>{passed?'当前旁白结果已完成人工审核，可明确插入独立配音轨。':'当前旁白结果尚未通过审核。'}</p>{onAdopt&&<Button disabled={!passed||draft.dirty||draft.saving} onClick={onAdopt}>分析并选择插入配音轨</Button>}
  </>;
}
