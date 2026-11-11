import { CURRENT_SCHEMA_VERSION } from '../packages/contracts/src/schema.ts';
// Never included in npm test. A future human-authorized check uses saved refs;
// this script neither accepts keys nor reads credential files/environment keys.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve, sep } from 'node:path';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
const fail = code => { throw new Error(code); };
const id = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(value);
const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
function validate(value) {
  const keys = ['schemaVersion','executable','libraryRoot','userData','libraryId','projectId','connectionRef','profileRef','prompt','count','currency','allowanceMicros','budgetLimitMicros','acknowledgeUnknown','evidenceFile'];
  const reference = ref => exact(ref, ['libraryId','id','revision']) && ref.libraryId === value.libraryId && id(ref.id) && Number.isSafeInteger(ref.revision) && ref.revision > 0;
  if (!exact(value, keys) || value.schemaVersion !== 1 || !id(value.libraryId) || !id(value.projectId) || !reference(value.connectionRef) || !reference(value.profileRef) || value.count !== 1 || !/^[A-Z]{3}$/.test(value.currency) || ![value.allowanceMicros,value.budgetLimitMicros].every(n => Number.isSafeInteger(n) && n > 0 && n <= 1e12) || value.allowanceMicros > value.budgetLimitMicros || typeof value.acknowledgeUnknown !== 'boolean' || typeof value.prompt !== 'string' || !value.prompt.trim() || value.prompt.length > 16000 || /[\u0000\u007f]/.test(value.prompt) || !['executable','libraryRoot','userData','evidenceFile'].every(key => typeof value[key] === 'string' && isAbsolute(value[key]) && !/[\r\n\u0000]/.test(value[key]))) fail('LIVE_CONFIG_INVALID');
  return value;
}
async function run(config) {
  const { DatabaseSync } = await import('node:sqlite');
  // Refuse busy libraries before starting their scheduler. No credentials read.
  const db = new DatabaseSync(join(config.libraryRoot, 'library.sqlite'), { readOnly: true });
  try {
    if (db.prepare('PRAGMA user_version').get().user_version !== CURRENT_SCHEMA_VERSION || db.prepare('SELECT id FROM library').get()?.id !== config.libraryId || db.prepare('SELECT COUNT(*) n FROM engine_owner').get().n !== 0 || db.prepare("SELECT COUNT(*) n FROM task_attempt WHERE json_extract(view_json,'$.state') NOT IN ('SUCCEEDED','FAILED','CANCELLED') OR json_extract(view_json,'$.providerState') IN ('submitting','accepted','unknown') OR (json_extract(view_json,'$.providerState')='completed' AND json_extract(view_json,'$.collectionState')<>'durable')").get().n !== 0) fail('LIVE_LIBRARY_NOT_IDLE');
  } finally { db.close(); }
  const outboxPath = join(config.userData, 'client-state/command-outbox.sqlite');
  if (existsSync(outboxPath)) {
    const outbox = new DatabaseSync(outboxPath, { readOnly: true });
    try { if (outbox.prepare('SELECT COUNT(*) n FROM pending_command').get().n !== 0) fail('LIVE_LIBRARY_NOT_IDLE'); } finally { outbox.close(); }
  }
  // The evidence path is an explicit once-only admission marker. Never blindly
  // rerun after a timeout, unknown submission, process failure, or late ACK.
  await mkdir(dirname(config.evidenceFile), { recursive: true });
  await writeFile(config.evidenceFile, JSON.stringify({ status: 'started-do-not-resubmit', count: 1, startedAt: new Date().toISOString() }), { flag: 'wx' });
  const { _electron } = await import('@playwright/test');
  let app, page, descriptor, prepared, task, final;
  const started = Date.now();
  const unwrap = result => { if (!result.ok) fail('LIVE_COMMAND_REJECTED'); return result.value; };
  const launch = async () => {
    app = await _electron.launch({ executablePath: config.executable, args: [`--library-root=${config.libraryRoot}`, `--user-data-dir=${config.userData}`, `--live-image-check-library=${config.libraryId}`], timeout: 20000 });
    page = await app.firstWindow(); await page.waitForFunction(() => Boolean(window.studio));
    descriptor = unwrap(await page.evaluate(() => window.studio.describe()));
    if (descriptor.libraryId !== config.libraryId) fail('LIVE_LIBRARY_MISMATCH');
  };
  const query = async (kind, payload = {}) => unwrap(await page.evaluate(value => window.studio.query(value), { schemaVersion: 1, libraryId: config.libraryId, connectionEpoch: descriptor.connectionEpoch, queryId: 'live-check', kind, payload }));
  const execute = async (kind, payload, suffix) => unwrap(await page.evaluate(value => window.studio.execute(value), { schemaVersion: 1, libraryId: config.libraryId, connectionEpoch: descriptor.connectionEpoch, commandId: `${runId}-${suffix}`, kind, payload })).result;
  const runId = `live-${createHash('sha256').update(config.evidenceFile).digest('hex').slice(0,32)}`;
  try {
    await launch();
    if ((await query('task.list')).tasks.some(task => !['SUCCEEDED','FAILED','CANCELLED'].includes(task.state))) fail('LIVE_LIBRARY_NOT_IDLE');
    prepared = await execute('generation.prepare', { projectId: config.projectId, profileRef: config.profileRef, prompt: config.prompt, inputVersion: runId, executionOwner: 'human', runId }, 'prepare');
    const actual = prepared.config.connection;
    if (actual.libraryId !== config.connectionRef.libraryId || actual.id !== config.connectionRef.id || actual.revision !== config.connectionRef.revision) fail('LIVE_REFERENCE_MISMATCH');
    task = await execute('generation.approveAndEnqueue', { preparedId: prepared.preparedId, approvedPlanHash: prepared.planHash, currency: config.currency, allowanceMicros: config.allowanceMicros, budgetLimitMicros: config.budgetLimitMicros, acknowledgeUnknown: config.acknowledgeUnknown, executionOwner: 'human', runId }, 'approve');
    const deadline = Date.now() + 300000;
    do {
      final = await query('task.read', { taskId: task.taskId });
      if (['SUCCEEDED','FAILED','CANCELLED','SUBMISSION_UNKNOWN','RECONCILE_REQUIRED'].includes(final.state) || final.collectionState === 'retryable_failure') break;
      await new Promise(resolve => setTimeout(resolve, 250));
    } while (Date.now() < deadline);
    if (final.state !== 'SUCCEEDED' || !final.artifactRef) fail('LIVE_INCOMPLETE_DO_NOT_RESUBMIT');
    await app.close(); app = undefined;
    // Reopen through the actual engine/bridge, then inspect immutable original.
    await launch();
    const reopened = await query('task.read', { taskId: task.taskId });
    if (reopened.state !== 'SUCCEEDED' || reopened.artifactRef?.artifactId !== final.artifactRef.artifactId) fail('LIVE_REOPEN_FAILED');
    await app.close(); app = undefined;
    const inspection = new DatabaseSync(join(config.libraryRoot, 'library.sqlite'), { readOnly: true });
    let object;
    try { object = inspection.prepare('SELECT b.* FROM blob_object b JOIN artifact a ON a.object_id=b.object_id WHERE a.id=?').get(final.artifactRef.artifactId); } finally { inspection.close(); }
    if (!object) fail('LIVE_ORIGINAL_MISSING');
    const path = resolve(config.libraryRoot, object.storage_key);
    if (!path.startsWith(resolve(config.libraryRoot) + sep)) fail('LIVE_ORIGINAL_PATH_INVALID');
    const bytes = await readFile(path), hash = createHash('sha256').update(bytes).digest('hex');
    if (hash !== object.hash || bytes.length !== object.byte_length) fail('LIVE_ORIGINAL_HASH_FAILED');
    // Hash external request/task IDs; omit prompts, URLs, provider bodies and keys.
    const redacted = value => value === null ? null : createHash('sha256').update(value).digest('hex');
    const evidence = { status: 'verified', count: 1, allowanceMicros: config.allowanceMicros, budgetLimitMicros: config.budgetLimitMicros, libraryId: config.libraryId, connectionRef: config.connectionRef, profileRef: config.profileRef, modelRef: prepared.config.profile.modelRef, modelId: prepared.config.model.modelId, planHash: prepared.planHash, taskId: task.taskId, requestIdHash: redacted(final.clientRequestId), providerTaskIdHash: redacted(final.providerTaskId), original: { sha256: hash, bytes: bytes.length }, elapsedMs: Date.now() - started, reportedActualMicros: final.reportedActualMicros, currency: final.currency, settlementStatus: final.settlementStatus, reopened: true };
    await writeFile(config.evidenceFile, JSON.stringify(evidence, null, 2));
    console.log(JSON.stringify({ verified: true, evidenceFile: config.evidenceFile }));
  } finally { await app?.close(); }
}
try {
  const args = process.argv.slice(2); let configPath, validateOnly = false, optIn = false;
  while (args.length) {
    const flag = args.shift();
    if (flag === '--validate-only' && !validateOnly) validateOnly = true;
    else if (flag === '--allow-paid-image-generation' && !optIn) optIn = true;
    else if (flag === '--config' && !configPath && args[0] && !args[0].startsWith('--')) configPath = args.shift();
    else fail('LIVE_ARGUMENT_INVALID');
  }
  if (!validateOnly && !optIn) fail('LIVE_OPT_IN_REQUIRED');
  if (!configPath) fail('LIVE_CONFIG_INVALID');
  let value; try { value = JSON.parse(await readFile(configPath, 'utf8')); } catch { fail('LIVE_CONFIG_INVALID'); }
  const config = validate(value);
  if (validateOnly) console.log(JSON.stringify({ validated: true, executed: false, count: 1 }));
  else await run(config);
} catch (error) { console.error(error instanceof Error && /^LIVE_[A-Z_]+$/.test(error.message) ? error.message : 'LIVE_CHECK_FAILED_DO_NOT_RESUBMIT'); process.exitCode = 1; }
