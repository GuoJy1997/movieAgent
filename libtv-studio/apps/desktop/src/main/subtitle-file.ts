import { open, lstat } from 'node:fs/promises';
import { basename, extname } from 'node:path';
import { fail, ok, type Result } from '../../../../packages/contracts/src/result.ts';
import type { SubtitleFile } from '../../../../packages/contracts/src/desktop.ts';
const MAX_BYTES = 4 * 1024 ** 2;
/** Only main receives the OS-picked path. No renderer-supplied pathname is accepted. */
export async function readSubtitleFile(path: string): Promise<Result<SubtitleFile>> {
    let file: Awaited<ReturnType<typeof open>> | undefined;
    try {
        const link = await lstat(path);
        if (link.isSymbolicLink() || !link.isFile() || extname(path).toLowerCase() !== '.srt')
            return fail('INVALID_SUBTITLE_FILE', '请选择普通 SRT 文件。');
        file = await open(path, 'r');
        const before = await file.stat({ bigint: true });
        if (before.size > BigInt(MAX_BYTES) || before.size === 0n)
            return fail('SUBTITLE_FILE_LIMIT', 'SRT 文件需要1字节至4MiB。');
        const bytes = Buffer.alloc(Number(before.size) + 1);
        let offset = 0;
        while (offset < bytes.length) {
            const result = await file.read(bytes, offset, Math.min(65536, bytes.length - offset), offset);
            if (!result.bytesRead)
                break;
            offset += result.bytesRead;
        }
        const after = await file.stat({ bigint: true }), current = await lstat(path, { bigint: true });
        const stamp = (s: typeof before) => [s.dev, s.ino, s.size, s.mtimeNs, s.ctimeNs].join(':');
        if (offset !== Number(before.size) || stamp(before) !== stamp(after) || stamp(before) !== stamp(current) || !current.isFile() || current.isSymbolicLink())
            return fail('SUBTITLE_FILE_CHANGED', '读取期间文件改变，请重新选择。');
        const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, offset));
        if (text.includes('\u0000'))
            return fail('INVALID_SUBTITLE_ENCODING', 'SRT 需要 UTF-8 纯文本。');
        return ok({ name: basename(path), text });
    }
    catch {
        return fail('INVALID_SUBTITLE_ENCODING', '无法读取 UTF-8 SRT 文件。');
    }
    finally {
        await file?.close();
    }
}
