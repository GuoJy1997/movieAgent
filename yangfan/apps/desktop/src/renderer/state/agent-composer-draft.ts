import {useSyncExternalStore} from 'react';
import type {MediaReference} from '../../../../../packages/contracts/src/assets.ts';
export interface AgentInputDraft {message:string;profile:string;templateId:string;scriptId:string;shotIds:string[];entityIds:string[];assets:MediaReference[];tokens:string}
const drafts=new Map<string,AgentInputDraft>(),listeners=new Set<()=>void>();
export const emptyAgentDraft=():AgentInputDraft=>({message:'',profile:'',templateId:'short-film',scriptId:'',shotIds:[],entityIds:[],assets:[],tokens:''});
export function getAgentDraft(key:string){let value=drafts.get(key);if(!value){value=emptyAgentDraft();drafts.set(key,value);}return value;}
export function setAgentDraft(key:string,patch:Partial<AgentInputDraft>){drafts.set(key,{...getAgentDraft(key),...patch});listeners.forEach(fn=>fn());}
export function useAgentDraft(key:string){return useSyncExternalStore(fn=>{listeners.add(fn);return()=>{listeners.delete(fn);};},()=>getAgentDraft(key));}
export function clearAgentDraft(key:string){drafts.set(key,emptyAgentDraft());listeners.forEach(fn=>fn());}
const sessions=new Map<string,string>();
export const getAgentSession=(key:string)=>sessions.get(key)??'';
export const rememberAgentSession=(key:string,id:string)=>{sessions.set(key,id);};