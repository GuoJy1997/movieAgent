import { useState } from 'react';
import type { CanvasContent } from '../../../../../../packages/contracts/src/canvas.ts';
import type { AssetView, MediaReference } from '../../../../../../packages/contracts/src/assets.ts';
import type { ReferenceImageInput } from '../../../../../../packages/contracts/src/generation.ts';
import { Button,Field } from '../../../../../../packages/ui/src/controls.tsx';
import { MediaPreview } from '../assets/MediaPreview.tsx';
type GenerationContent=Extract<CanvasContent,{type:'generation'}>;
export function GenerationInputs({content,assets,locked,onChange}:{content:GenerationContent;assets:AssetView[];locked:boolean;onChange(c:GenerationContent):void}) {
 const [chosen,setChosen]=useState(''),[role,setRole]=useState<ReferenceImageInput['role']>('reference');
 const refs=content.referenceImages??[];
 return <section className="inspector-section"><h3>固定参考图片</h3><p className="hint">按顺序固定原件版本，最多4张。MiniMax 首帧使用自适应画幅；首尾帧与参考模式互斥。适配器会检查尺寸与模式。</p><Field label="参考图片固定版本"><select value={chosen} onChange={e=>setChosen(e.target.value)}><option value="">选择有效资产版本</option>{assets.filter(a=>a.mime.startsWith('image/')&&!a.deletedAt).map(a=><option key={`${a.ref.assetId}:${a.ref.version}`} value={JSON.stringify(a.ref)}>{a.name} · v{a.ref.version}</option>)}</select></Field><Field label="参考角色"><select value={role} onChange={e=>setRole(e.target.value as typeof role)}><option value="reference">参考图</option><option value="first_frame">首帧</option><option value="last_frame">尾帧</option></select></Field><Button disabled={locked||!chosen||refs.length>=4} onClick={()=>onChange({...content,referenceImages:[...refs,{role,ref:JSON.parse(chosen) as MediaReference}]})}>添加固定参考</Button>{refs.map((r,i)=><div className="fixed-reference" key={i}><small>{i+1}. {({reference:'参考图',first_frame:'首帧',last_frame:'尾帧'} as const)[r.role]} · {r.ref.kind==='assetVersion'?`固定版本 v${r.ref.version}`:'固定生成原件'}</small><div className="reference-preview"><MediaPreview media={r.ref} thumbnail /></div><Button disabled={locked} onClick={()=>onChange({...content,referenceImages:refs.filter((_,j)=>i!==j)})}>移除参考 {i+1}</Button></div>)}</section>;
}
