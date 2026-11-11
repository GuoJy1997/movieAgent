import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { isRecord, ok, type Result } from '../../contracts/src/result.ts';
import type { PreparedGeneration, TaskView } from '../../contracts/src/generation.ts';
import type { AudioTake, TranscriptRevision } from '../../contracts/src/audio.ts';
import type { FileSourceRef } from '../../storage/src/collection-journal.ts';
import type { LibraryHandle } from '../../storage/src/database.ts';
import { normalizeTranscript } from '../../providers/src/audio-protocol.ts';
import type { GenerationOptions } from './generation-service.ts';
import type { ArtifactSource } from '../../providers/src/artifact-source.ts';
interface Publication { transcript?: { text: string; timing: 'none' | 'segments'; segments: TranscriptRevision['segments'] }; diagnostic?: string; usage?: unknown }

/** Parsed response facts are published in the artifact transaction, never by filename inference. */
export function audioCoordinatorFor(library: LibraryHandle, metadataSpool?: ArtifactSource): Pick<GenerationOptions, 'inspectPublication' | 'publishAudio'> {
  return {
    async inspectPublication(prepared: PreparedGeneration, source: FileSourceRef): Promise<Publication | undefined> {
      if (prepared.adapterId === 'minimax-speech-v1' && metadataSpool) {
        const usage = await metadataSpool.recover(source.name.replace(/\.[^.]+$/, '') + '-usage');
        if (usage.ok && usage.value.size <= 256) {
          try { return { usage: JSON.parse(await readFile(usage.value.path, 'utf8')) }; } catch { return; }
        }
      }
      if (prepared.config.model.capabilities.taskTypes[0] !== 'speech_to_text') return;
      if (source.size > 1024 * 1024) return { diagnostic: 'TRANSCRIPT_RESPONSE_LIMIT' };
      try {
        const raw: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await readFile(source.path)));
        const body = isRecord(raw) && isRecord(raw.data) ? raw.data : raw;
        const normalized = normalizeTranscript(body, prepared.audioSource!.durationTicks);
        const usage = isRecord(raw) ? raw.usage ?? raw.extra_info ?? null : null;
        return normalized.ok ? { transcript: normalized.value, usage } : { diagnostic: normalized.error.code, usage };
      } catch { return { diagnostic: 'INVALID_TRANSCRIPT_RESPONSE' }; }
    },
    publishAudio(prepared: PreparedGeneration, task: TaskView, detail: unknown): Result<void> {
      const type = prepared.config.model.capabilities.taskTypes[0];
      if (type !== 'text_to_speech' && type !== 'speech_to_text' || !task.artifactRef) return ok(undefined);
      if (library.db.prepare('SELECT 1 FROM audio_publication WHERE task_id=?').get(task.taskId)) return ok(undefined);
      const publication = detail as Publication | undefined;
      const taskRef = { libraryId: library.libraryId, taskId: task.taskId, attemptId: task.attemptId };
      if (type === 'text_to_speech') {
        const item = library.db.prepare('SELECT audio_batch.project_id,audio_batch_item.line_id,audio_batch_item.line_revision FROM audio_batch_item JOIN audio_batch USING(plan_id) WHERE task_id=?').get(task.taskId);
        if (item) {
          const usage = isRecord(publication?.usage) && Number.isSafeInteger(publication.usage.usageCharacters) && (publication.usage.usageCharacters as number) >= 0 ? { usageCharacters: publication.usage.usageCharacters as number } : null;
          const value: AudioTake = {
            libraryId: library.libraryId, projectId: item.project_id as string, id: randomUUID(),
            lineId: item.line_id as string, lineRevision: item.line_revision as number,
            task: taskRef, output: task.artifactRef,
            profileRef: { libraryId: library.libraryId, id: prepared.config.profile.id, revision: prepared.config.profile.revision },
            providerUsage: usage, createdAt: new Date().toISOString(),
          };
          library.db.prepare('INSERT INTO audio_take VALUES(?,?,?) ON CONFLICT(task_id) DO NOTHING').run(task.taskId, prepared.projectId, JSON.stringify(value));
        }
      } else if (publication?.transcript && prepared.audioSource) {
        const value: TranscriptRevision = {
          ...publication.transcript, libraryId: library.libraryId, projectId: prepared.projectId,
          id: randomUUID(), revision: 1, task: taskRef, source: prepared.audioSource.ref,
          sourceHash: prepared.audioSource.hash, sourceDurationTicks: prepared.audioSource.durationTicks,
          createdAt: new Date().toISOString(),
        };
        library.db.prepare('INSERT INTO transcript_revision VALUES(?,?,?,?,?)').run(prepared.projectId, value.id, 1, task.taskId, JSON.stringify(value));
      }
      library.db.prepare('INSERT INTO audio_publication VALUES(?,?,?)').run(task.taskId, publication?.diagnostic ?? null, publication?.usage === undefined ? null : JSON.stringify(publication.usage));
      library.db.prepare('UPDATE audio_batch_item SET diagnostic=? WHERE task_id=?').run(publication?.diagnostic ?? null, task.taskId);
      return ok(undefined);
    },
  };
}
