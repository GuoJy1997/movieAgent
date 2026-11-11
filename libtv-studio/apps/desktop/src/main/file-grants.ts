import { randomUUID } from 'node:crypto';
import { lstat, realpath } from 'node:fs/promises';
import { dirname, extname, isAbsolute } from 'node:path';
import type { FileGrantRef } from '../../../../packages/contracts/src/assets.ts';
import type { FileSourceRef } from '../../../../packages/storage/src/collection-journal.ts';
import { fail, ok, type Result } from '../../../../packages/contracts/src/result.ts';
export interface FileGrant extends Omit<FileGrantRef, 'fileCount'> { files: FileSourceRef[] }
/** Called only with OS picker results. Absolute source paths never enter the generic bridge. */
export async function issueFileGrant(libraryId: string, paths: string[]): Promise<Result<FileGrant>> {
  if (!paths.length || paths.length > 32) return fail('INVALID_INPUT', '每次请选择 1–32 个素材文件。');
  try {
    const files: FileSourceRef[] = [];
    for (const path of paths) {
      if (!isAbsolute(path) || path.startsWith('\\\\')) return fail('INVALID_FILE_PATH', '请选择本地磁盘文件。');
      if (!['.png','.jpg','.jpeg','.webp','.mp4','.wav','.mp3','.m4a','.txt','.md'].includes(extname(path).toLowerCase())) return fail('UNSUPPORTED_MEDIA', '仅支持图片、MP4、WAV、MP3、M4A、TXT 和 MD 文件。');
      const s = await lstat(path); const resolved = await realpath(path);
      if (!s.isFile() || s.isSymbolicLink() || resolved.toLowerCase() !== path.toLowerCase()) return fail('FILE_GRANT_CHANGED', '文件路径包含链接或不是普通文件。');
      files.push({ path, realPath: resolved, allowedRoot: await realpath(dirname(path)), name: path.split(/[\\/]/).pop()!, size: s.size, mtimeMs: s.mtimeMs, dev: s.dev, ino: s.ino });
    }
    return ok({ grantId: randomUUID(), importId: randomUUID(), libraryId, expiresAt: Date.now() + 120000, files });
  } catch { return fail('FILE_GRANT_FAILED', '无法授权此文件，请检查文件权限。'); }
}
