import {useRef,type ReactNode} from 'react';
import {Icon} from '../../../../../../packages/ui/src/icons.tsx';
export function AgentComposer({value,onChange,disabled,tools,references,placeholder='继续描述你的想法，或 @ 引用角色、场景、镜头…',label='创作需求',maxLength=4000,onReference,submitLabel='准备这一轮规划'}:{value:string;onChange(value:string):void;disabled:boolean;tools:ReactNode;references?:ReactNode;placeholder?:string;label?:string;maxLength?:number;onReference?():void;submitLabel?:string}){
 const composing=useRef(false);
 return <div className="agent-composer">
  <textarea aria-label={label} value={value} onChange={e=>onChange(e.target.value)} maxLength={maxLength} placeholder={placeholder} rows={3} required
   onCompositionStart={()=>{composing.current=true;}} onCompositionEnd={()=>{composing.current=false;}}
   onKeyDown={e=>{if(e.key==='Enter'&&(e.ctrlKey||e.metaKey)&&!e.nativeEvent.isComposing&&!composing.current){e.preventDefault();if(!disabled)e.currentTarget.form?.requestSubmit();}if(e.key==='@'&&!e.nativeEvent.isComposing&&!composing.current)onReference?.();}}/>
  {references&&<div className="composer-references">{references}</div>}
  <div className="composer-toolbar">{tools}<span className="composer-spacer"/><small className="composer-count">{value.length>3000?value.length+'/'+maxLength:'Ctrl + Enter'}</small><button type="submit" className="composer-send" aria-label={submitLabel} title={submitLabel} disabled={disabled}><Icon name="send" size={23}/></button></div>
 </div>;
}