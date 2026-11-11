import {useState} from 'react';
import {timelineNavigate,useOwnedDraft} from '../../state/DraftNavigationGuard.tsx';
import type {CanvasContent} from '../../../../../../packages/contracts/src/canvas.ts';
import type {EntityRevision} from '../../../../../../packages/contracts/src/creation.ts';
import type {AssetView,MediaReference} from '../../../../../../packages/contracts/src/assets.ts';
import type {ModelDefinition,ModelProfile} from '../../../../../../packages/contracts/src/models.ts';
import {Button,Field} from '../../../../../../packages/ui/src/controls.tsx';
import {Dialog} from '../../../../../../packages/ui/src/overlays.tsx';
import {CanvasIcon} from './CanvasIcon.tsx';
import {canvasProfiles,canvasTools,type CanvasTool} from './canvas-tools.ts';
export function CanvasStarter({entities,entityStatus,hasMedia,hasGenerated,locked,onEntity,onAssets,onText,onTools,onDismiss}:{entities?:EntityRevision[];entityStatus?:string;hasMedia:boolean;hasGenerated:boolean;locked:boolean;onEntity(kind:'character'|'scene'):void;onAssets():void;onText():void;onTools():void;onDismiss():void}){
 const characters=entities?.filter(e=>e.kind==='character').length,scenes=entities?.filter(e=>e.kind==='scene').length;
 return <section className="canvas-starter" aria-label="画布起步指引">
  <div className="canvas-starter-heading"><span className="canvas-kicker">让这一集，有人，有世界</span><button className="canvas-icon-button" aria-label="收起起步指引" title="随时从工具栏重新打开" onClick={onDismiss}><CanvasIcon name="x"/></button></div>
  <h2>从角色与场景开始</h2><p className="canvas-intro">先定下主角和故事发生的地方，也可以直接放入已有素材。</p>
  {entityStatus&&<p className="canvas-prerequisite" role="status">{entityStatus}</p>}
  <div className="canvas-start-cards">
   <article className="canvas-start-card"><div className="canvas-card-symbol"><CanvasIcon name="user" size={32}/><span>01 / 人物</span></div><h3>谁，走进故事？</h3><p>记录外貌、性格和形象参考，让不同镜头里的角色保持一致。</p><small>{characters===undefined?'角色设定暂不可用':characters?'已建立 '+characters+' 位角色':'从第一个角色开始'}</small><Button disabled={locked||!!entityStatus} onClick={()=>onEntity('character')}><CanvasIcon name="plus"/>创建角色<CanvasIcon name="chevron-right" size={16}/></Button></article>
   <article className="canvas-start-card"><div className="canvas-card-symbol scene"><CanvasIcon name="mountain" size={32}/><span>02 / 场景</span></div><h3>故事，在哪里发生？</h3><p>定下空间、时间与氛围，让每一个镜头都有清楚的环境依据。</p><small>{scenes===undefined?'场景设定暂不可用':scenes?'已建立 '+scenes+' 个场景':'搭建故事的第一个空间'}</small><Button disabled={locked||!!entityStatus} onClick={()=>onEntity('scene')}><CanvasIcon name="plus"/>创建场景<CanvasIcon name="chevron-right" size={16}/></Button></article>
  </div>
  <div className="canvas-start-shortcuts"><Button onClick={onAssets}><CanvasIcon name="folder"/>放入已有素材</Button><Button disabled={locked} onClick={onText}><CanvasIcon name="text-size"/>先写一段想法</Button><Button onClick={onTools}><CanvasIcon name="wand"/>看看创作工具</Button></div>
  <ol className="canvas-step-list" aria-label="本集创作进度">{[{label:'建立角色',done:!!characters},{label:'确定场景',done:!!scenes},{label:'放入画面',done:hasMedia},{label:'完成生成',done:hasGenerated}].map((step,index)=><li key={step.label} data-done={step.done}>{step.done?<CanvasIcon name="check" size={14}/>:<span>{index+1}</span>}{step.label}</li>)}</ol>
  <p className="canvas-start-note">设定会保存在本集。准备好画面后，再连接镜头；每一步都可以回头修改。</p>
 </section>;
}
interface ToolProps {
 scope:string;profiles:ModelProfile[];models:ModelDefinition[];assets:AssetView[];entities:EntityRevision[];
 selectedReference?:MediaReference;readiness?:string;locked:boolean;
 onCreate(content:CanvasContent):Promise<boolean>;onClose():void;onConfigure?():void;
}
interface ToolDraft {entityId:string;referenceKey:string;instructions:string;chosenProfile:string}
// Session-only drafts follow the same retention boundary as the Agent composer.
const toolDrafts=new Map<string,ToolDraft>();
export function CanvasToolsDialog(props:ToolProps){
 const [tool,setTool]=useState<CanvasTool|null>(null);
 return <Dialog title={tool?tool.name:'快捷工具'} onClose={()=>timelineNavigate(props.onClose)} wide>
  {tool?<CanvasToolForm key={props.scope+tool.id} {...props} tool={tool} onBack={()=>setTool(null)}/>:<><p className="canvas-tools-intro">从一个明确的任务开始。选择工具后先检查设定与参考，再创建生成节点。</p>{(['character','scene'] as const).map(group=><section className="canvas-tool-section" key={group}><h3>{group==='character'?'人物形象':'场景与氛围'}</h3><div className="canvas-tool-grid">{canvasTools.filter(t=>t.group===group).map(t=><button key={t.id} className="canvas-tool-card" aria-label={t.name} onClick={()=>setTool(t)}><CanvasIcon name={t.icon} size={25}/><strong>{t.name}</strong><span>{t.description}</span><small>{t.reference?'需要参考图片':'从文字设定开始'}</small></button>)}</div></section>)}<p className="hint">工具会预填生成要求，效果取决于所选模型；创建节点不会启动生成。</p></>}
 </Dialog>;
}
function CanvasToolForm({tool,onBack,...props}:ToolProps&{tool:CanvasTool;onBack():void}){
 const key=props.scope+':'+tool.id;
 const initial=():ToolDraft=>({entityId:'',referenceKey:props.selectedReference?JSON.stringify(props.selectedReference):'',instructions:tool.prompt,chosenProfile:''});
 const [draft,setDraft]=useState<ToolDraft>(()=>toolDrafts.get(key)??initial());
 const [edited,setEdited]=useState(()=>toolDrafts.has(key));
 const [submitting,setSubmitting]=useState(false),[error,setError]=useState('');
 const change=(patch:Partial<ToolDraft>)=>{setEdited(true);setDraft(previous=>({...previous,...patch}));};
 const {entityId,referenceKey,instructions,chosenProfile}=draft;
 useOwnedDraft({dirty:edited||submitting,ephemeral:true,save:async()=>{toolDrafts.set(key,draft);return !submitting;},discard:()=>{toolDrafts.delete(key);setDraft(initial());setEdited(false);}},key);
 const entities=props.entities.filter(e=>e.kind===tool.group),entity=entities.find(e=>e.id===entityId);
 const images:{ref:MediaReference;name:string}[]=props.assets.filter(a=>a.mime.startsWith('image/')&&!a.deletedAt).map(a=>({ref:a.ref,name:a.name+' · v'+a.ref.version}));
 if(props.selectedReference?.kind==='artifact')images.unshift({ref:props.selectedReference,name:'当前选中图片（固定版本）'});
 const reference=images.find(a=>JSON.stringify(a.ref)===referenceKey)?.ref;
 const available=canvasProfiles(props.profiles,props.models,'image',tool.reference||!!referenceKey);
 const profile=available.find(p=>p.id+':'+p.revision===chosenProfile)??available[0];
 const prompt=[instructions,entity&&['设定：'+entity.name+'（v'+entity.revision+'）',entity.description,'一致性要求：'+entity.constraints].join('\n')].filter(Boolean).join('\n\n');
 const reason=props.readiness||(referenceKey&&!reference?'所选参考图片已不可用，请重新选择或清除参考。':entityId&&!entity?'所选设定已不可用，请重新选择或清除设定。':tool.reference&&!reference?'先选择一张参考图片。':!profile?(tool.reference||reference?'需要支持参考图片的图像生成预设。':'需要可用的文生图预设。'):!instructions.trim()?'请填写生成要求。':prompt.length>16000?'生成要求与设定合计超过 16000 字，请缩短后再创建。':props.locked?'画布暂不可写，请先处理连接或待核实操作。':'');
 return <div className="form-stack canvas-tool-form"><Button tone="quiet" disabled={submitting} onClick={()=>timelineNavigate(onBack)}><CanvasIcon name="arrow-back-up"/>返回工具列表</Button>
 <p>{tool.description}。创建后可以继续调整参数，确认后才会生成。</p>
 <Field label={tool.group==='character'?'使用角色设定':'使用场景设定'}><select value={entityId} onChange={e=>change({entityId:e.target.value})}><option value="">直接填写生成要求</option>{entityId&&!entity&&<option value={entityId}>所选设定暂不可用</option>}{entities.map(e=><option key={e.id} value={e.id}>{e.name} · v{e.revision}</option>)}</select></Field>
 <Field label="参考图片" hint={tool.reference?'固定这张图片的当前版本，供后续生成使用。':'可选。添加参考图后需要支持参考图片的模型。'}><select value={referenceKey} onChange={e=>change({referenceKey:e.target.value})}><option value="">选择参考图片</option>{referenceKey&&!reference&&<option value={referenceKey}>所选参考暂不可用</option>}{images.map(a=><option key={JSON.stringify(a.ref)} value={JSON.stringify(a.ref)}>{a.name}</option>)}</select></Field>
 <Field label="生成要求"><textarea rows={5} maxLength={16000} value={instructions} onChange={e=>change({instructions:e.target.value})}/></Field>
 <Field label="图像生成预设"><select value={profile?profile.id+':'+profile.revision:''} onChange={e=>change({chosenProfile:e.target.value})}>{!available.length&&<option value="">暂无相容预设</option>}{available.map(p=><option key={p.id+':'+p.revision} value={p.id+':'+p.revision}>{p.name} · v{p.revision}</option>)}</select></Field>
 {entity&&<p className="hint">会带入「{entity.name}」v{entity.revision} 的文字设定；以后修改实体不会自动改写这个节点。</p>}
 {reason&&<p className="canvas-prerequisite" role="status">{reason}</p>}{!profile&&!props.readiness&&props.onConfigure&&<Button onClick={props.onConfigure}>配置图像模型</Button>}
 {error&&<p role="alert">{error}</p>}
 <div className="dialog-actions"><p>只创建节点，不会提交生成。</p><Button tone="primary" disabled={!!reason||submitting} onClick={async()=>{
  if(!profile||reason)return;setSubmitting(true);setError('');
  try{
   const created=await props.onCreate({type:'generation',prompt,profileRef:{libraryId:profile.libraryId,id:profile.id,revision:profile.revision},inputs:[],...(reference?{referenceImages:[{role:'reference',ref:reference}]}:{})});
   if(created){toolDrafts.delete(key);setEdited(false);props.onClose();}
   else setError('节点未创建，保留当前填写内容。请处理画布提示后重试。');
  }catch{setError('节点创建失败，填写内容已保留。请核实画布状态后重试。');}
  finally{setSubmitting(false);}
 }}>{submitting?'正在创建…':'创建生成节点'}</Button></div>
 </div>;
}
