import { readFile } from 'node:fs/promises';
import { ArtifactSource } from '../../libtv-studio/packages/providers/src/artifact-source.ts';

const task = JSON.parse(await readFile(new URL('./video-task.json', import.meta.url), 'utf8'));
const bytes = await readFile(new URL('./sample-existing-video.mp4', import.meta.url));
const result = await new ArtifactSource(new URL('./library/', import.meta.url).pathname.replace(/^\/(\w:)/, '$1'), undefined, 'video').stage(`${task.attemptId}-output`, bytes);
if (!result.ok) throw new Error(result.error.code + ': ' + result.error.message);
console.log(JSON.stringify({ staged: true, bytes: bytes.length, source: 'user-supplied-existing-video', taskId: task.taskId }));
