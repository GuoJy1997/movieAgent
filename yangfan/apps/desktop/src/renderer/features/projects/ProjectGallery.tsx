import {useEffect,useState} from 'react';
import {CircularCarousel} from './react-bits/CircularCarousel.tsx';
import type {MediaReference} from '../../../../../../packages/contracts/src/assets.ts';
import {Icon} from '../../../../../../packages/ui/src/icons.tsx';
import {mascot} from '../../../../../../packages/ui/src/Brand.tsx';
import {MediaPreview} from '../assets/MediaPreview.tsx';
import {useWorkspaceQuery} from '../../services/runtime.tsx';
export interface GalleryItem {id:string;title:string;cover:MediaReference|null}
function GalleryArtwork({item}:{item:GalleryItem}){
 const episodes=useWorkspaceQuery('subproject.list',{projectId:item.id},!item.cover);
 const episode=episodes.data?.items.find(e=>e.status!=='archived')??episodes.data?.items[0];
 const scope={projectId:item.id,subprojectId:episode?.id??'none'};
 const assets=useWorkspaceQuery('project.assets',{...scope,view:'all'},!item.cover&&!!episode,scope);
 const pictures=assets.data?.items.filter(a=>a.mime.startsWith('image/'));
 const cover=item.cover??pictures?.find(a=>a.name===item.title)?.ref??pictures?.[0]?.ref;
 return <span className={'gallery-artwork'+(!cover?' is-default':'')}>{cover?<MediaPreview media={cover} original/>:<><img src={mascot} alt="" draggable={false}/><strong>{item.title}</strong></>}</span>;
}
export function ProjectGallery({items,previewId,onPreview,onOpen}:{items:GalleryItem[];previewId:string;onPreview(id:string):void;onOpen(id:string):void}){
 const [paused,setPaused]=useState(false),[hovered,setHovered]=useState(false),[focused,setFocused]=useState(false),[hidden,setHidden]=useState(document.hidden),[reduced,setReduced]=useState(()=>matchMedia('(prefers-reduced-motion: reduce)').matches);
 const index=Math.max(0,items.findIndex(i=>i.id===previewId));
 const change=(direction:number)=>{if(items.length>1)onPreview(items[(index+direction+items.length)%items.length]!.id);};
 useEffect(()=>{const media=matchMedia('(prefers-reduced-motion: reduce)'),update=()=>setReduced(media.matches),visibility=()=>setHidden(document.hidden);media.addEventListener('change',update);document.addEventListener('visibilitychange',visibility);return()=>{media.removeEventListener('change',update);document.removeEventListener('visibilitychange',visibility);};},[]);
 useEffect(()=>{if(paused||hovered||focused||hidden||reduced||items.length<2)return;const timer=setTimeout(()=>{if(!matchMedia('(prefers-reduced-motion: reduce)').matches&&!document.hidden)change(1);},6000);return()=>clearTimeout(timer);},[paused,hovered,focused,hidden,reduced,previewId,items]);
 if(!items.length)return null;
 return <section className="project-gallery" aria-label="项目画廊" aria-roledescription="立体轮播" onMouseEnter={()=>setHovered(true)} onMouseLeave={()=>setHovered(false)} onFocusCapture={()=>setFocused(true)} onBlurCapture={e=>{if(!e.currentTarget.contains(e.relatedTarget as Node))setFocused(false);}} onKeyDown={e=>{if(e.key==='ArrowRight'){e.preventDefault();change(1);}if(e.key==='ArrowLeft'){e.preventDefault();change(-1);}}}>
  <CircularCarousel items={items} index={index} reduced={reduced} onSelect={i=>onPreview(items[i]!.id)} onOpen={i=>onOpen(items[i]!.id)} renderItem={item=><GalleryArtwork item={item}/>}/>
  <button className="gallery-arrow previous" aria-label="上一项目" disabled={items.length<2} onClick={()=>change(-1)}><Icon name="left"/></button>
  <button className="gallery-arrow next" aria-label="下一项目" disabled={items.length<2} onClick={()=>change(1)}><Icon name="right"/></button>
  <div className="gallery-controls">{items.map((item,i)=><button key={item.id} className="gallery-dot" aria-label={'切换预览 '+item.title} aria-current={i===index?'true':undefined} onClick={()=>onPreview(item.id)}/>)}{items.length>1&&<button className="gallery-playback" aria-label={paused?'恢复自动切换':'暂停自动切换'} onClick={()=>setPaused(!paused)}><Icon name={paused?'play':'pause'} size={16}/></button>}</div>
 </section>;
}
