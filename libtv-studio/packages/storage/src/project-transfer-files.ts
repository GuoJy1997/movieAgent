import { createHash, randomUUID } from 'node:crypto';
import { link, lstat, mkdir, open, realpath, unlink } from 'node:fs/promises';
import { dirname, isAbsolute, join, parse, relative, resolve, sep } from 'node:path';
import { BACKUP_LIMITS, isBackupPath, type BackupFile } from '../../contracts/src/project-maintenance.ts';

export class TransferError extends Error { readonly code: string; constructor(code: string) { super(code); this.code = code; } }
export function transferError(error: unknown): string { return error instanceof TransferError ? error.code : 'PROJECT_TRANSFER_FAILED'; }
export function sha256(bytes: Uint8Array): string { return createHash('sha256').update(bytes).digest('hex'); }
export async function writeTransferJson(root: string, path: string, value: unknown): Promise<void> {
  const target = join(root, path), temporary = `${target}.${randomUUID()}.tmp`;
  const handle = await open(temporary, 'wx', 0o600);
  try {
    try { await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`); await handle.sync(); } finally { await handle.close(); }
    await link(temporary, target);
  } finally { await unlink(temporary).catch(() => undefined); }
}
export async function localDirectory(input: string): Promise<string> {
  if (typeof input !== 'string' || !isAbsolute(input) || /^(?:\\\\|\/\/)/.test(input) || /[\u0000-\u001f]/u.test(input)) throw new TransferError('INVALID_PROJECT_PATH');
  const path = resolve(input), root = parse(path).root;
  let current = root;
  for (const part of relative(root, path).split(sep).filter(Boolean)) { current = join(current, part); const stat = await lstat(current); if (!stat.isDirectory() || stat.isSymbolicLink()) throw new TransferError('TRANSFER_PATH_CONFLICT'); }
  return realpath(path);
}
export function samePath(a: string, b: string): boolean { return process.platform === 'win32' ? resolve(a).toLowerCase() === resolve(b).toLowerCase() : resolve(a) === resolve(b); }
function contains(parent: string, child: string): boolean { const path = relative(parent, child); return path === '' || !path.startsWith('..' + sep) && path !== '..' && !isAbsolute(path); }
export async function transferDestination(source: string, target: string): Promise<string> {
  if (typeof target !== 'string' || !isAbsolute(target) || /^(?:\\\\|\/\/)/.test(target) || !isBackupPath(parse(resolve(target)).base) || /[\u0000-\u001f]/u.test(target)) throw new TransferError('INVALID_PROJECT_PATH');
  const parent = await localDirectory(dirname(resolve(target))), destination = join(parent, parse(resolve(target)).base);
  if (contains(source, destination) || contains(destination, source)) throw new TransferError('TRANSFER_PATH_CONFLICT');
  return destination;
}
export async function plainPath(root: string, path: string, type: 'file' | 'directory'): Promise<string> {
  if (!isBackupPath(path)) throw new TransferError('INVALID_BACKUP_PATH');
  const parts = path.split('/'); let current = root;
  for (let i = 0; i < parts.length; i++) {
    current = join(current, parts[i]!); const stat = await lstat(current);
    if (stat.isSymbolicLink() || (i < parts.length - 1 || type === 'directory' ? !stat.isDirectory() : !stat.isFile())) throw new TransferError('TRANSFER_PATH_CONFLICT');
  }
  return current;
}
export async function readLimited(root: string, path: string, limit: number): Promise<Buffer> {
  const file = await open(await plainPath(root, path, 'file'), 'r');
  try {
    if ((await file.stat()).size > limit) throw new TransferError('BACKUP_LIMIT_EXCEEDED');
    const bytes = Buffer.alloc(limit + 1); let length = 0;
    while (length < bytes.length) { const next = await file.read(bytes, length, bytes.length - length, null); if (next.bytesRead === 0) break; length += next.bytesRead; }
    if (length > limit) throw new TransferError('BACKUP_LIMIT_EXCEEDED');
    return bytes.subarray(0, length);
  } finally { await file.close(); }
}
/** Hash the bytes actually copied, detect normal concurrent edits and never follow links. */
export async function transferFile(source: string, relativePath: string, target?: string): Promise<BackupFile> {
  const path = await plainPath(source, relativePath, 'file'), input = await open(path, 'r');
  let output: Awaited<ReturnType<typeof open>> | undefined;
  try {
    const before = await input.stat(); if (before.size > BACKUP_LIMITS.fileBytes) throw new TransferError('BACKUP_LIMIT_EXCEEDED');
    if (target) { await mkdir(dirname(target), { recursive: true }); output = await open(target, 'wx', 0o600); }
    const hash = createHash('sha256'), buffer = Buffer.alloc(1024 * 1024); let count = 0;
    while (true) { const { bytesRead } = await input.read(buffer, 0, buffer.length, null); if (!bytesRead) break; count += bytesRead; if (count > BACKUP_LIMITS.fileBytes) throw new TransferError('BACKUP_LIMIT_EXCEEDED'); const chunk = buffer.subarray(0, bytesRead); hash.update(chunk); if (output) await output.writeFile(chunk); }
    const after = await input.stat();
    if (count !== before.size || before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ino !== after.ino) throw new TransferError('PROJECT_CHANGED_DURING_BACKUP');
    if (output) await output.sync();
    return { path: relativePath, byteLength: count, sha256: hash.digest('hex') };
  } finally { await output?.close(); await input.close(); }
}
