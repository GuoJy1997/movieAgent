import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { InstanceDescriptor } from '../../../../../packages/contracts/src/workspace-connection.ts';
import type { CommandMap } from '../../../../../packages/contracts/src/commands.ts';
import type { QueryMap } from '../../../../../packages/contracts/src/queries.ts';
import type { AppError } from '../../../../../packages/contracts/src/result.ts';
import { workspace } from './workspace.ts';
import { queryCache, scopeKey } from './query-cache.ts';
import { CommandGate } from './command-gate.ts';

type Runtime = {
  descriptor: InstanceDescriptor | null;
  online: boolean;
  busy: boolean;
  pending: boolean;
  error: AppError | null;
  clearError(): void;
  refresh(): Promise<void>;
  recover(): Promise<void>;
  command<K extends keyof CommandMap>(
    kind: K,
    payload: CommandMap[K]['input'],
  ): Promise<CommandMap[K]['output'] | undefined>;
};
const Context = createContext<Runtime | null>(null);
const uncertainCodes = /ENGINE_|DISCONNECT|TIMEOUT|INVALID_.*RESPONSE|STALE_CONNECTION|OUTBOX/;
export function RuntimeProvider({ children }: { children: ReactNode }) {
  const [descriptor, setDescriptor] = useState<InstanceDescriptor | null>(null);
  const [online, setOnline] = useState(false),
    [busy, setBusy] = useState(false),
    [pending, setPending] = useState(false);
  const [error, setError] = useState<AppError | null>(null);
  const gate = useRef(new CommandGate());
  const identity = useRef<InstanceDescriptor | null>(null);
  async function refresh() {
    if (identity.current)
      await queryCache.invalidateQueries({
        queryKey: scopeKey(identity.current.libraryId, identity.current.connectionEpoch),
      });
  }
  useEffect(() => {
    let disposed = false,
      timer: ReturnType<typeof setTimeout>;
    async function check() {
      try {
        const result = await workspace.describe();
        if (disposed) return;
        if (result.ok) {
          const d = result.value;
          // describe alone may expose cached identity; a real query confirms engine reachability.
          const probe = await workspace.query({
            schemaVersion: 1,
            libraryId: d.libraryId,
            connectionEpoch: d.connectionEpoch,
            queryId: crypto.randomUUID(),
            kind: 'project.list',
            payload: {},
          });
          if (disposed) return;
          setOnline(probe.ok);
          if (probe.ok) {
            identity.current = d;
            setDescriptor(d);
            queryCache.setQueryData(
              [...scopeKey(d.libraryId, d.connectionEpoch), 'project.list', {}],
              probe.value,
            );
          } else setError(probe.error);
        } else {
          setOnline(false);
          setError(result.error);
        }
      } catch {
        if (!disposed) {
          setOnline(false);
          setError({ code: 'ENGINE_DISCONNECTED', message: '本地引擎连接已中断。草稿保留，新提交已停用。' });
        }
      }
      if (!disposed) timer = setTimeout(() => void check(), 1500);
    }
    void check();
    return () => {
      disposed = true;
      clearTimeout(timer);
    };
  }, []);
  useEffect(() => {
    if (!descriptor) return;
    let disposed = false,
      unsubscribe: (() => void) | undefined;
    void workspace
      .subscribe({ libraryId: descriptor.libraryId, connectionEpoch: descriptor.connectionEpoch }, () => {
        if (!disposed)
          void queryCache.invalidateQueries({
            queryKey: scopeKey(descriptor.libraryId, descriptor.connectionEpoch),
          });
      })
      .then((stop) => {
        if (disposed) stop();
        else unsubscribe = stop;
      })
      .catch(() => {
        if (!disposed) setOnline(false);
      });
    return () => {
      disposed = true;
      unsubscribe?.();
    };
  }, [descriptor?.libraryId, descriptor?.connectionEpoch]);
  async function command<K extends keyof CommandMap>(
    kind: K,
    payload: CommandMap[K]['input'],
  ): Promise<CommandMap[K]['output'] | undefined> {
    const d = identity.current;
    if (!online || !d || gate.current.pending) return;
    const envelope = {
      schemaVersion: 1 as const,
      libraryId: d.libraryId,
      connectionEpoch: d.connectionEpoch,
      commandId: crypto.randomUUID(),
      kind,
      payload,
    };
    gate.current.begin(envelope);
    setBusy(true);
    setError(null);
    try {
      const result = await workspace.execute(envelope);
      if (!result.ok) {
        setError(result.error);
        if (uncertainCodes.test(result.error.code)) {
          gate.current.uncertain();
          setPending(true);
          setOnline(false);
        } else gate.current.finish();
        return;
      }
      gate.current.resolve(result.value);
      await refresh();
      // A successful receipt can settle its command, but an old connection must
      // not ACK/clear local edits after a newer epoch has been published.
      if (identity.current?.libraryId !== d.libraryId || identity.current.connectionEpoch !== d.connectionEpoch) return;
      return result.value.result;
    } catch {
      gate.current.uncertain();
      setPending(true);
      setOnline(false);
      setError({
        code: 'ACK_UNKNOWN',
        message: '未收到保存回执。操作身份已保留；请核实原回执，不能重新提交。',
      });
    } finally {
      setBusy(false);
    }
  }
  async function recover() {
    const original = gate.current.pending,
      d = identity.current;
    if (!original || !d || original.libraryId !== d.libraryId) return;
    setBusy(true);
    try {
      const result = await workspace.query({
        schemaVersion: 1,
        libraryId: d.libraryId,
        connectionEpoch: d.connectionEpoch,
        queryId: crypto.randomUUID(),
        kind: 'command.receipt',
        payload: { commandId: original.commandId },
      });
      if (result.ok && gate.current.resolve(result.value)) {
        setPending(false);
        setError(null);
        await refresh();
      } else
        setError(
          result.ok
            ? { code: 'ACK_PENDING', message: '原回执尚未确认。请保留草稿并稍后核实；新提交继续停用。' }
            : result.error,
        );
    } catch {
      setError({ code: 'ENGINE_DISCONNECTED', message: '无法核实原回执，请等待引擎恢复。' });
    } finally {
      setBusy(false);
    }
  }
  return (
    <Context.Provider
      value={{
        descriptor,
        online,
        busy,
        pending,
        error,
        clearError: () => setError(null),
        refresh,
        command,
        recover,
      }}
    >
      {children}
    </Context.Provider>
  );
}
export function useRuntime() {
  const runtime = useContext(Context);
  if (!runtime) throw new Error('RuntimeProvider missing');
  return runtime;
}
export function useWorkspaceQuery<K extends keyof QueryMap>(
  kind: K,
  payload: QueryMap[K]['input'],
  enabled = true,
) {
  const { descriptor: d, online } = useRuntime();
  return useQuery({
    queryKey: [...scopeKey(d?.libraryId ?? 'connecting', d?.connectionEpoch ?? 'none'), kind, payload],
    enabled: Boolean(d && online && enabled),
    refetchInterval: online ? 1500 : false,
    queryFn: async () => {
      if (!d) throw new Error('资料库未连接');
      const result = await workspace.query({
        schemaVersion: 1,
        libraryId: d.libraryId,
        connectionEpoch: d.connectionEpoch,
        queryId: crypto.randomUUID(),
        kind,
        payload,
      });
      if (!result.ok) throw new Error(`${result.error.code} · ${result.error.message}`);
      return result.value;
    },
  });
}
