import type { EngineIdentity } from './desktop.ts';
import type { CommandEnvelope, CommandMap, CommandReceipt } from './commands.ts';
import type { QueryEnvelope, QueryMap, ProjectSnapshot } from './queries.ts';
import type { DomainEvent, EventSubscription } from './events.ts';
import type { Result } from './result.ts';
export interface InstanceDescriptor extends EngineIdentity {
  transport: 'utility-process'; protocolVersion: 1; connectionEpoch: string;
  capabilities: { commands: string[]; queries: string[]; events: string[] };
}
export interface WorkspaceConnection {
  describe(): Promise<Result<InstanceDescriptor>>;
  query<K extends keyof QueryMap>(request: QueryEnvelope<K>): Promise<Result<QueryMap[K]['output']>>;
  execute<K extends keyof CommandMap>(command: CommandEnvelope<K>): Promise<Result<CommandReceipt<CommandMap[K]['output']>>>;
  subscribe(request: EventSubscription, onEvent: (event: DomainEvent) => void, onSnapshot?: (snapshot: ProjectSnapshot) => void): Promise<() => void>;
}
