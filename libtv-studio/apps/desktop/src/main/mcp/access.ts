import type {CommandKind,CommandReceipt} from '../../../../../packages/contracts/src/commands.ts';
import type {QueryMap} from '../../../../../packages/contracts/src/queries.ts';
import type {MediaReadInput,MediaRead} from '../../../../../packages/contracts/src/assets.ts';
import type {McpScope} from '../../../../../packages/contracts/src/mcp.ts';
import type {Result} from '../../../../../packages/contracts/src/result.ts';
import type {FileGrant} from '../file-grants.ts';
export interface McpEngineAccess {
 identity():{libraryId:string;connectionEpoch:string};
 execute(kind:CommandKind,payload:unknown,commandId:string,scope:McpScope):Promise<Result<CommandReceipt>>;
 query(kind:keyof QueryMap,payload:unknown,scope?:McpScope):Promise<Result<unknown>>;
 registerGrant(grant:FileGrant):Promise<Result<void>>;
 readMedia(input:MediaReadInput):Promise<Result<MediaRead>>;
}
