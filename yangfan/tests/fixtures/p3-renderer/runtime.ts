import { useSyncExternalStore } from 'react';
import type { CommandMap } from '../../../packages/contracts/src/commands.ts';
import type { QueryMap } from '../../../packages/contracts/src/queries.ts';

const listeners = new Set<() => void>();
let version = 0;
const queries: Record<string, unknown> = {};
const calls: { kind: string; payload: Record<string, unknown> }[] = [];
const pending: ((value: unknown) => void)[] = [];
const publish = () => { version++; listeners.forEach(listener => listener()); };

export const fixtureRuntime = {
  reset(data: Record<string, unknown>) {
    Object.keys(queries).forEach(key => delete queries[key]);
    Object.assign(queries, data);
    calls.length = 0;
    pending.length = 0;
    publish();
  },
  calls,
  update(data: Record<string, unknown>) { Object.assign(queries, data); publish(); },
  resolve(value: unknown) { pending.shift()!(value); publish(); },
};
const runtime = {
  online: true, busy: false, pending: false, error: null, descriptor: null,
  clearError() {}, async refresh() {}, async recover() {},
  command<K extends keyof CommandMap>(kind: K, payload: CommandMap[K]['input']): Promise<CommandMap[K]['output'] | undefined> {
    calls.push({ kind, payload: structuredClone(payload) as Record<string, unknown> });
    return new Promise(resolve => pending.push(resolve as (value: unknown) => void));
  },
};
export function useRuntime() { return runtime; }
export function useWorkspaceQuery<K extends keyof QueryMap>(kind: K, payload: QueryMap[K]['input'], enabled = true) {
  useSyncExternalStore(listener => { listeners.add(listener); return () => { listeners.delete(listener); }; }, () => version);
  const key = kind === 'agent.read' ? `${kind}:${(payload as { sessionId: string }).sessionId}` : kind;
  return { data: (enabled ? queries[key] : undefined) as QueryMap[K]['output'] | undefined, isLoading: false, error: null };
}
