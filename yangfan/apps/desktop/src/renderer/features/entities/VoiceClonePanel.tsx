import {useState,useRef,useEffect} from 'react';
import type {CreationRef} from '../../../../../../packages/contracts/src/creation.ts';
import type {VoiceReference} from '../../../../../../packages/contracts/src/character-voice.ts';
import type {RevisionRef} from '../../../../../../packages/contracts/src/models.ts';
import type {VoiceCloneJob} from '../../../../../../packages/contracts/src/voice-management.ts';
import {Button,Field,QueryState} from '../../../../../../packages/ui/src/controls.tsx';
import {useRuntime,useWorkspaceQuery} from '../../services/runtime.tsx';
import {GenerationApproval} from '../canvas/GenerationApproval.tsx';
export function VoiceClonePanel({projectId,entityRef,source,profileRef,name,dialect,performanceNotes}:{projectId:string;entityRef:CreationRef;source:VoiceReference|null;profileRef:RevisionRef|null;name:string;dialect:string;performanceNotes:string}){
 const runtime=useRuntime(),history=useWorkspaceQuery('voice.clone.list',{projectId});const [jobId,setJobId]=useState(''),[text,setText]=useState('这是我的声音验证，请听听音色和发音。'),[approval,setApproval]=useState<'clone'|'verify'|null>(null),[reason,setReason]=useState('');
 const job=useWorkspaceQuery('voice.clone.get',{projectId,jobId},!!jobId),alive=useRef(true);useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);const value=job.data,locked=runtime.busy||runtime.pending||!runtime.online;
 const labels:Record<VoiceCloneJob['state'],string>={prepared:'待批准上传与克隆',uploading:'上传待回执',uploaded:'已上传，待克隆',cloning:'克隆待回执','cloned-unverified':'已克隆，未验证',verifying:'短句合成验证中',ready:'技术验证成功，人工质量未审',unknown:'结果未知，需核对',failed:'已失败，保留原记录'};
 return <section className="form-stack" aria-label="声音克隆"><h4>声音克隆</h4><p>仅 MiniMax 语音适配器提供克隆。原始样本 10–300 秒，MP3 / M4A / WAV，不超过 20MB；不会把 15 秒参考片段冒充长原件。上传、克隆及验证都使用当前配置的 URL。</p>
 <Field label="克隆验证短句"><textarea value={text} maxLength={4000} onChange={e=>setText(e.target.value)}/></Field>
 <Button disabled={locked||!source||!profileRef||!text.trim()} onClick={async()=>{const result=await runtime.command('voice.clone.prepare',{projectId,entityRef,source:source!.ref,profileRef:profileRef!,name:name+' · 克隆',dialect,performanceNotes,verificationText:text,executionOwner:'desktop-user',runId:crypto.randomUUID()});if(result&&alive.current)setJobId(result.jobId);}}>准备声音克隆计划</Button>
 <Field label="恢复已有克隆任务"><select value={jobId} onChange={e=>{setJobId(e.target.value);setApproval(null);}}><option value="">选择原操作</option>{history.data?.jobs.filter(j=>j.input.entityRef.id===entityRef.id).map(j=><option key={j.jobId} value={j.jobId}>{j.input.name} · {labels[j.state]} · {j.jobId}</option>)}</select></Field><QueryState loading={job.isLoading&&!!jobId} error={job.error}/>
 {value&&<><p>{labels[value.state]} · {value.diagnostic??''}</p><p>原样本 hash {value.source.hash} · 文件 ID {value.providerFileId??'尚未取得'} · 固定候选 {value.candidateVoiceId}</p><p>声音 {value.voiceRef?value.voiceRef.id+' v'+value.voiceRef.revision:'尚未保存'}；不会覆盖当前默认绑定。</p>
 {['prepared','uploaded'].includes(value.state)&&<Button disabled={locked} onClick={()=>setApproval('clone')}>确认上传与克隆费用范围</Button>}
 {value.state==='cloned-unverified'&&<Button disabled={locked} onClick={()=>setApproval('verify')}>用原音色验证一次短句</Button>}
 {['unknown','uploading','cloning','prepared','uploaded'].includes(value.state)&&<><Button disabled={locked} onClick={()=>void runtime.command('voice.clone.reconcile',{projectId,jobId:value.jobId,decision:'check-only',reason:''})}>核对原操作，保持不重发</Button><Field label="服务控制台核对说明"><textarea maxLength={2000} value={reason} onChange={e=>setReason(e.target.value)}/></Field><Button disabled={locked||!reason.trim()} onClick={()=>void runtime.command('voice.clone.reconcile',{projectId,jobId:value.jobId,decision:'confirmed-not-submitted',reason})}>确认原步骤未提交，允许重新批准</Button></>}
 </>}
 {approval&&value&&<GenerationApproval key={value.planHash+approval} prepared={{...value.prepared,estimateMicros:null,currency:null}} summary={<><p>{approval==='clone'?'上传原样本并克隆；费用未知。短句验证会单独确认。':'只使用已克隆的原候选 ID 合成一次验证音频，不重新上传或克隆。'}</p><p>{value.input.verificationText} · {value.candidateVoiceId} · {value.prepared.config.connection.baseUrl}</p></>} onClose={()=>setApproval(null)} onApprove={async input=>{const result=await runtime.command(approval==='clone'?'voice.clone.approve':'voice.clone.verify',{projectId,jobId:value.jobId,planHash:value.planHash,approval:{currency:input.currency,allowanceMicros:input.allowanceMicros,budgetLimitMicros:input.budgetLimitMicros,acknowledgeUnknown:input.acknowledgeUnknown}});if(result&&alive.current)setApproval(null);return result;}}/>}
 </section>;
}
