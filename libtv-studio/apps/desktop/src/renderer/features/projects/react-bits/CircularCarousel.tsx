/* Adapted from React Bits CircularCarousel (2026-11-08).
 * Copyright (c) 2026 David Haz. MIT + Commons Clause; see LICENSE.md.
 * Retains the spring integration, sampled pointer momentum, nearest-turn focus,
 * and visibility-aware RAF lifecycle. Yangfan uses a flat front-arc layout,
 * controlled selection and existing media capability rendering, not split images.
 */
import {useLayoutEffect,useRef,type ReactNode,type PointerEvent} from 'react';
import './CircularCarousel.css';

interface Item {id:string;title:string}
interface Props<T extends Item> {
 items:T[];index:number;reduced:boolean;
 onSelect(index:number):void;onOpen(index:number):void;
 renderItem(item:T):ReactNode;
}
interface Press {id:number;x:number;y:number;angle:number;moved:boolean;origin:number;samples:{time:number;angle:number}[]}
const SPRING=118;
const clamp=(value:number,min:number,max:number)=>Math.min(max,Math.max(min,value));
const modulo=(value:number,count:number)=>((value%count)+count)%count;

export function CircularCarousel<T extends Item>({items,index,reduced,onSelect,onOpen,renderItem}:Props<T>){
 const root=useRef<HTMLDivElement>(null),cards=useRef<(HTMLButtonElement|null)[]>([]);
 const settings=useRef({items,index,reduced,onSelect,onOpen});
 settings.current={items,index,reduced,onSelect,onOpen};
 const wake=useRef(()=>{}),paint=useRef(()=>{});
 const state=useRef({angle:-index*360/Math.max(items.length,1),velocity:0,target:null as number|null,
  press:null as Press|null,suppressClick:false,width:1000,last:0});
 const identity=items.map(item=>item.id).join('\u0000');

 useLayoutEffect(()=>{
  const element=root.current;if(!element)return;
  const s=state.current,count=settings.current.items.length,step=360/Math.max(count,1);
  s.angle=-settings.current.index*step;s.target=null;s.velocity=0;s.press=null;
  let raf=0,visible=true;
  const render=()=>{
   const width=s.width,cardWidth=Math.min(width*.38,480),radius=width*.515;
   element.style.setProperty('--cc-card-width',`${cardWidth}px`);
   element.style.setProperty('--cc-height',`${Math.max(190,cardWidth/2+30)}px`);
   for(let i=0;i<count;i++){
    const card=cards.current[i];if(!card)continue;
    // Recycle the back half of the ring at the faded ends of the front arc.
    // For four projects this keeps two left posters, the hero, and one right.
    const left=Math.floor(count/2),right=count-left-1;
    const distance=count===1?0:modulo(i+s.angle/step+left+.5,count)-left-.5;
    const theta=clamp(distance*37,-78,78)*Math.PI/180;
    const z=radius*(Math.cos(theta)-1);
    const travel=Math.abs(distance)<=1?Math.abs(distance)*.289:.289+(Math.abs(distance)-1)*.142;
    const x=Math.sign(distance)*width*travel*(1-z/2200);
    const edge=1-clamp((Math.abs(distance)-(distance<0?left:right))/.5,0,1);
    const inView=Math.abs(distance)<2.48&&edge>.03;
    const depth=(1-Math.cos(theta))*.25;
    card.style.transform=settings.current.reduced
     ?`translate(-50%,-50%) translateX(${x}px) scale(${1-Math.min(Math.abs(distance),2)*.12})`
     :`translate(-50%,-50%) perspective(2200px) translate3d(${x}px,0,${z}px) rotateY(${-clamp(distance*64,-74,74)}deg) scale(${1-Math.min(Math.abs(distance),2)*.11})`;
    card.style.opacity=String(inView?edge:0);
    card.style.zIndex=String(100-Math.round(Math.abs(distance)*30));
    card.style.pointerEvents=inView?'auto':'none';
    card.style.setProperty('--cc-depth',String(depth));
    card.tabIndex=inView?0:-1;
    card.setAttribute('aria-hidden',String(!inView));
   }
  };
  paint.current=render;
  const frame=(now:number)=>{
   raf=0;
   const dt=s.last?Math.min((now-s.last)/1000,.05):1/60;s.last=now;
   if(s.target!==null&&!s.press?.moved){
    if(settings.current.reduced){s.angle=s.target;s.velocity=0;s.target=null;}
    else {
     let remaining=dt;
     const damping=2*Math.sqrt(SPRING);
     while(remaining>0){
      const h=Math.min(remaining,1/240);
      const accel=SPRING*(s.target-s.angle)-damping*s.velocity;
      s.velocity+=accel*h;s.angle+=s.velocity*h;remaining-=h;
     }
     if(Math.abs(s.target-s.angle)<.004&&Math.abs(s.velocity)<.03){s.angle=s.target;s.velocity=0;s.target=null;}
    }
   }
   render();
   if(s.target!==null&&visible&&!document.hidden)raf=requestAnimationFrame(frame);
   else s.last=0;
  };
  const request=()=>{if(!raf&&visible&&!document.hidden)raf=requestAnimationFrame(frame);};
  wake.current=request;
  const measure=()=>{s.width=element.getBoundingClientRect().width||1000;render();request();};
  const visibility=()=>{
   if(document.hidden){
    cancelAnimationFrame(raf);raf=0;s.last=0;s.press=null;s.suppressClick=false;
    delete element.dataset.dragging;
    s.angle=s.target??-settings.current.index*step;s.target=null;s.velocity=0;
   }else request();
  };
  const resize=new ResizeObserver(measure);resize.observe(element);
  const intersection=new IntersectionObserver(([entry])=>{
   visible=entry?.isIntersecting??true;
   if(visible)request();else{cancelAnimationFrame(raf);raf=0;s.last=0;}
  });intersection.observe(element);
  document.addEventListener('visibilitychange',visibility);
  measure();
  return()=>{
   cancelAnimationFrame(raf);resize.disconnect();intersection.disconnect();
   document.removeEventListener('visibilitychange',visibility);
   wake.current=()=>{};paint.current=()=>{};
  };
 },[identity]);

 useLayoutEffect(()=>{
  const s=state.current,step=360/Math.max(items.length,1);
  let target=-index*step;
  target+=360*Math.round((s.angle-target)/360);
  s.target=target;
  if(reduced){s.angle=target;s.target=null;s.velocity=0;paint.current();}
  else wake.current();
 },[index,reduced,identity]);

 function down(event:PointerEvent<HTMLDivElement>){
  const s=state.current;s.suppressClick=false;
  if(event.button!==0||items.length<2||s.press)return;
  s.press={id:event.pointerId,x:event.clientX,y:event.clientY,angle:s.angle,moved:false,origin:0,
   samples:[{time:performance.now(),angle:s.angle}]};
 }
 function move(event:PointerEvent<HTMLDivElement>){
  const s=state.current,press=s.press;if(!press||press.id!==event.pointerId)return;
  const delta=event.clientX-press.x,cross=event.clientY-press.y;
  if(!press.moved){
   if(Math.abs(delta)<5)return;
   if(Math.abs(cross)>Math.abs(delta)*1.2&&event.pointerType!=='mouse'){s.press=null;return;}
   press.moved=true;press.origin=delta;s.target=null;s.velocity=0;
   root.current?.setPointerCapture(event.pointerId);
   if(root.current)root.current.dataset.dragging='true';
  }
  // Scale the source's angle-per-pixel conversion to this shallow front arc.
  const step=360/items.length,perPixel=step/Math.max(s.width*.32,120);
  s.angle=press.angle+(delta-press.origin)*perPixel;
  const now=performance.now();press.samples.push({time:now,angle:s.angle});
  while(press.samples.length>2&&now-press.samples[0]!.time>110)press.samples.shift();
  paint.current();
 }
 function release(event:PointerEvent<HTMLDivElement>,cancelled=false){
  const s=state.current,press=s.press;if(!press||press.id!==event.pointerId)return;
  s.press=null;
  if(root.current){delete root.current.dataset.dragging;if(root.current.hasPointerCapture(event.pointerId))root.current.releasePointerCapture(event.pointerId);}
  if(!press.moved)return;
  s.suppressClick=true;
  const first=press.samples[0]!,last=press.samples.at(-1)!,span=(last.time-first.time)/1000;
  const velocity=!cancelled&&performance.now()-last.time<120&&span>.008?clamp((last.angle-first.angle)/span,-1400,1400):0;
  const step=360/items.length;
  const momentum=reduced?0:.18;
  const origin=Math.round(press.angle/step)*step;
  const target=clamp(Math.round((s.angle+velocity*momentum)/step)*step,origin-step,origin+step);
  s.target=cancelled?Math.round(s.angle/step)*step:target;
  s.velocity=reduced?0:clamp(velocity,-step*4,step*4);
  onSelect(modulo(Math.round(-s.target/step),items.length));
  if(reduced){s.angle=s.target;s.target=null;paint.current();}else wake.current();
 }

 return <div ref={root} className="circular-carousel" data-source="react-bits-circular-carousel"
  onPointerDown={down} onPointerMove={move} onPointerUp={e=>release(e)}
  onPointerCancel={e=>release(e,true)} onLostPointerCapture={e=>release(e,true)}
  onDragStart={e=>e.preventDefault()}
  onClickCapture={e=>{if(state.current.suppressClick){e.preventDefault();e.stopPropagation();state.current.suppressClick=false;}}}>
  {items.map((item,i)=><button key={item.id} ref={element=>{cards.current[i]=element;}}
   className="circular-carousel__poster" aria-label={'预览 '+item.title} aria-pressed={i===index}
   onClick={()=>onSelect(i)} onDoubleClick={()=>onOpen(i)}>
   {renderItem(item)}<span className="circular-carousel__shade" aria-hidden="true"/>
  </button>)}
 </div>;
}