export interface AppError {
  code: string;
  message: string;
  fieldErrors?: Record<string, string>;
  diagnosticId?: string;
}

export type Result<T> = { ok: true; value: T } | { ok: false; error: AppError };
export const ok = <T>(value: T): Result<T> => ({ ok: true, value });
export const fail = (code: string, message: string): Result<never> => ({ ok: false, error: { code, message } });

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
