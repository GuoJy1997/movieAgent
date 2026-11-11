import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import {NodeParameters} from '../../../../apps/desktop/src/renderer/features/canvas/NodeParameters.tsx';
import {adapterDefaults} from '../../../../packages/domain/src/model-config.ts';
import type {ModelDefinition,ModelProfile} from '../../../../packages/contracts/src/models.ts';
const ref=(id:string)=>({libraryId:'fixture',id,revision:1});
const models:ModelDefinition[]=['text','video'].map(kind=>({...adapterDefaults(kind==='text'?'openai-chat-v1':'minimax-video-v2'),...ref(kind),name:kind,modelId:kind,connectionRef:ref('connection'),createdAt:'2026-10-26T00:00:00Z'}));
const profiles:Record<string,ModelProfile>={text:{...ref('text-profile'),name:'Text 128',modelRef:ref('text'),parameters:{max_tokens:128},createdAt:'2026-10-26T00:00:00Z'},video:{...ref('video-profile'),name:'Video adaptive',modelRef:ref('video'),parameters:{duration:8,resolution:'768P',ratio:'adaptive'},createdAt:'2026-10-26T00:00:00Z'}};
function Fixture(){
 const [kind,setKind]=useState('text'),[loaded,setLoaded]=useState<ModelProfile[]>([]);
 return <><button onClick={()=>{setKind('video');setLoaded([]);}}>选择视频节点</button><button onClick={()=>setLoaded([profiles[kind]!])}>载入固定预设</button><button onClick={()=>setLoaded([{...profiles[kind]!,parameters:{...profiles[kind]!.parameters}}])}>刷新同一预设</button><NodeParameters key={kind} content={{type:'generation',profileRef:ref(kind+'-profile'),prompt:'fixture',inputs:[]}} profiles={loaded} models={models} locked={false} onChange={()=>{}}/></>;
}
createRoot(document.getElementById('root')!).render(<Fixture/>);
