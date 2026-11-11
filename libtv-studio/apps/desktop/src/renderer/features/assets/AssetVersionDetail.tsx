import {useEffect,useRef,useState} from 'react';
import type {AssetView,MediaReference} from '../../../../../../packages/contracts/src/assets.ts';
import type {ProjectAssetItem} from '../../../../../../packages/contracts/src/project-assets.ts';
import type {WorkScope} from '../../../../../../packages/contracts/src/subprojects.ts';
import {Button,QueryState} from '../../../../../../packages/ui/src/controls.tsx';
import {Icon} from '../../../../../../packages/ui/src/icons.tsx';
import {useRuntime,useWorkspaceQuery} from '../../services/runtime.tsx';
import {nextCanvasLayout} from '../../state/canvas-layout.ts';
import {getAgentSession,getAgentDraft,setAgentDraft} from '../../state/agent-composer-draft.ts';
import {MediaPreview} from './MediaPreview.tsx';
import {AssetHistory} from './AssetHistory.tsx';
const sameRef=(a:MediaReference|null|undefined,b:MediaReference)=>!!a&&JSON.stringify(a)===JSON.stringify(b);
export function AssetVersionDetail({item,scope,canvasId,onClose,onPlace,onReference}:{item:ProjectAssetItem;scope:WorkScope;canvasId:string;onClose():void;onPlace():void;onReference?():void}){
 const runtime=useRuntime(),history=useWorkspaceQuery('asset.history',{assetId:item.ref.kind==='assetVersion'?item.ref.assetId:''},item.ref.kind==='assetVersion');
 const initial:AssetView|null=item.ref.kind==='assetVersion'?{...item,ref:item.ref,sourceArtifactRef:null}:null;
 const [selected,setSelected]=useState<AssetView|null>(initial),[ready,setReady]=useState(false),[error,setError]=useState('');
 const media=selected?.ref??item.ref,identity=JSON.stringify(media);
 const canvas=useWorkspaceQuery('canvas.read',{canvasId},!!canvasId),creation=useWorkspaceQuery('creation.read',{projectId:scope.projectId}),sessions=useWorkspaceQuery('agent.list',{projectId:scope.projectId});
 const live=useRef(true);useEffect(()=>{live.current=true;return()=>{live.current=false;};},[]);
 const locked=!runtime.online||runtime.busy||runtime.pending;
 const referenced=creation.data?.selections.filter(s=>sameRef(s.image,media)||sameRef(s.video,media))??[];
 function preview(version:AssetView){setReady(false);setSelected(version);setError('');}
 async function place(){if(locked||!ready||!canvas.data)return;const result=await runtime.command('canvas.applyCommand',{canvasId,baseRevision:canvas.data.revision,operations:[{kind:'create',nodeId:crypto.randomUUID(),content:{type:'media',media},layout:nextCanvasLayout(canvas.data.nodes)}]});if(result&&live.current)onPlace();}
 function reference(){
  if(!ready||!onReference)return;
  const key=JSON.stringify([runtime.descriptor?.libraryId??'legacy',scope.projectId,scope.subprojectId]);
  const session=getAgentSession(key)||sessions.data?.sessions[0]?.sessionId||'home',draftKey=key+'/'+session,draft=getAgentDraft(draftKey);
  if(draft.assets.some(r=>sameRef(r,media))){onReference();return;}
  if(draft.assets.length>=8){setError('创作对话已有8项参考，请先移除一项。');return;}
  setAgentDraft(draftKey,{assets:[...draft.assets,media]});onReference();
 }
 return <section className="asset-detail-page">
  <Button tone="quiet" onClick={onClose}><Icon name="back"/>返回资产</Button>
  <header className="asset-detail-heading"><h1>{selected?.name??item.name}</h1><span>{item.mime} · {scope.subprojectId}</span></header>
  <div className="asset-detail-columns"><div className="asset-detail-main">
   <div className="asset-large-media" key={identity}><MediaPreview media={media} original onAvailability={setReady}/></div>
   {selected&&<><div className="section-head"><h2>版本</h2><span className="hint">正在浏览 v{selected.ref.version} · 选择版本不会替换已有引用</span></div><QueryState loading={history.isPending} error={history.error}/>
    <div className="asset-version-strip">{(history.data?.versions??[selected]).map(v=><button key={v.ref.version} aria-label={'预览版本 v'+v.ref.version} aria-pressed={selected.ref.version===v.ref.version} onClick={()=>preview(v)}><div><MediaPreview media={v.ref} thumbnail/></div><span>v{v.ref.version}</span></button>)}</div>
   </>}
  </div><aside className="asset-detail-information">
   <dl><dt>尺寸</dt><dd>{(selected?.width??item.width)+' × '+(selected?.height??item.height)}</dd><dt>版本</dt><dd>{selected?'v'+selected.ref.version:'固定生成结果'}</dd><dt>来源</dt><dd>{item.sourceSubprojectId?'来自分集 '+item.sourceSubprojectId:'项目公共'}</dd><dt>类型</dt><dd>{selected?.mime??item.mime}</dd></dl>
   <section><h2>引用此版本</h2><p className="hint">当前集已采用此版本的镜头</p>{referenced.length?referenced.map(s=><p key={s.shotId}>{creation.data?.shots.find(shot=>shot.id===s.shotId)?.title??s.shotId} · r{s.shotRevision}</p>):<p className="hint">当前集尚无镜头采用此版本。</p>}</section>
   <div className="asset-use-actions"><Button tone="primary" disabled={locked||!ready||!canvas.data||!!selected?.deletedAt} onClick={()=>void place()}>放入当前画布<Icon name="arrow" size={16}/></Button>{onReference&&<Button tone="quiet" disabled={!ready||!!selected?.deletedAt} onClick={reference}>用作参考</Button>}</div>
   {!ready&&<p className="hint">原件尚未读取成功，暂不可采用。</p>}{!canvasId&&<p className="hint">先在本集中创建或选择画布。</p>}{error&&<p role="alert">{error}</p>}
   {selected&&<details><summary>标签、原件与回收管理</summary><AssetHistory key={selected.ref.assetId} asset={selected} onSelect={preview} onClose={onClose} showVersions={false}/></details>}
  </aside></div>
 </section>;
}