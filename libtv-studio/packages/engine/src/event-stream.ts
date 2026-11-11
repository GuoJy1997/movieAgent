import type { LibraryHandle } from '../../storage/src/database.ts';
import { isDomainEvent, parseSubscription, type EventBatch } from '../../contracts/src/events.ts';
import { fail, ok, type Result } from '../../contracts/src/result.ts';
import { isProject, type ProjectRef } from '../../contracts/src/projects.ts';
import type { ProjectSnapshot } from '../../contracts/src/queries.ts';
export function eventStreamFor(library: LibraryHandle) {
  const stream = library.db.prepare('SELECT stream_id FROM event_stream WHERE singleton=1').get() as { stream_id: string };
  const latest = () => (library.db.prepare('SELECT COALESCE(MAX(seq),0) AS seq FROM domain_event').get() as { seq: number }).seq;
  function snapshot(): Result<ProjectSnapshot> {
    const ownership = library.checkOwnership(); if (!ownership.ok) return ownership;
    try {
      const projects = library.db.prepare('SELECT id,library_id AS libraryId,name,created_at AS createdAt FROM project ORDER BY rowid').all();
      if (!projects.every(isProject)) return fail('INVALID_STORED_DATA', '项目数据无效，请检查资料库。');
      return ok({ projects: projects as unknown as ProjectRef[], snapshotSeq: latest(), streamId: stream.stream_id });
    } catch { return fail('PROJECT_READ_FAILED', '无法读取项目快照。'); }
  }
  return {
    snapshot,
    read(input: unknown): Result<EventBatch> {
      const ownership = library.checkOwnership(); if (!ownership.ok) return ownership;
      const parsed = parseSubscription(input); if (!parsed.ok) return parsed;
      const request = parsed.value;
      if (request.libraryId !== library.libraryId) return fail('WRONG_LIBRARY', '订阅不属于当前资料库。');
      try {
        // Synchronous engine operations share one event loop: no command can commit
        // between this snapshot and its cursor. Subsequent polls replay durable rows.
        if (!request.cursor) {
          const initial = snapshot(); if (!initial.ok) return initial;
          return ok({ snapshot: initial.value, cursor: { libraryId: library.libraryId, streamId: stream.stream_id, seq: initial.value.snapshotSeq }, events: [] });
        }
        const cursor = request.cursor;
        const first = (library.db.prepare('SELECT first_seq FROM event_stream WHERE singleton=1').get() as { first_seq: number }).first_seq;
        if (cursor.libraryId !== library.libraryId || cursor.streamId !== stream.stream_id || cursor.seq < first - 1 || cursor.seq > latest()) return fail('RESYNC_REQUIRED', '事件游标已失效，请重新同步快照。');
        const rows = library.db.prepare('SELECT seq,library_id,kind,payload_json FROM domain_event WHERE seq>? ORDER BY seq LIMIT 500').all(cursor.seq);
        const events = rows.map(row => ({ libraryId: row.library_id, streamId: stream.stream_id, seq: row.seq, kind: row.kind, payload: JSON.parse(row.payload_json as string) }));
        if (!events.every(isDomainEvent)) return fail('INVALID_STORED_DATA', '事件数据无效，请检查资料库。');
        if (events.some((event, index) => event.seq !== cursor.seq + index + 1)) return fail('RESYNC_REQUIRED', '事件流不连续，请重新同步快照。');
        return ok({ cursor: { ...cursor, seq: events.at(-1)?.seq ?? cursor.seq }, events });
      } catch { return fail('EVENT_READ_FAILED', '无法读取事件，请重新连接。'); }
    },
  };
}
