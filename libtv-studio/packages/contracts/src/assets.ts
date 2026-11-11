import { fail, isRecord, ok, type Result } from './result.ts';
const id = (v: unknown): v is string => typeof v === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(v);
export interface ArtifactRef { kind: 'artifact'; libraryId: string; artifactId: string }
export interface AssetVersionRef { kind: 'assetVersion'; libraryId: string; assetId: string; version: number }
export type MediaReference = ArtifactRef | AssetVersionRef;
export interface ImportRef { libraryId: string; importId: string; state: 'ready'; versions: AssetVersionRef[] }
export interface FileGrantRef { grantId: string; importId: string; libraryId: string; expiresAt: number; fileCount: number }
export interface AssetMetadataView { libraryId: string; assetId: string; name: string; metadataRevision: number; tags: string[]; deletedAt: string | null; createdAt: string }
// Optional metadata fields explicitly accept pre-P2 snapshots/receipts.
export interface AssetView { ref: AssetVersionRef; sourceArtifactRef: ArtifactRef | null; name: string; mime: string; width: number; height: number; byteLength: number; metadataRevision?: number; tags?: string[]; deletedAt?: string | null; createdAt?: string }
export interface AssetHistory { libraryId: string; assetId: string; versions: AssetView[] }
export interface AssetRevisionInput { assetId: string; expectedRevision: number }
export interface UpdateAssetMetadataInput extends AssetRevisionInput { name: string; tags: string[] }
export interface AssetSearchInput { name?: string; tag?: string; mediaType?: 'image' | 'video' | 'text' | 'audio'; state?: 'active' | 'trash'; latestOnly?: boolean }
export interface AssetSnapshot { libraryId: string; assets: AssetView[]; snapshotSeq: number }
export interface ImportGrantedFilesInput { grantId: string; assetId?: string; expectedVersion?: number }
export interface SaveArtifactInput { artifactRef: ArtifactRef; name: string; assetId?: string; expectedVersion?: number }
export interface MediaReadInput { libraryId: string; ref: MediaReference; variant: 'original' | 'thumbnail' }
export interface MediaMetadata { hash: string; mime: string; byteLength: number; width: number; height: number }
export interface MediaRead { bytes: Uint8Array; mime: string; hash: string }
export function isArtifactRef(v: unknown): v is ArtifactRef { return isRecord(v) && v.kind === 'artifact' && id(v.libraryId) && id(v.artifactId); }
export function isAssetVersionRef(v: unknown): v is AssetVersionRef { return isRecord(v) && v.kind === 'assetVersion' && id(v.libraryId) && id(v.assetId) && Number.isSafeInteger(v.version) && (v.version as number) > 0; }
export function isMediaReference(v: unknown): v is MediaReference { return isArtifactRef(v) || isAssetVersionRef(v); }
export function isImportRef(v: unknown): v is ImportRef { return isRecord(v) && id(v.libraryId) && id(v.importId) && v.state === 'ready' && Array.isArray(v.versions) && v.versions.length > 0 && v.versions.every(x => isAssetVersionRef(x) && x.libraryId === v.libraryId); }
export function isAssetSnapshot(v: unknown): v is AssetSnapshot { return isRecord(v) && id(v.libraryId) && Number.isSafeInteger(v.snapshotSeq) && (v.snapshotSeq as number) >= 0 && Array.isArray(v.assets) && v.assets.every(a => isRecord(a) && isAssetVersionRef(a.ref) && a.ref.libraryId === v.libraryId && (a.sourceArtifactRef === null || isArtifactRef(a.sourceArtifactRef) && a.sourceArtifactRef.libraryId === v.libraryId) && typeof a.name === 'string' && isOptionalMetadata(a) && ['image/png', 'image/jpeg', 'image/webp', 'video/mp4', 'text/plain', 'audio/wav', 'audio/mpeg', 'audio/mp4'].includes(a.mime as string) && Number.isSafeInteger(a.byteLength) && (a.byteLength as number) > 0 && (a.mime === 'text/plain' || String(a.mime).startsWith('audio/') ? a.width === 0 && a.height === 0 && (a.byteLength as number) <= (a.mime === 'text/plain' ? 1024 * 1024 : 128 * 1024 * 1024) : [a.width, a.height].every(n => Number.isSafeInteger(n) && (n as number) > 0))); }
export function parseImportGrantedFiles(v: unknown): Result<ImportGrantedFilesInput> { return isRecord(v) && Object.keys(v).every(k => ['grantId','assetId','expectedVersion'].includes(k)) && id(v.grantId) && (v.assetId === undefined ? v.expectedVersion === undefined : id(v.assetId) && revision(v.expectedVersion)) ? ok({ grantId: v.grantId, ...(v.assetId === undefined ? {} : { assetId: v.assetId as string, expectedVersion: v.expectedVersion as number }) }) : fail('INVALID_INPUT', '请选择已授权的文件和明确目标版本。'); }
export function parseSaveArtifact(v: unknown): Result<SaveArtifactInput> {
  if (!isRecord(v) || Object.keys(v).some(k => !['artifactRef', 'name', 'assetId', 'expectedVersion'].includes(k)) || !isArtifactRef(v.artifactRef) || typeof v.name !== 'string' || !v.name.trim() || v.name.length > 200 || (v.assetId !== undefined && (!id(v.assetId) || !Number.isSafeInteger(v.expectedVersion) || (v.expectedVersion as number) < 1)) || (v.assetId === undefined && v.expectedVersion !== undefined)) return fail('INVALID_INPUT', '资产版本参数无效。');
  return ok({ artifactRef: v.artifactRef, name: v.name.trim(), ...(v.assetId === undefined ? {} : { assetId: v.assetId as string, expectedVersion: v.expectedVersion as number }) });
}
export function parseMediaRead(v: unknown): Result<MediaReadInput> { return isRecord(v) && id(v.libraryId) && isMediaReference(v.ref) && (v.variant === 'original' || v.variant === 'thumbnail') && Object.keys(v).length === 3 ? ok(v as unknown as MediaReadInput) : fail('INVALID_INPUT', '媒体引用无效。'); }
const revision = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) > 0;
const validTags = (v: unknown): v is string[] => Array.isArray(v) && v.length <= 20 && v.every(t => typeof t === 'string' && t.trim() === t && t.length > 0 && t.length <= 32) && new Set(v).size === v.length;
function isOptionalMetadata(v: Record<string, unknown>): boolean {
  return (v.metadataRevision === undefined || revision(v.metadataRevision)) && (v.tags === undefined || validTags(v.tags)) && (v.deletedAt === undefined || v.deletedAt === null || typeof v.deletedAt === 'string') && (v.createdAt === undefined || typeof v.createdAt === 'string');
}
export function isAssetMetadataView(v: unknown): v is AssetMetadataView {
  return isRecord(v) && id(v.libraryId) && id(v.assetId) && typeof v.name === 'string' && v.name.trim().length > 0 && revision(v.metadataRevision) && validTags(v.tags) && (v.deletedAt === null || typeof v.deletedAt === 'string') && typeof v.createdAt === 'string';
}
export function isAssetHistory(v: unknown): v is AssetHistory {
  return isRecord(v) && id(v.libraryId) && id(v.assetId) && isAssetSnapshot({ libraryId: v.libraryId, assets: v.versions, snapshotSeq: 0 }) && (v.versions as AssetView[]).every(a => a.ref.assetId === v.assetId);
}
export function parseAssetRevision(v: unknown): Result<AssetRevisionInput> {
  return isRecord(v) && Object.keys(v).length === 2 && id(v.assetId) && revision(v.expectedRevision) ? ok({ assetId: v.assetId, expectedRevision: v.expectedRevision }) : fail('INVALID_INPUT', '资产元数据需要明确版本。');
}
export function parseUpdateAssetMetadata(v: unknown): Result<UpdateAssetMetadataInput> {
  if (!isRecord(v) || Object.keys(v).length !== 4 || !id(v.assetId) || !revision(v.expectedRevision) || typeof v.name !== 'string' || !v.name.trim() || v.name.trim().length > 200 || !Array.isArray(v.tags) || v.tags.length > 20 || !v.tags.every(t => typeof t === 'string' && t.trim().length > 0 && t.trim().length <= 32)) return fail('INVALID_INPUT', '名称最多200字符，标签最多20个、每个1–32字符。');
  return ok({ assetId: v.assetId, expectedRevision: v.expectedRevision, name: v.name.trim(), tags: [...new Set(v.tags.map(t => (t as string).trim()))] });
}
export function parseAssetSearch(v: unknown): Result<AssetSearchInput> {
  return isRecord(v) && Object.keys(v).every(k => ['name','tag','mediaType','state','latestOnly'].includes(k)) && (v.name === undefined || typeof v.name === 'string' && v.name.length <= 200) && (v.tag === undefined || typeof v.tag === 'string' && v.tag.trim().length > 0 && v.tag.trim().length <= 32) && (v.mediaType === undefined || ['image','video','text','audio'].includes(v.mediaType as string)) && (v.state === undefined || ['active','trash'].includes(v.state as string)) && (v.latestOnly === undefined || typeof v.latestOnly === 'boolean') ? ok(v as AssetSearchInput) : fail('INVALID_INPUT', '资产检索参数无效。');
}
