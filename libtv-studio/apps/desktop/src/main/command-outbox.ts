import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, isAbsolute } from 'node:path';
import { isReceipt, parseCommand, type CommandEnvelope } from '../../../../packages/contracts/src/commands.ts';
import { fail, ok, type Result } from '../../../../packages/contracts/src/result.ts';
import { requestHash } from '../../../../packages/engine/src/command-router.ts';

/** Main owns this separate client database; it never writes library.sqlite. */
export class CommandOutbox {
  private readonly db: DatabaseSync;
  private closed = false;
  constructor(path: string) {
    if (!isAbsolute(path)) throw new Error('Outbox requires an absolute client-state path');
    mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=0;
      CREATE TABLE IF NOT EXISTS pending_command(library_id TEXT NOT NULL,command_id TEXT NOT NULL,request_hash TEXT NOT NULL,envelope_json TEXT NOT NULL,PRIMARY KEY(library_id,command_id)) STRICT;
      CREATE TABLE IF NOT EXISTS rejected_command(library_id TEXT NOT NULL,command_id TEXT NOT NULL,request_hash TEXT NOT NULL,envelope_json TEXT NOT NULL,error_code TEXT NOT NULL,PRIMARY KEY(library_id,command_id)) STRICT;`);
  }
  enqueue(input: unknown): Result<CommandEnvelope> {
    const parsed = parseCommand(input); if (!parsed.ok) return parsed;
    const envelope = parsed.value;
    const hash = requestHash(envelope);
    try {
      const previous = this.db.prepare('SELECT request_hash FROM pending_command WHERE library_id=? AND command_id=?').get(envelope.libraryId, envelope.commandId);
      if (previous && previous.request_hash !== hash) return fail('COMMAND_ID_REUSED', '此命令 ID 的未确认参数不同。');
      this.db.prepare('INSERT INTO pending_command VALUES(?,?,?,?) ON CONFLICT(library_id,command_id) DO UPDATE SET envelope_json=excluded.envelope_json').run(envelope.libraryId, envelope.commandId, hash, JSON.stringify(envelope));
      return ok(envelope);
    } catch { return fail('OUTBOX_WRITE_FAILED', '无法保存待确认操作，命令尚未发送。'); }
  }
  pending(libraryId: string): CommandEnvelope[] {
    return this.db.prepare('SELECT envelope_json,request_hash FROM pending_command WHERE library_id=? ORDER BY rowid').all(libraryId).map(row => {
      const parsed = parseCommand(JSON.parse(row.envelope_json as string));
      if (!parsed.ok || parsed.value.libraryId !== libraryId || requestHash(parsed.value) !== row.request_hash) throw new Error('Invalid persisted outbox record');
      return parsed.value;
    });
  }
  hasPending(): boolean { return this.db.prepare('SELECT 1 FROM pending_command LIMIT 1').get() !== undefined; }
  settle(input: unknown): boolean {
    if (!isReceipt(input)) return false;
    return this.db.prepare('DELETE FROM pending_command WHERE library_id=? AND command_id=? AND request_hash=?').run(input.libraryId, input.commandId, input.requestHash).changes === 1;
  }
  reject(command: CommandEnvelope, code: string): void {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.prepare('INSERT INTO rejected_command SELECT library_id,command_id,request_hash,envelope_json,? FROM pending_command WHERE library_id=? AND command_id=? AND request_hash=? ON CONFLICT(library_id,command_id) DO NOTHING').run(code, command.libraryId, command.commandId, requestHash(command));
      this.db.prepare('DELETE FROM pending_command WHERE library_id=? AND command_id=? AND request_hash=?').run(command.libraryId, command.commandId, requestHash(command));
      this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  close(): void { if (!this.closed) { this.closed = true; this.db.close(); } }
}
