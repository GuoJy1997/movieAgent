import {isMediaReference,type MediaReference} from './assets.ts';
import {isWorkScope,scopeId,type WorkScope} from './subprojects.ts';
import {isRecord,ok,fail,type Result} from './result.ts';
export interface ProjectAssetItem {ref:MediaReference;name:string;mime:string;width:number;height:number;byteLength:number;sourceSubprojectId:string|null;common:boolean}
export interface ProjectAssetCatalog {libraryId:string;projectId:string;items:ProjectAssetItem[]}
export interface ProjectAssetQuery extends WorkScope {view:'current'|'common'|'all'}
export interface TagProjectAsset extends WorkScope {ref:MediaReference;common:boolean}
export interface Deliverable {libraryId:string;projectId:string;subprojectId:string;id:string;title:string;timelineId:string;timelineRevision:number;jobId:string;media:MediaReference;sourceHash:string;createdAt:string}
export interface DeliverableList {libraryId:string;projectId:string;items:Deliverable[]}
export interface RegisterDeliverable extends WorkScope {title:string;timelineId:string;timelineRevision:number;jobId:string}
export function parseAssetQuery(x:unknown):Result<ProjectAssetQuery>{return isRecord(x)&&isWorkScope({projectId:x.projectId,subprojectId:x.subprojectId})&&['current','common','all'].includes(String(x.view))&&Object.keys(x).length===3?ok(x as unknown as ProjectAssetQuery):fail('INVALID_INPUT','资产查询范围无效。');}
export function parseTagAsset(x:unknown):Result<TagProjectAsset>{return isRecord(x)&&isWorkScope({projectId:x.projectId,subprojectId:x.subprojectId})&&isMediaReference(x.ref)&&typeof x.common==='boolean'&&Object.keys(x).length===4?ok(x as unknown as TagProjectAsset):fail('INVALID_INPUT','资产分类字段无效。');}
export function parseDeliverable(x:unknown):Result<RegisterDeliverable>{return isRecord(x)&&isWorkScope({projectId:x.projectId,subprojectId:x.subprojectId})&&typeof x.title==='string'&&x.title.trim().length>0&&x.title.length<=200&&scopeId(x.timelineId)&&scopeId(x.jobId)&&Number.isSafeInteger(x.timelineRevision)&&Number(x.timelineRevision)>0&&Object.keys(x).length===6?ok(x as unknown as RegisterDeliverable):fail('INVALID_INPUT','制品登记字段无效。');}
export const isProjectAssetItem=(x:unknown):x is ProjectAssetItem=>isRecord(x)&&isMediaReference(x.ref)&&typeof x.name==='string'&&typeof x.mime==='string'&&typeof x.common==='boolean'&&(x.sourceSubprojectId===null||scopeId(x.sourceSubprojectId))&&Number.isSafeInteger(x.byteLength);
export const isProjectAssetCatalog=(x:unknown):x is ProjectAssetCatalog=>isRecord(x)&&scopeId(x.libraryId)&&scopeId(x.projectId)&&Array.isArray(x.items)&&x.items.every(isProjectAssetItem);
export const isDeliverable=(x:unknown):x is Deliverable=>isRecord(x)&&scopeId(x.libraryId)&&scopeId(x.id)&&scopeId(x.projectId)&&scopeId(x.subprojectId)&&scopeId(x.timelineId)&&Number.isSafeInteger(x.timelineRevision)&&isMediaReference(x.media)&&typeof x.title==='string'&&typeof x.sourceHash==='string';
export const isDeliverableList=(x:unknown):x is DeliverableList=>isRecord(x)&&scopeId(x.libraryId)&&scopeId(x.projectId)&&Array.isArray(x.items)&&x.items.every(isDeliverable);
