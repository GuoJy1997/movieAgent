import { useSyncExternalStore } from 'react';
import type { CommandMap } from '../../../packages/contracts/src/commands.ts';
import type { QueryMap } from '../../../packages/contracts/src/queries.ts';
const listeners = new Set<() => void>();
let version = 0;
const data: Record<string, unknown> = {};
const calls: { kind: string; payload: Record<string, unknown> }[] = [];
const pending: ((value: unknown) => void)[] = [];
const publish = () => { version++; listeners.forEach(l => l()); };
export const fixtureRuntime = {
  calls,
  reset(next: Record<string, unknown>) { Object.keys(data).forEach(k => delete data[k]); Object.assign(data, next); calls.length = 0; pending.length = 0; publish(); },
  update(next: Record<string, unknown>) { Object.assign(data, next); publish(); },
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
export function useRuntime() { return runtime; }
export function useWorkspaceQuery<K extends keyof QueryMap>(kind: K, payload: QueryMap[K]['input'], enabled = true) {
  useSyncExternalStore(l => { listeners.add(l); return () => { listeners.delete(l); }; }, () => version);
  const id = (payload as { timelineId?: string; planId?: string }).timelineId ?? (payload as { planId?: string }).planId;
  const message = (data.__queryErrors as Record<string,string>|undefined)?.[kind];
  return { data: (enabled && !message ? data[`${kind}:${id}`] ?? data[kind] : undefined) as QueryMap[K]['output'] | undefined, isPending: false, isLoading: false, isSuccess: !message, error: message ? new Error(message) : null };
}
