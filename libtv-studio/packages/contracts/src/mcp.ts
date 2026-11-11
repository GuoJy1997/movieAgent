import type {AssetVersionRef,AssetView,MediaReference} from './assets.ts';
export interface McpScope {libraryId:string;projectId:string;subprojectId:string}
export interface McpImportSourceDirectory {id:string;name:string;path:string}
export type McpImageSource = {kind:'localFile';importSourceId:string;path:string}|{kind:'bytes';fileName:string;mimeType:'image/png'|'image/jpeg'|'image/webp';base64:string};
export interface McpSourceInfo {sourceKind:'agent'|'user'|'external';sourceApp?:string;model?:string;prompt?:string;generatedAt?:string}
export type McpAssetBinding =
 | {kind:'entity';entityId:string;expectedRevision:number}
 | {kind:'shot';shotId:string;expectedRevision:number;expectedSelectionRevision:number}
 | {kind:'canvas';canvasId:string;baseRevision:number;nodeId?:string;x:number;y:number};
export interface McpImportInput {requestId:string;scope:McpScope;name:string;source:McpImageSource;tags?:string[];shared?:boolean;sourceInfo?:McpSourceInfo;targetAsset?:{assetId:string;expectedVersion:number};bindings?:McpAssetBinding[]}
export interface McpImportOperation {operationId:string;requestId:string;scope:McpScope;state:'received'|'collecting'|'asset_ready'|'binding'|'completed'|'partial'|'failed'|'cancelling'|'cancelled';asset:AssetView|null;hash:string|null;completedSteps:string[];error:{code:string;message:string}|null;createdAt:string;updatedAt:string}
export interface McpClientView {id:string;name:string;connectedAt:string}
export interface McpStatus {enabled:boolean;instanceId:string;libraryId:string|null;sources:McpImportSourceDirectory[];clients:McpClientView[];clientConfig:{command:string;args:string[];env:Record<string,string>};error:string|null}
export type McpConfigureInput = {action:'enable'|'disable'}|{action:'revokeClient'|'removeSource';id:string};
export interface McpAssetProvenance {ref:AssetVersionRef;sourceInfo:McpSourceInfo|null;importedAt:string;hash:string}
export interface McpReuseImage {shotId:string;ref:MediaReference;role:'first_frame'|'reference'}

import {isRecord,type Result} from './result.ts';
export interface McpDesktopActions {status():Promise<Result<McpStatus>>;configure(input:McpConfigureInput):Promise<Result<McpStatus>>;selectDirectory():Promise<Result<McpStatus>>}
export function isMcpConfigureInput(v:unknown):v is McpConfigureInput{
 return isRecord(v)&&(['enable','disable'].includes(String(v.action))?Object.keys(v).length===1:['revokeClient','removeSource'].includes(String(v.action))&&Object.keys(v).length===2&&typeof v.id==='string'&&/^[a-zA-Z0-9_-]{1,128}$/.test(v.id));
}
