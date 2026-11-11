import { isDescriptor, isResult, type DesktopBridge } from '../../../../../packages/contracts/src/desktop.ts';
import { isReceipt, parseCommand, type CommandEnvelope, type CommandMap, type CommandReceipt } from '../../../../../packages/contracts/src/commands.ts';
import { parseQuery, queryOutputValidators, type QueryEnvelope, type QueryMap, type ProjectSnapshot } from '../../../../../packages/contracts/src/queries.ts';
import { isEventBatch, parseSubscription, type DomainEvent, type EventSubscription } from '../../../../../packages/contracts/src/events.ts';
import { fail, type Result } from '../../../../../packages/contracts/src/result.ts';
import type { WorkspaceConnection } from '../../../../../packages/contracts/src/workspace-connection.ts';

/** Renderer consumes DTOs only; replay and persistence belong to main. */
export class RendererWorkspace implements WorkspaceConnection {
  constructor(private readonly bridge: DesktopBridge) {}
  async describe() {
    const value: unknown = await this.bridge.describe();
    return isResult(value, isDescriptor) ? value : fail('INVALID_DESKTOP_RESPONSE', '工作台描述格式无效。');
  }
  async execute<K extends keyof CommandMap>(input: CommandEnvelope<K>): Promise<Result<CommandReceipt<CommandMap[K]['output']>>> {
    const parsed = parseCommand(input); if (!parsed.ok) return parsed;
    const value: unknown = await this.bridge.execute(input);
    return isResult(value, isReceipt) && (!value.ok || (value.value.libraryId === input.libraryId && value.value.commandId === input.commandId)) ? value as Result<CommandReceipt<CommandMap[K]['output']>> : fail('INVALID_DESKTOP_RESPONSE', '命令回执格式无效。');
  }
  async query<K extends keyof QueryMap>(input: QueryEnvelope<K>): Promise<Result<QueryMap[K]['output']>> {
    const parsed = parseQuery(input); if (!parsed.ok) return parsed;
    const value: unknown = await this.bridge.query(input);
    const validate: (value: unknown) => value is QueryMap[keyof QueryMap]['output'] = queryOutputValidators[input.kind];
    return isResult(value, validate) ? value as Result<QueryMap[K]['output']> : fail('INVALID_DESKTOP_RESPONSE', '查询结果格式无效。');
  }
  async subscribe(request: EventSubscription, onEvent: (event: DomainEvent) => void, onSnapshot?: (snapshot: ProjectSnapshot) => void): Promise<() => void> {
    const parsed = parseSubscription(request); if (!parsed.ok) throw new Error(parsed.error.code);
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let cursor = request.cursor;
    const stop = () => { stopped = true; clearTimeout(timer); };
    const read = async () => {
      const response: unknown = await this.bridge.readEvents({ ...request, cursor });
      if (!isResult(response, isEventBatch)) throw new Error('INVALID_DESKTOP_RESPONSE');
      if (!response.ok) throw new Error(response.error.code);
      if (response.value.cursor.libraryId !== request.libraryId) throw new Error('WRONG_LIBRARY');
      if (stopped) return;
      cursor = response.value.cursor;
      if (response.value.snapshot) onSnapshot?.(response.value.snapshot);
      for (const event of response.value.events) onEvent(event);
      timer = setTimeout(() => { void read().catch(stop); }, 100);
    };
    await read();
    return stop;
  }
}
export const workspace = new RendererWorkspace(window.studio);
