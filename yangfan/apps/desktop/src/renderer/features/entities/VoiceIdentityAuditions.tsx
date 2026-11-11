import {useState,useEffect,useRef} from 'react';
import type {CharacterVoiceRevision} from '../../../../../../packages/contracts/src/character-voice.ts';
import type {AudioBatchPlan} from '../../../../../../packages/contracts/src/audio.ts';
import {Button,Field,QueryState} from '../../../../../../packages/ui/src/controls.tsx';
import {useRuntime,useWorkspaceQuery} from '../../services/runtime.tsx';
import {GenerationApproval} from '../canvas/GenerationApproval.tsx';
import {VoiceoverReviewPanel} from '../audio/VoiceoverPanel.tsx';
import {MediaPreview} from '../assets/MediaPreview.tsx';
export function VoiceIdentityAuditions({projectId,voice}:{projectId:string;voice:CharacterVoiceRevision}){
 const runtime=useRuntime(),profileRef=voice.ttsBinding?.profileRef??voice.ttsProfileRef,voiceRef={id:voice.id,revision:voice.revision};
 const audio=useWorkspaceQuery('audio.read',{projectId}),status=useWorkspaceQuery('voice.qualification',{projectId,voiceRef,profileRef:profileRef??{libraryId:'none',id:'none',revision:1}},!!profileRef);
 const [emotion,setEmotion]=useState<'calm'|'excited'|'quiet'>('calm'),[text,setText]=useState('今天咱们慢慢说，把这件事情讲清楚。'),[plan,setPlan]=useState<AudioBatchPlan|null>(null),[batchId,setBatchId]=useState('');
 const batch=useWorkspaceQuery('audio.batch',{projectId,planId:batchId},!!batchId),alive=useRef(true),intent=useRef(0);useEffect(()=>{alive.current=true;return()=>{alive.current=false;intent.current++;};},[]);
 const locked=!runtime.online||runtime.busy||runtime.pending;
 const takes=audio.data?.takes.filter(t=>audio.data!.voiceLines.some(l=>l.id===t.lineId&&l.revision===t.lineRevision&&l.voiceRef?.id===voice.id&&l.voiceRef.revision===voice.revision))??[];
 return <section className="form-stack" aria-label="角色音频试听"><h4>声音资格试听</h4><p>平静、激动、低声分别生成一条音频，人工检查音色、口音、台词。口型不适用。当前 TTS 适配器未映射口音、表演与情绪参数；请选择实际支持这些表达的音色，并评价实际输出。</p>
 {voice.baselineAudio&&<><p>固定基准音频</p><MediaPreview media={voice.baselineAudio.ref} original/></>}
 <QueryState loading={status.isLoading&&!!profileRef} error={status.error}/><p>{status.data?.allowed?'三情绪试听已通过':'尚缺试听：'+(status.data?.missing.join('、')??'未配置 TTS')}</p>
 <Field label="试听情绪"><select value={emotion} onChange={e=>{intent.current++;setPlan(null);setEmotion(e.target.value as typeof emotion);}}><option value="calm">平静</option><option value="excited">激动</option><option value="quiet">低声</option></select></Field>
 <Field label="试听短句"><textarea maxLength={4000} value={text} onChange={e=>{intent.current++;setPlan(null);setText(e.target.value);}}/></Field>
 <Button disabled={locked||!profileRef||!text.trim()} onClick={async()=>{const token=++intent.current;const result=await runtime.command('voice.prepareAudition',{projectId,voiceRef,profileRef:profileRef!,emotion,text,executionOwner:'desktop-user',runId:crypto.randomUUID()});if(result&&alive.current&&intent.current===token)setPlan(result);}}>准备单条音频试听</Button>
 {plan&&<GenerationApproval key={plan.planHash} prepared={plan.items[0]!.prepared} summary={<p>{plan.items[0]!.prepared.prompt} · 实际 voice {String(plan.items[0]!.prepared.config.parameters.voice)} · 缺少映射 {plan.items[0]!.prepared.voiceIdentity?.unmappedFields.join('、')}</p>} onClose={()=>setPlan(null)} onApprove={async input=>{const result=await runtime.command('audio.approveSpeech',{planId:plan.planId,planHash:plan.planHash,executionOwner:plan.executionOwner,runId:plan.runId,approval:{currency:input.currency,allowanceMicros:input.allowanceMicros,budgetLimitMicros:input.budgetLimitMicros,acknowledgeUnknown:input.acknowledgeUnknown}});if(result&&alive.current){setBatchId(plan.planId);setPlan(null);}return result;}}/>}
 {batch.data&&<p>试听任务：{batch.data.state} {batch.data.tasks.map(t=>t.diagnostic??'').join(' ')}</p>}
 {takes.map(t=><section key={t.id}><VoiceoverReviewPanel projectId={projectId} takeId={t.id}/><Button disabled={locked} onClick={async()=>{const resolved=await runtime.command('media.inspect',{projectId,reference:t.output});if(!resolved?.probe)return;const {id,revision,libraryId,projectId:ignored,production,createdAt,...draft}=voice;await runtime.command('voice.save',{projectId,id,expectedRevision:revision,draft:{...draft,baselineAudio:{ref:resolved.ref,hash:resolved.hash,probeId:resolved.probe.probeId,sourceInTicks:0,durationTicks:resolved.probe.durationTicks}}});}}>将此输出保存为基准音频新版本</Button><Button disabled={locked} onClick={async()=>{const resolved=await runtime.command('media.inspect',{projectId,reference:t.output});if(!resolved?.probe)return;const {id,revision,libraryId,projectId:ignored,production,createdAt,...draft}=voice;await runtime.command('voice.save',{projectId,id,expectedRevision:revision,draft:{...draft,videoReference:{ref:resolved.ref,hash:resolved.hash,probeId:resolved.probe.probeId,sourceInTicks:0,durationTicks:resolved.probe.durationTicks},reference:{ref:resolved.ref,hash:resolved.hash,probeId:resolved.probe.probeId,sourceInTicks:0,durationTicks:resolved.probe.durationTicks}}});}}>将此输出绑定为视频声音参考新版本</Button></section>)}
 </section>;
}
