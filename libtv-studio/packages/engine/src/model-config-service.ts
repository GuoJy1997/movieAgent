import type { LibraryHandle } from '../../storage/src/database.ts';
import { fail, ok, type Result } from '../../contracts/src/result.ts';
import { isProviderVerification, isCredentialStatus, isModelDefinition, isModelProfile, isProviderConnection, type CredentialRef, type CredentialStatus, type ModelDefinition, type ModelProfile, type ProviderConnection, type RevisionRef, type SaveConnectionInput, type SaveModelInput, type SaveProfileInput } from '../../contracts/src/models.ts';
import { resolveModelParameters, adapterSupportsModel } from '../../domain/src/model-config.ts';
type Table = 'connection_revision' | 'model_revision' | 'profile_revision';

/** Called only by the command router while its domain/event/receipt transaction is open.
 * Credential status methods are trusted main→child operations, never command handlers. */
export function modelConfigFor(library: LibraryHandle) {
  function get<T>(table: Table, ref: RevisionRef, validate: (v: unknown) => v is T): Result<T> {
    if (ref.libraryId !== library.libraryId) return fail('WRONG_LIBRARY', '配置版本属于其他资料库。');
    const row = library.db.prepare(`SELECT data_json FROM ${table} WHERE id=? AND revision=? AND library_id=?`).get(ref.id, ref.revision, library.libraryId);
    if (!row) return fail('REVISION_NOT_FOUND', '指定配置版本不存在。');
    const value: unknown = JSON.parse(row.data_json as string);
    return validate(value) ? ok(value) : fail('INVALID_STORED_DATA', '已保存的配置版本无效。');
  }
  function next(table: Table, input: { id: string; expectedRevision: number }): Result<number> {
    const latest = (library.db.prepare(`SELECT COALESCE(MAX(revision),0) AS revision FROM ${table} WHERE id=?`).get(input.id) as { revision: number }).revision;
    return latest === input.expectedRevision ? ok(latest + 1) : fail('REVISION_CONFLICT', '配置已修改，请读取最新版本后重试。');
  }
  function credential(ref: CredentialRef, connectionId: string): Result<void> {
    if (ref.libraryId !== library.libraryId || ref.connectionId !== connectionId) return fail('WRONG_CREDENTIAL_OWNER', '凭据不属于此资料库和连接。');
    const row = library.db.prepare('SELECT state FROM credential_authorization WHERE id=? AND version=? AND library_id=? AND connection_id=?').get(ref.id, ref.version, ref.libraryId, connectionId);
    return row?.state === 'protected' || row?.state === 'session' ? ok(undefined) : fail('CREDENTIAL_UNAVAILABLE', '凭据未授权、不可用或已撤销，请通过专用入口重新配置。');
  }
  function stamp(input: { id: string; expectedRevision: number }, revision: number) { const { expectedRevision: _e, ...data } = input; return { ...data, libraryId: library.libraryId, revision, createdAt: new Date().toISOString() }; }
  function reference(input: { id: string }, revision: number): RevisionRef { return { libraryId: library.libraryId, id: input.id, revision }; }
  function list<T>(table: Table, validate: (v: unknown) => v is T): T[] {
    const values: unknown[] = library.db.prepare(`SELECT data_json FROM ${table} ORDER BY rowid`).all().map(row => JSON.parse(row.data_json as string));
    if (!values.every(validate)) throw new Error('Invalid stored configuration');
    return values;
  }
  function cursor() { return { snapshotSeq: (library.db.prepare('SELECT COALESCE(MAX(seq),0) AS seq FROM domain_event').get() as { seq: number }).seq, streamId: (library.db.prepare('SELECT stream_id FROM event_stream WHERE singleton=1').get() as { stream_id: string }).stream_id }; }
  return {
    saveConnection(input: SaveConnectionInput): Result<RevisionRef> {
      const revision = next('connection_revision', input); if (!revision.ok) return revision;
      for (const ref of [...(input.credentialRef ? [input.credentialRef] : []), ...Object.values(input.headers)]) { const allowed = credential(ref, input.id); if (!allowed.ok) return allowed; }
      const value: ProviderConnection = { ...input, ...stamp(input, revision.value) }; delete (value as unknown as Record<string, unknown>).expectedRevision;
      library.db.prepare('INSERT INTO connection_revision(id,revision,library_id,data_json) VALUES(?,?,?,?)').run(input.id, revision.value, library.libraryId, JSON.stringify(value));
      return ok(reference(input, revision.value));
    },
    saveModel(input: SaveModelInput): Result<RevisionRef> {
      const revision = next('model_revision', input); if (!revision.ok) return revision;
      const connection = get('connection_revision', input.connectionRef, isProviderConnection); if (!connection.ok) return connection;
      if (!adapterSupportsModel(connection.value, input)) return fail('CONFIG_MISMATCH', '适配器与模型能力不匹配。');
      const value: ModelDefinition = { ...input, ...stamp(input, revision.value) }; delete (value as unknown as Record<string, unknown>).expectedRevision;
      library.db.prepare('INSERT INTO model_revision(id,revision,library_id,connection_id,connection_revision,data_json) VALUES(?,?,?,?,?,?)').run(input.id, revision.value, library.libraryId, input.connectionRef.id, input.connectionRef.revision, JSON.stringify(value));
      return ok(reference(input, revision.value));
    },
    saveProfile(input: SaveProfileInput, engineOwned = false): Result<RevisionRef> {
      if ((input.id.startsWith('agent-profile-') || input.id.startsWith('shot-profile-')) && (!engineOwned || input.expectedRevision !== 0)) return fail('IMMUTABLE_PROFILE', '引擎派生 Profile 为保留的不可变配置。');
      const revision = next('profile_revision', input); if (!revision.ok) return revision;
      const model = get('model_revision', input.modelRef, isModelDefinition); if (!model.ok) return model;
      const parameters = resolveModelParameters(model.value, input.parameters); if (!parameters.ok) return parameters;
      const value: ModelProfile = { ...input, ...stamp(input, revision.value), parameters: parameters.value }; delete (value as unknown as Record<string, unknown>).expectedRevision;
      library.db.prepare('INSERT INTO profile_revision(id,revision,library_id,model_id,model_revision,data_json) VALUES(?,?,?,?,?,?)').run(input.id, revision.value, library.libraryId, input.modelRef.id, input.modelRef.revision, JSON.stringify(value));
      return ok(reference(input, revision.value));
    },
    listConnections() { return { connections: list('connection_revision', isProviderConnection), credentialStatuses: this.credentialStatuses(), verification: library.db.prepare('SELECT state_json FROM provider_verification ORDER BY rowid').all().map(row => { const state: unknown = JSON.parse(row.state_json as string); if (!isProviderVerification(state)) throw Error('INVALID_STORED_DATA'); return state; }), ...cursor() }; },
    listModels() { return { models: list('model_revision', isModelDefinition), ...cursor() }; },
    listProfiles() { return { profiles: list('profile_revision', isModelProfile), ...cursor() }; },
    credentialStatuses(): CredentialStatus[] {
      return library.db.prepare('SELECT id,version,library_id,connection_id,state FROM credential_authorization ORDER BY rowid').all().map(row => ({ ref: { id: row.id as string, version: row.version as number, libraryId: row.library_id as string, connectionId: row.connection_id as string }, state: row.state as CredentialStatus['state'] }));
    },
    updateCredentialStatus(input: unknown): Result<void> {
      const owner = library.checkOwnership(); if (!owner.ok) return owner;
      if (!isCredentialStatus(input)) return fail('INVALID_INPUT', '凭据状态格式无效。');
      if (input.ref.libraryId !== library.libraryId) return fail('WRONG_LIBRARY', '凭据属于其他资料库。');
      if (!library.db.prepare('SELECT 1 FROM connection_revision WHERE id=? AND library_id=?').get(input.ref.connectionId, library.libraryId)) return fail('REVISION_NOT_FOUND', '凭据连接不存在。');
      try {
        library.db.exec('BEGIN IMMEDIATE');
        const old = library.db.prepare('SELECT version,library_id,connection_id,state FROM credential_authorization WHERE id=?').get(input.ref.id);
        if (old && (old.version !== input.ref.version || old.library_id !== input.ref.libraryId || old.connection_id !== input.ref.connectionId || old.state === 'revoked' && input.state !== 'revoked')) { library.db.exec('ROLLBACK'); return fail('CREDENTIAL_BINDING_CONFLICT', '凭据身份或撤销状态不能改变。'); }
        if (old?.state === input.state) { library.db.exec('ROLLBACK'); return ok(undefined); }
        library.db.prepare('INSERT INTO credential_authorization(id,version,library_id,connection_id,state) VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET state=excluded.state').run(input.ref.id, input.ref.version, library.libraryId, input.ref.connectionId, input.state);
        library.db.prepare('INSERT INTO domain_event(library_id,kind,payload_json) VALUES(?,?,?)').run(library.libraryId, 'credential.statusChanged', JSON.stringify(input));
        library.db.exec('COMMIT'); return ok(undefined);
      } catch { try { library.db.exec('ROLLBACK'); } catch { /* No transaction. */ } return fail('CREDENTIAL_STATUS_FAILED', '凭据状态未同步，请重新打开连接。'); }
    },
  };
}
