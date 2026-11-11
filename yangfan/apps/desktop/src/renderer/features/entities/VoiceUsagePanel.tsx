import {useState} from 'react';
import type {CharacterVoiceRevision,ShotDialogueRevision} from '../../../../../../packages/contracts/src/character-voice.ts';
import {Button,Field} from '../../../../../../packages/ui/src/controls.tsx';
import {useRuntime} from '../../services/runtime.tsx';
export function VoiceUsagePanel({projectId,voice,dialogues}:{projectId:string;voice:CharacterVoiceRevision;dialogues:ShotDialogueRevision[]}){
 const runtime=useRuntime(),[selected,setSelected]=useState<string[]>([]),related=dialogues.filter(d=>d.turns.some(t=>t.characterRef.id===voice.entityRef.id));
 const uses=related.filter(d=>d.turns.some(t=>t.voiceRef.id===voice.id&&t.voiceRef.revision===voice.revision)),targets=related.filter(d=>selected.includes(d.id+':'+d.revision));
 return <details><summary>使用位置：{uses.length} 个当前镜头 · {uses.reduce((n,d)=>n+d.turns.filter(t=>t.voiceRef.id===voice.id&&t.voiceRef.revision===voice.revision).length,0)} 句</summary>
 {uses.map(d=><p key={d.id}>镜头 {d.shotRef.id} · 对白 {d.id} v{d.revision} · {d.turns.filter(t=>t.voiceRef.id===voice.id&&t.voiceRef.revision===voice.revision).map(t=>t.text).join(' / ')}</p>)}
 <p>为下列明确勾选的对白使用 {voice.name} v{voice.revision}，会创建新对白修订。旧修订和产物保留，新对白需要重新生成及审核。</p>
 {related.map(d=><Field key={d.id+':'+d.revision} label={'更换对白 '+d.id+' v'+d.revision}><input type="checkbox" checked={selected.includes(d.id+':'+d.revision)} onChange={e=>setSelected(e.target.checked?[...selected,d.id+':'+d.revision]:selected.filter(k=>k!==d.id+':'+d.revision))}/>镜头 {d.shotRef.id} · {d.turns.filter(t=>t.characterRef.id===voice.entityRef.id).map(t=>t.text+' ['+t.voiceRef.id+' v'+t.voiceRef.revision+']').join(' / ')}</Field>)}
 <Button disabled={!targets.length||voice.archived||runtime.busy||runtime.pending||!runtime.online} onClick={()=>void runtime.command('voice.replaceDialogues',{projectId,characterId:voice.entityRef.id,voiceRef:{id:voice.id,revision:voice.revision},dialogueRefs:targets.map(d=>({id:d.id,revision:d.revision}))})}>为所选 {targets.length} 份对白创建换声修订</Button>
 </details>;
}
