import { createContext,createElement,useContext,useSyncExternalStore } from 'react';
import type { CommandMap } from '../../../packages/contracts/src/commands.ts';
import type { QueryMap } from '../../../packages/contracts/src/queries.ts';
const listeners = new Set<() => void>();
let version = 0;
const data: Record<string, unknown> = {};
const calls: { kind: string; payload: Record<string, unknown> }[] = [];
const queryReads: {kind:string;payload:unknown}[] = [];
const pending: ((value: unknown) => void)[] = [];
const publish = () => { version++; listeners.forEach(l => l()); };
export const fixtureRuntime = {
  calls, queryReads,
  reset(next: Record<string, unknown>) { Object.keys(data).forEach(k => delete data[k]); Object.assign(data, next); runtime.descriptor.connectionEpoch=String(next.__connectionEpoch??'fixture'); calls.length = 0; queryReads.length = 0; pending.length = 0; publish(); },
  update(next: Record<string, unknown>) { Object.assign(data, next); if(typeof next.__connectionEpoch==='string')runtime.descriptor.connectionEpoch=next.__connectionEpoch; publish(); },
  resolve(value: unknown) { pending.shift()?.(value); publish(); },
};
const runtime = {
  online: true, busy: false, pending: false, error: null,
  descriptor: { libraryId: 'library', connectionEpoch: 'fixture' },
  clearError() {}, async refresh() {}, async recover() {},
  command<K extends keyof CommandMap>(kind: K, payload: CommandMap[K]['input']): Promise<CommandMap[K]['output'] | undefined> {
    calls.push({ kind, payload: structuredClone(payload) as Record<string, unknown> });
    return new Promise(resolve => pending.push(resolve as (value: unknown) => void));
  },
};
const ScopeContext=createContext<{scope:{projectId:string;subprojectId:string};canvasId:string}|null>(null);
export function useRuntime() { const local=useContext(ScopeContext);return {...runtime,...local}; }
export function useWorkspaceQuery<K extends keyof QueryMap>(kind: K, payload: QueryMap[K]['input'], enabled = true) {
  useSyncExternalStore(l => { listeners.add(l); return () => { listeners.delete(l); }; }, () => version);
  if(enabled)queryReads.push({kind,payload});
  const id = (payload as { timelineId?: string; planId?: string }).timelineId ?? (payload as { planId?: string }).planId;
  const projectId=(payload as {projectId?:string}).projectId;
  const message = (data.__queryErrors as Record<string,string>|undefined)?.[kind];
  return { data: (enabled && !message ? data[`${kind}:${id}`] ?? data[kind+':'+projectId] ?? data[kind] : undefined) as QueryMap[K]['output'] | undefined, isPending: false, isLoading: false, isSuccess: !message, error: message ? new Error(message) : null };
}

export function ScopedRuntimeProvider({children,scope,canvasId}:{children:import('react').ReactNode;scope:{projectId:string;subprojectId:string};canvasId:string}){return createElement(ScopeContext.Provider,{value:{scope,canvasId}},children);}
