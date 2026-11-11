import { useState } from 'react';
import type { MediaReference } from '../../../../../../packages/contracts/src/assets.ts';
import type { CreationKind, EntityRevision, EntityRef } from '../../../../../../packages/contracts/src/creation.ts';
import { Button, Field, QueryState } from '../../../../../../packages/ui/src/controls.tsx';
import { Dialog } from '../../../../../../packages/ui/src/overlays.tsx';
import { useWorkspaceQuery } from '../../services/runtime.tsx';
export const refLabel=(r:MediaReference)=>r.kind==='assetVersion'?`${r.assetId} · v${r.version}`:r.artifactId;
export function TextField({label,value,onChange,max=2000,large=false,required=false}:{label:string;value:string;onChange(v:string):void;max?:number;large?:boolean;required?:boolean}){
 return <Field label={label}>{large?<textarea rows={4} value={value} onChange={e=>onChange(e.target.value)} maxLength={max} required={required}/>:<input value={value} onChange={e=>onChange(e.target.value)} maxLength={max} required={required}/>}</Field>;
}
export function AssetPicker({value,onChange,max=4}:{value:MediaReference[];onChange(v:MediaReference[]):void;max?:number}){
 const assets=useWorkspaceQuery('asset.search',{state:'active',latestOnly:false});const [selected,setSelected]=useState('');
 return <div className="form-stack"><QueryState loading={assets.isLoading} error={assets.error}/><Field label="素材固定版本"><select value={selected} onChange={e=>setSelected(e.target.value)}><option value="">选择已导入素材</option>{assets.data?.assets.map(a=><option key={`${a.ref.assetId}:${a.ref.version}`} value={`${a.ref.assetId}:${a.ref.version}`}>{a.name} · v{a.ref.version} · {a.mime}</option>)}</select></Field><Button disabled={!selected||value.length>=max} onClick={()=>{const asset=assets.data?.assets.find(a=>`${a.ref.assetId}:${a.ref.version}`===selected);if(asset&&!value.some(r=>JSON.stringify(r)===JSON.stringify(asset.ref)))onChange([...value,asset.ref]);}}>加入固定素材</Button>{value.map((ref,i)=><div className="creation-reference" key={JSON.stringify(ref)}><span>{refLabel(ref)}</span><Button tone="quiet" onClick={()=>onChange(value.filter((_,n)=>n!==i))}>移除素材 {i+1}</Button></div>)}</div>;
}
function EntityVersion({entity,onChoose}:{entity:EntityRevision;onChoose(r:EntityRef):void}){
 const query=useWorkspaceQuery('creation.history',{projectId:entity.projectId,kind:'entity',id:entity.id});const [revision,setRevision]=useState(entity.revision);
 return <div className="creation-reference"><Field label={`${entity.name} 固定修订`}><select value={revision} onChange={e=>setRevision(Number(e.target.value))}>{query.data?.kind==='entity'?query.data.revisions.map(r=><option key={r.revision} value={r.revision}>v{r.revision} · {r.name}</option>):<option value={entity.revision}>v{entity.revision}</option>}</select></Field><Button onClick={()=>onChoose({libraryId:entity.libraryId,projectId:entity.projectId,entityId:entity.id,revision})}>引用 {entity.name}</Button></div>;
}
export function EntityPicker({entities,value,onChange}:{entities:EntityRevision[];value:EntityRef[];onChange(v:EntityRef[]):void}){
 return <details><summary>固定实体引用 · {value.length}/8</summary>{value.map((r,i)=>{const current=entities.find(e=>e.id===r.entityId);return <div className="creation-reference" key={`${r.entityId}-${r.revision}`}><span>{current?.name??r.entityId} · 固定 v{r.revision}{current&&current.revision>r.revision?' · 有新修订，未自动替换':''}</span><Button tone="quiet" onClick={()=>onChange(value.filter((_,n)=>n!==i))}>移除实体 {i+1}</Button></div>;})}{entities.map(e=><EntityVersion key={e.id} entity={e} onChoose={r=>{if(value.length<8&&!value.some(v=>v.entityId===r.entityId&&v.revision===r.revision))onChange([...value,r]);}}/>)}</details>;
}
export function CreationHistoryDialog({projectId,kind,id,onClose}:{projectId:string;kind:CreationKind;id:string;onClose():void}){
 const q=useWorkspaceQuery('creation.history',{projectId,kind,id});return <Dialog title="内容修订历史" onClose={onClose} wide><QueryState loading={q.isLoading} error={q.error}/>{q.data?.revisions.slice().reverse().map(r=><article className="creation-card" key={r.revision}><h3>{'name' in r?r.name:r.title} · v{r.revision}</h3><p>{new Date(r.createdAt).toLocaleString('zh-CN')}</p>{'body' in r?<><p>{r.synopsis}</p><pre>{r.body}</pre>{r.scenes.map(s=><p key={s.id}>{s.title} · {s.location} · {s.time} · {s.description}</p>)}</>:'description' in r?<><p>{r.description}</p><p>约束：{r.constraints}</p>{r.references.map(ref=><p key={JSON.stringify(ref)}>{refLabel(ref)}</p>)}</>:<><p>{r.durationSeconds}秒 · {r.shotSize} · {r.cameraMovement} · {r.aspectRatio}</p><p>{r.subject} · {r.action}</p><p>台词：{r.dialogue} · 声音：{r.sound}</p><pre>{r.prompt}</pre><p>实体：{r.entityRefs.map(e=>`${e.entityId} v${e.revision}`).join('、')}</p></>}</article>)}</Dialog>;
}
