import { isRecord } from './result.ts';
export interface ExportCreationInput { projectId: string; scriptId: string; revision: number; format: 'json' | 'markdown' }
export interface ExportCreationResult { filename: string; relativePath: string; snapshotId: string; scriptRevision: number }
export function isExportCreationInput(value: unknown): value is ExportCreationInput {
  return isRecord(value) && Object.keys(value).length === 4 && ['projectId','scriptId'].every(key => typeof value[key] === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(value[key] as string)) && Number.isSafeInteger(value.revision) && (value.revision as number)>0 && ['json','markdown'].includes(value.format as string);
}
