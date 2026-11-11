import type { EngineIdentity } from '../../../../packages/contracts/src/desktop.ts';
import { isResult } from '../../../../packages/contracts/src/desktop.ts';
import { commandContracts, isReceipt, parseCommand, type CommandEnvelope, type CommandMap, type CommandReceipt } from '../../../../packages/contracts/src/commands.ts';
import { parseQuery, queryOutputValidators, type QueryEnvelope, type QueryMap, type ProjectSnapshot } from '../../../../packages/contracts/src/queries.ts';
import { isEventBatch, parseSubscription, type DomainEvent, type EventSubscription } from '../../../../packages/contracts/src/events.ts';
import type { InstanceDescriptor, WorkspaceConnection } from '../../../../packages/contracts/src/workspace-connection.ts';
import { fail, ok, type Result } from '../../../../packages/contracts/src/result.ts';
import { CommandOutbox } from './command-outbox.ts';
import { requestHash } from '../../../../packages/engine/src/command-router.ts';
import { randomUUID } from 'node:crypto';
import { isDefinitiveCommandRejection } from './command-rejection.ts';
export interface EngineTransport {
  identity: EngineIdentity;
  execute(input: unknown): Promise<unknown>;
  query(input: unknown): Promise<unknown>;
  readEvents(input: unknown): Promise<unknown>;
}
export class LocalConnection implements WorkspaceConnection {
  readonly connectionEpoch = randomUUID();
  private active = true;
  private subscriptions = new Set<() => void>();
  constructor(private readonly transport: EngineTransport, private readonly outbox: CommandOutbox) {}
  disconnect(): void { this.active = false; for (const stop of this.subscriptions) stop(); }
  async describe(): Promise<Result<InstanceDescriptor>> {
    if (!this.active) return fail('STALE_CONNECTION', '连接已更换。');
    return ok({ ...this.transport.identity, transport: 'utility-process', protocolVersion: 1, connectionEpoch: this.connectionEpoch, capabilities: { commands: Object.keys(commandContracts), queries: Object.keys(queryOutputValidators), events: ['audio.changed', 'timeline.changed', 'timeline.prepared', 'shots.prepared', 'shots.changed', 'shots.outputCollected', 'agent.sessionCreated', 'agent.prepared', 'agent.changed', 'agent.accepted', 'creation.entitySaved', 'creation.scriptSaved', 'creation.shotSaved', 'creation.outputSelected', 'workflow.prepared', 'workflow.changed', 'canvas.changed', 'generation.prepared', 'generation.enqueued', 'task.changed', 'project.created', 'provider.connectionSaved', 'model.definitionSaved', 'profile.saved', 'credential.statusChanged', 'asset.imported', 'asset.versionSaved', 'asset.metadataUpdated', 'asset.trashed', 'asset.restored'] } });
  }
  private scope(input: { libraryId: string; connectionEpoch: string }): Result<void> {
    if (!this.active || input.connectionEpoch !== this.connectionEpoch) return fail('STALE_CONNECTION', '连接已更换，请重新连接。');
    return input.libraryId === this.transport.identity.libraryId ? ok(undefined) : fail('WRONG_LIBRARY', '请求不属于当前资料库。');
  }
  async execute<K extends keyof CommandMap>(input: CommandEnvelope<K>): Promise<Result<CommandReceipt<CommandMap[K]['output']>>> {
    const parsed = parseCommand(input); if (!parsed.ok) return parsed;
    const scope = this.scope(parsed.value); if (!scope.ok) return scope;
    const queued = this.outbox.enqueue(parsed.value); if (!queued.ok) return queued;
    let response: unknown;
    try { response = await this.transport.execute(queued.value); }
    catch { return fail('ENGINE_DISCONNECTED', '连接已中断，操作保留为待确认。'); }
    if (!isResult(response, isReceipt)) return fail('INVALID_ENGINE_RESPONSE', '回执格式无效，操作仍待确认。');
    if (response.ok) {
      if (response.value.libraryId !== queued.value.libraryId || response.value.commandId !== queued.value.commandId || response.value.requestHash !== requestHash(queued.value) || !commandContracts[parsed.value.kind].isOutput(response.value.result)) return fail('INVALID_ENGINE_RESPONSE', '回执与待确认命令不匹配。');
      this.outbox.settle(response.value);
    } else if (isDefinitiveCommandRejection(queued.value, response.error.code)) {
      this.outbox.reject(queued.value, response.error.code);
    }
    const current = this.scope(parsed.value); if (!current.ok) return current;
    return response as Result<CommandReceipt<CommandMap[K]['output']>>;
  }
  async query<K extends keyof QueryMap>(input: QueryEnvelope<K>): Promise<Result<QueryMap[K]['output']>> {
    const parsed = parseQuery(input); if (!parsed.ok) return parsed;
    const scope = this.scope(parsed.value); if (!scope.ok) return scope;
    try {
      const response = await this.transport.query(parsed.value);
      const current = this.scope(parsed.value); if (!current.ok) return current;
      const validate: (value: unknown) => value is QueryMap[keyof QueryMap]['output'] = queryOutputValidators[parsed.value.kind];
      if (!isResult(response, validate)) return fail('INVALID_ENGINE_RESPONSE', '查询结果格式无效。');
      if (response.ok && response.value !== null) {
        if ('libraryId' in response.value && response.value.libraryId !== input.libraryId) return fail('INVALID_ENGINE_RESPONSE', '查询回执属于其他资料库。');
        if ('workflows' in response.value && response.value.workflows.some(item => item.libraryId !== input.libraryId)) return fail('INVALID_ENGINE_RESPONSE', '工作流快照属于其他资料库。');
        if ('projects' in response.value && response.value.projects.some(project => project.libraryId !== input.libraryId)) return fail('INVALID_ENGINE_RESPONSE', '快照属于其他资料库。');
        if ('connections' in response.value && (response.value.connections.some(item => item.libraryId !== input.libraryId) || response.value.credentialStatuses.some(item => item.ref.libraryId !== input.libraryId))) return fail('INVALID_ENGINE_RESPONSE', '连接快照属于其他资料库。');
        if ('models' in response.value && response.value.models.some(item => item.libraryId !== input.libraryId || item.connectionRef.libraryId !== input.libraryId)) return fail('INVALID_ENGINE_RESPONSE', '模型快照属于其他资料库。');
        if ('profiles' in response.value && response.value.profiles.some(item => item.libraryId !== input.libraryId || item.modelRef.libraryId !== input.libraryId)) return fail('INVALID_ENGINE_RESPONSE', 'Profile 快照属于其他资料库。');
      }
      return response as Result<QueryMap[K]['output']>;
    } catch { return fail('ENGINE_DISCONNECTED', '查询连接已中断。'); }
  }
  async readEvents(input: EventSubscription) {
    const parsed = parseSubscription(input); if (!parsed.ok) return parsed;
    const scope = this.scope(parsed.value); if (!scope.ok) return scope;
    try {
      const response = await this.transport.readEvents(parsed.value);
      const current = this.scope(parsed.value); if (!current.ok) return current;
      return isResult(response, isEventBatch) && (!response.ok || response.value.cursor.libraryId === input.libraryId) ? response : fail('INVALID_ENGINE_RESPONSE', '事件结果格式无效。');
    } catch { return fail('ENGINE_DISCONNECTED', '事件连接已中断。'); }
  }
  async subscribe(request: EventSubscription, onEvent: (event: DomainEvent) => void, onSnapshot?: (snapshot: ProjectSnapshot) => void): Promise<() => void> {
    const first = await this.readEvents(request);
    if (!first.ok) throw new Error(first.error.code);
    let cursor = first.value.cursor;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const stop = () => { stopped = true; clearTimeout(timer); this.subscriptions.delete(stop); };
    this.subscriptions.add(stop);
    if (first.value.snapshot) onSnapshot?.(first.value.snapshot);
    for (const event of first.value.events) { if (stopped || !this.active) break; onEvent(event); }
    const poll = async () => {
      const next = await this.readEvents({ ...request, cursor });
      if (stopped) return;
      if (!next.ok) { stop(); return; }
      cursor = next.value.cursor;
      for (const event of next.value.events) { if (stopped || !this.active) break; onEvent(event); }
      if (!stopped) timer = setTimeout(() => { void poll(); }, 100);
    };
    if (!stopped) timer = setTimeout(() => { void poll(); }, 100);
    return stop;
  }
  async recover(): Promise<Result<void>> {
    try {
      for (const command of this.outbox.pending(this.transport.identity.libraryId)) {
        if (!this.active) return fail('STALE_CONNECTION', '连接已更换。');
        const result = await this.execute({ ...command, connectionEpoch: this.connectionEpoch });
        if (!result.ok) {
          // execute already durably archived this rejected envelope.
          if (isDefinitiveCommandRejection(command, result.error.code)) {
            continue;
          }
          return result;
        }
      }
      return ok(undefined);
    } catch { return fail('OUTBOX_READ_FAILED', '无法恢复待确认操作，请检查客户端日志。'); }
  }
}
