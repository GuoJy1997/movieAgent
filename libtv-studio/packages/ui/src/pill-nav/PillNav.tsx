// Adapted from React Bits Pill Nav (David Haz). See LICENSE.md and README.md.
import {useLayoutEffect,useRef,useState,type KeyboardEvent} from 'react';
import './PillNav.css';

export type PillNavItem<T extends string>={id:T;label:string;art?:string;disabled?:boolean};
export function PillNav<T extends string>({items,value,onChange,label,mode='tabs',panelId,className=''}:{
 items:readonly PillNavItem<T>[];value:T;onChange(value:T):void;label:string;
 mode?:'tabs'|'navigation';panelId?:string;className?:string;
}){
 const track=useRef<HTMLDivElement>(null),glide=useRef<HTMLSpanElement>(null);
 const buttons=useRef(new Map<T,HTMLButtonElement>());
 const spring=useRef({x0:0,x1:0,v0:0,v1:0,ready:false});
 const [focused,setFocused]=useState(value);
 const itemKey=items.map(item=>`${item.id}:${item.label}:${!!item.disabled}`).join('|');

 useLayoutEffect(()=>{
  setFocused(value);
  const container=track.current,indicator=glide.current,selected=buttons.current.get(value);
  if(!container||!indicator||!selected||selected.disabled)return;
  const state=spring.current,media=window.matchMedia('(prefers-reduced-motion: reduce)');
  let raf=0,last=0,disposed=false,target={left:0,width:0};
  const paint=()=>{
   indicator.style.width=`${Math.max(0,state.x1-state.x0)}px`;
   indicator.style.transform=`translate3d(${state.x0}px,0,0)`;
   indicator.style.opacity=target.width>0?'1':'0';
  };
  const snap=()=>{state.x0=target.left;state.x1=target.left+target.width;state.v0=state.v1=0;paint();};
  // React Bits' independently sprung leading/trailing edges, with restrained stretch.
  const tick=(now:number)=>{
   raf=0;
   if(disposed||document.hidden)return;
   const dt=last?Math.min(.05,(now-last)/1000):1/60;last=now;
   const t0=target.left,t1=target.left+target.width,zeta=1-.55*.12,base=520;
   const direction=Math.sign((t0+t1)/2-(state.x0+state.x1)/2);
   const lead=base*(1+.9*.18),trail=base*(1-.5*.18);
   const k0=direction<0?lead:direction>0?trail:base,k1=direction>0?lead:direction<0?trail:base;
   const steps=Math.ceil(dt/(1/240)),h=dt/steps;
   for(let i=0;i<steps;i++){
    state.v0+=(-k0*(state.x0-t0)-2*zeta*Math.sqrt(k0)*state.v0)*h;state.x0+=state.v0*h;
    state.v1+=(-k1*(state.x1-t1)-2*zeta*Math.sqrt(k1)*state.v1)*h;state.x1+=state.v1*h;
   }
   const busy=Math.abs(state.x0-t0)>.05||Math.abs(state.x1-t1)>.05||Math.abs(state.v0)>.5||Math.abs(state.v1)>.5;
   if(busy){paint();raf=requestAnimationFrame(tick);}else snap();
  };
  const measure=()=>{
   if(disposed)return;
   target={left:selected.offsetLeft,width:selected.offsetWidth};
   cancelAnimationFrame(raf);raf=0;last=0;
   if(!state.ready||media.matches||document.hidden){snap();state.ready=target.width>0;}
   else raf=requestAnimationFrame(tick);
  };
  measure();
  const resize=new ResizeObserver(measure);resize.observe(container);
  for(const button of buttons.current.values())resize.observe(button);
  media.addEventListener('change',measure);document.addEventListener('visibilitychange',measure);
  void document.fonts.ready.then(()=>{if(!disposed)measure();});
  return()=>{disposed=true;cancelAnimationFrame(raf);resize.disconnect();media.removeEventListener('change',measure);document.removeEventListener('visibilitychange',measure);};
 },[value,itemKey]);

 function focusNext(event:KeyboardEvent<HTMLButtonElement>,id:T){
  if(mode!=='tabs'||!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
  const available=items.filter(item=>!item.disabled),index=available.findIndex(item=>item.id===id);
  const next=event.key==='Home'?0:event.key==='End'?available.length-1:(index+(event.key==='ArrowRight'?1:-1)+available.length)%available.length;
  const item=available[next];if(!item)return;
  event.preventDefault();buttons.current.get(item.id)?.focus();
 }
 const selectedExists=items.some(item=>item.id===value&&!item.disabled);
 return <div className={`yangfan-pill-nav ${className}`}>
  <div ref={track} className="yangfan-pill-nav__track" role={mode==='tabs'?'tablist':'navigation'} aria-label={label} aria-orientation={mode==='tabs'?'horizontal':undefined}>
   <span ref={glide} className="yangfan-pill-nav__glide" aria-hidden="true" hidden={!selectedExists}/>
   {items.map(item=><button key={item.id} ref={node=>{if(node)buttons.current.set(item.id,node);else buttons.current.delete(item.id);}}
    type="button" className="yangfan-pill-nav__item" data-active={item.id===value}
    role={mode==='tabs'?'tab':undefined} aria-selected={mode==='tabs'?item.id===value:undefined}
    aria-current={mode==='navigation'&&item.id===value?'page':undefined} aria-controls={mode==='tabs'?panelId:undefined}
    tabIndex={mode==='tabs'?(item.id===focused?0:-1):undefined} disabled={item.disabled}
    onFocus={()=>setFocused(item.id)} onKeyDown={event=>focusNext(event,item.id)} onClick={()=>onChange(item.id)}>
    <span className="yangfan-pill-nav__label">{item.label}</span>
    {item.art&&<img className="yangfan-pill-nav__art" src={item.art} alt="" aria-hidden="true" draggable={false}/>}
   </button>)}
  </div>
 </div>;
}
