import { fail, isRecord, ok, type Result } from './result.ts';

export interface CreateProjectInput { name: string }
export interface ProjectRef { id: string; libraryId: string; name: string; createdAt: string }

export function parseCreateProject(value: unknown): Result<CreateProjectInput> {
  if (!isRecord(value) || typeof value.name !== 'string' || value.name.trim().length === 0 || value.name.trim().length > 200) {
    return fail('INVALID_INPUT', '项目名称需要包含 1–200 个字符。');
  }
  return ok({ name: value.name.trim() });
}

export function isProject(value: unknown): value is ProjectRef {
  return isRecord(value) && typeof value.id === 'string' && typeof value.libraryId === 'string' && typeof value.name === 'string' && typeof value.createdAt === 'string';
}
