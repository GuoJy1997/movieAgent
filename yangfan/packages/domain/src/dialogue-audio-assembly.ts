import type {ShotDialogueRevision} from '../../contracts/src/character-voice.ts';
import type {DialogueAudioSource,DialogueAssemblyRecipe} from '../../contracts/src/dialogue-assembly.ts';
import {isDialogueAssemblyRecipe} from '../../contracts/src/dialogue-assembly.ts';
import {fail,ok,type Result} from '../../contracts/src/result.ts';
export function planDialogueAudioAssembly(dialogue:ShotDialogueRevision,sources:readonly DialogueAudioSource[],durationTicks:number):Result<DialogueAssemblyRecipe>{
 const invalid=()=>fail('INVALID_DIALOGUE_ASSEMBLY','配音必须逐句完整匹配当前角色、声音和时间，不能超时或重叠。');
 if(sources.length!==dialogue.turns.length||new Set(sources.map(s=>s.turnId)).size!==sources.length)return invalid();
 const items=dialogue.turns.map(turn=>{const source=sources.find(s=>s.turnId===turn.turnId);if(!source||source.characterRef.id!==turn.characterRef.id||source.voiceRef.id!==turn.voiceRef.id||source.voiceRef.revision!==turn.voiceRef.revision)return null;return {...source,startTicks:turn.startTicks,allocatedTicks:turn.durationTicks};});
 if(items.some(x=>!x))return invalid();
 const ordered=items.filter((x):x is NonNullable<typeof x>=>!!x).sort((a,b)=>a.startTicks-b.startTicks);
 for(let i=1;i<ordered.length;i++)if(ordered[i-1]!.startTicks+ordered[i-1]!.allocatedTicks>ordered[i]!.startTicks)return invalid();
 const plan={dialogueRef:{id:dialogue.id,revision:dialogue.revision},shotRef:dialogue.shotRef,durationTicks,items:ordered,templateVersion:1 as const};
 return isDialogueAssemblyRecipe(plan)?ok(plan):invalid();
}
