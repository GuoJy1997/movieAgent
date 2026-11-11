import type {ModelDefinition,ModelProfile} from '../../../../../../packages/contracts/src/models.ts';
import type {CanvasIconName} from './CanvasIcon.tsx';
export interface CanvasTool {id:string;name:string;group:'character'|'scene';icon:CanvasIconName;description:string;prompt:string;reference:boolean}
export const canvasTools:CanvasTool[]=[
 {id:'character-board',name:'角色设定板',group:'character',icon:'layout-board',description:'整理正面、侧面和服装细节',prompt:'制作角色设定板：清晰展示同一角色的正面、侧面、背面及服装细节。保持五官、发型、服装与年龄一致，简洁背景，不添加无关人物。',reference:false},
 {id:'portrait',name:'角色特写',group:'character',icon:'user',description:'用参考图保持人物形象',prompt:'依据参考图片制作角色面部特写，保持同一人物的五官、发型、年龄和气质，清晰自然的皮肤细节，电影感光线。',reference:true},
 {id:'face-body',name:'脸身分区构图',group:'character',icon:'layout-grid',description:'同一画面展示面部与全身',prompt:'根据参考角色制作一张分区设定图：左侧面部特写，右侧全身正面。两区保持同一人物五官、发型、服装一致，简洁背景。这是构图生成，不是精确抠图。',reference:true},
 {id:'scene-board',name:'场景设定板',group:'scene',icon:'mountain',description:'确定空间、氛围与关键陈设',prompt:'制作场景设定板，呈现空间全景、主要视角与关键陈设细节。统一建筑结构、材质、色调和光线，不出现人物。',reference:false},
 {id:'weather',name:'昼夜天气变体',group:'scene',icon:'sun',description:'保留空间结构，调整时间与天气',prompt:'基于参考场景生成时间或天气变化的画面。保持建筑、地形、陈设位置和构图一致，只调整光线、天空与天气。',reference:true},
 {id:'empty-scene',name:'无人物空镜',group:'scene',icon:'photo',description:'保留环境，生成无人场景',prompt:'基于参考图片生成无人空镜，保持场景布局、建筑、道具、镜头位置和光照风格，画面中不出现人物，合理补全原人物遮挡的环境。',reference:true},
];
export function canvasProfiles(profiles:ModelProfile[],models:ModelDefinition[],kind:'image'|'video',reference:boolean){
 return profiles.filter(profile=>{const model=models.find(m=>m.id===profile.modelRef.id&&m.revision===profile.modelRef.revision);if(!model)return false;
 const output=model.capabilities.outputKinds as readonly string[],input=model.capabilities.inputKinds as readonly string[],tasks=model.capabilities.taskTypes as readonly string[];
 return output.includes(kind)&&input.includes('text')&&(reference?input.includes('image'):tasks.includes('text_to_'+kind));});
}
