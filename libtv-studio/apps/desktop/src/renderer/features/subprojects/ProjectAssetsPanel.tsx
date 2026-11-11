import {useState} from 'react';
import {Button,Field,QueryState,Empty} from '../../../../../../packages/ui/src/controls.tsx';
import {Icon} from '../../../../../../packages/ui/src/icons.tsx';
import type {WorkScope} from '../../../../../../packages/contracts/src/subprojects.ts';
import type {ProjectAssetItem} from '../../../../../../packages/contracts/src/project-assets.ts';
import {useRuntime,useWorkspaceQuery} from '../../services/runtime.tsx';
import {MediaPreview} from '../assets/MediaPreview.tsx';
import {AssetLibrary} from '../assets/AssetLibrary.tsx';
import {AssetVersionDetail} from '../assets/AssetVersionDetail.tsx';
export function ProjectAssetsPanel({scope,canvasId,onPlace,onReference}:{scope:WorkScope;canvasId:string;onPlace():void;onReference?():void}){
 const runtime=useRuntime(),[view,setView]=useState<'current'|'common'|'all'|'unclassified'>('all'),[imports,setImports]=useState(false),[search,setSearch]=useState(''),[type,setType]=useState(''),[preview,setPreview]=useState<ProjectAssetItem|null>(null);
 const catalog=useWorkspaceQuery('project.assets',{...scope,view}),episodes=useWorkspaceQuery('subproject.list',{projectId:scope.projectId});
 const items=catalog.data?.items.filter(a=>(!search||a.name.toLowerCase().includes(search.toLowerCase()))&&(!type||a.mime.startsWith(type+'/')))??[];
 if(preview)return <AssetVersionDetail key={JSON.stringify(preview.ref)} item={preview} scope={scope} canvasId={canvasId} onClose={()=>setPreview(null)} onPlace={onPlace} onReference={onReference}/>;
 return <section className="page project-assets-page">
  <header className="page-head"><div><h1>项目资产</h1><p>每一份灵感，都有它的位置。</p></div><Button onClick={()=>setImports(!imports)}><Icon name="plus"/>{imports?'收起导入与整理':'导入与整理素材'}</Button></header>
  {imports&&<AssetLibrary canvasId={canvasId||null} onPlace={onPlace}/>}
  <div className="asset-filter-row"><label className="asset-search"><Icon name="search"/><input aria-label="搜索项目资产" placeholder="搜索资产" value={search} onChange={e=>setSearch(e.target.value)}/></label>
   <Field label="资产范围"><select aria-label="资产范围" value={view} onChange={e=>setView(e.target.value as typeof view)}><option value="current">当前子项目</option><option value="common">项目共享资产</option><option value="all">全部子项目成果</option><option value="unclassified">历史未分类</option></select></Field>
   <Field label="资产媒体类型"><select value={type} onChange={e=>setType(e.target.value)}><option value="">全部类型</option><option value="image">图片</option><option value="video">视频</option><option value="audio">音频</option><option value="text">文本</option></select></Field>
  </div><QueryState loading={catalog.isPending} error={catalog.error}/>
  <div className="project-asset-grid">{items.map(item=><article key={JSON.stringify(item.ref)}><button className="project-asset-preview" aria-label={'查看 '+item.name} onClick={()=>setPreview(item)}><div><MediaPreview media={item.ref} thumbnail/></div><h3>{item.name}</h3><small>{episodes.data?.items.find(s=>s.id===item.sourceSubprojectId)?.title??'项目公共'} · {item.ref.kind==='assetVersion'?'v'+item.ref.version:'固定生成结果'}</small></button>
   <div className="project-asset-actions">{view==='unclassified'?<Button disabled={runtime.busy||!runtime.online||runtime.pending} onClick={()=>void runtime.command('project.assetAssign',{...scope,ref:item.ref})}>归入当前父项目</Button>:<><Button tone="quiet" disabled={runtime.busy||!runtime.online||runtime.pending} onClick={()=>void runtime.command('project.assetTag',{...scope,ref:item.ref,common:!item.common})}>{item.common?'移出公共分类':'加入公共分类'}</Button>{item.ref.kind==='artifact'&&<Button tone="quiet" disabled={runtime.busy||!runtime.online||runtime.pending} onClick={()=>{if(item.ref.kind==='artifact')void runtime.command('asset.saveArtifact',{artifactRef:item.ref,name:item.name});}}>收入素材库供剪辑选用</Button>}</>}</div>
  </article>)}</div>{!items.length&&<Empty title={search||type?'没有匹配资产':'还没有资产'}>导入素材，或将生成原件收存到本项目。</Empty>}
 </section>;
}