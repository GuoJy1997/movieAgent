import { useState } from 'react';
import type { CanvasContent } from '../../../../../../packages/contracts/src/canvas.ts';
import type { ModelDefinition,ModelProfile,ParameterValue } from '../../../../../../packages/contracts/src/models.ts';
import { Button,Field } from '../../../../../../packages/ui/src/controls.tsx';
import { useRuntime } from '../../services/runtime.tsx';
import { ParameterFields } from '../models/ParameterFields.tsx';
type GenerationContent=Extract<CanvasContent,{type:'generation'}>;
type Props={content:GenerationContent;profiles:ModelProfile[];models:ModelDefinition[];locked:boolean;onChange(c:GenerationContent):void};
export function NodeParameters({content,profiles,models,locked,onChange}:Props) {
 const profile=profiles.find(p=>p.libraryId===content.profileRef.libraryId&&p.id===content.profileRef.id&&p.revision===content.profileRef.revision),model=models.find(m=>m.libraryId===profile?.modelRef.libraryId&&m.id===profile?.modelRef.id&&m.revision===profile?.modelRef.revision);
 if(!profile||!model)return <p className="hint">正在读取固定预设参数…</p>;
 return <ParameterEditor key={JSON.stringify([profile.libraryId,profile.id,profile.revision,model.id,model.revision])} content={content} profile={profile} model={model} locked={locked} onChange={onChange}/>;
}
function ParameterEditor({content,profile,model,locked,onChange}:Pick<Props,'content'|'locked'|'onChange'>&{profile:ModelProfile;model:ModelDefinition}) {
 const [parameters,setParameters]=useState<Record<string,ParameterValue>>(profile.parameters),[name,setName]=useState('节点参数');const runtime=useRuntime();
 return <details className="inspector-section"><summary>节点模式与参数 · {model.capabilities.outputKinds[0]}</summary><p className="hint">保存为独立项目预设，再保存节点内容。全局文件默认参数保持独立。</p><ParameterFields model={model} parameters={parameters} onChange={setParameters}/><Field label="节点预设名称"><input value={name} maxLength={120} onChange={e=>setName(e.target.value)}/></Field><Button disabled={locked||!name.trim()} onClick={async()=>{const ref=await runtime.command('profile.save',{id:crypto.randomUUID(),expectedRevision:0,name,modelRef:profile.modelRef,parameters});if(ref)onChange({...content,profileRef:ref});}}>保存节点参数为项目预设</Button></details>;
}
