import { expect, it } from 'vitest';
import { nativeFixture, value, execute } from '../fixtures/native-generation';
it('executes Anthropic Messages and materializes plain text through the production adapter', async()=>{
  const s=await nativeFixture('anthropic-messages-v1','max_tokens','fixture-production-key');s.response({type:'message',role:'assistant',content:[{type:'thinking',thinking:'private fixture reasoning',signature:'fixture-signature'},{type:'text',text:'Hello '},{type:'redacted_thinking',data:'fixture-redacted-data'},{type:'text',text:'Anthropic'}],stop_reason:'end_turn'});
  const {task}=await s.enqueue();const done=value(await s.engine.scheduler.run(task.attemptId));expect(done).toMatchObject({state:'SUCCEEDED',collectionState:'durable'});
  expect(s.requests[0]!.headers).toMatchObject({'x-api-key':'fixture-production-key','anthropic-version':'2023-06-01'});expect(s.requests[0]!.headers.authorization).toBeUndefined();
  expect(s.requests[0]!.url).toBe('/v1/messages');expect(JSON.parse(s.requests[0]!.body.toString())).toEqual({model:'fixture',messages:[{role:'user',content:'A quiet lake'}],stream:false,max_tokens:1024});
  expect(Buffer.from(value(await s.engine.assets.read({libraryId:s.engine.identity.libraryId,ref:done.artifactRef,variant:'original'})).bytes).toString()).toBe('Hello Anthropic');
});
it.each([
  [{type:'thinking',thinking:'private fixture reasoning',signature:'fixture-signature'}],
  [{type:'text',text:'OK'},{type:'tool_use',id:'tool',name:'fixture',input:{}}],
  [{type:'text',text:'OK'},{type:'thinking',thinking:'invalid missing signature'}],
  [{type:'text',text:'OK'},{type:'redacted_thinking',data:42}],
  [{type:'text',text:'OK'},{type:'unknown'}],
].map(content=>[content]))('refuses unusable or malformed Anthropic output without materializing internals (%#)',async content=>{
  const s=await nativeFixture('anthropic-messages-v1');s.response({type:'message',role:'assistant',content,stop_reason:'end_turn'});
  const {task}=await s.enqueue();value(await s.engine.scheduler.run(task.attemptId));
  expect(value(s.engine.generation.read(task.taskId)).artifactRef).toBeNull();expect(s.requests).toHaveLength(1);
});
it('posts the bounded native Chat subset and persists immutable plain text across save and reopen', async () => {
  const s = await nativeFixture(), { task } = await s.enqueue();
  const done = value(await s.engine.scheduler.run(task.attemptId)); expect(done).toMatchObject({ state: 'SUCCEEDED', collectionState: 'durable' });
  expect(s.requests).toHaveLength(1); expect(s.requests[0]!.url).toBe('/v1/chat/completions');
  expect(JSON.parse(s.requests[0]!.body.toString())).toEqual({ model: 'fixture', messages: [{ role: 'user', content: 'A quiet lake' }], stream: false, n: 1, max_tokens: 1024 });
  const ref = value(await execute(s.engine, 'asset.saveArtifact', { artifactRef: done.artifactRef, name: 'Text result' }));
  expect(s.engine.assets.search().assets[0]).toMatchObject({ mime: 'text/plain', width: 0, height: 0 });
  await s.engine.close(); const reopened = await s.open(); value(await reopened.scheduler.recover());
  const original = value(await reopened.assets.read({ libraryId: ref.libraryId, ref, variant: 'original' })); expect(original.mime).toBe('text/plain'); expect(Buffer.from(original.bytes).toString()).toBe('Hello 世界 <script>never execute</script>'); expect(s.requests).toHaveLength(1);
});
it.each(['nul','oversize','utf8','cut','unknown'])('refuses %s output without a second POST on recovery', async mode => {
  const s = await nativeFixture();
  if (mode === 'cut') s.cut(); else if (mode === 'utf8') s.response(Buffer.from([0xff])); else if (mode === 'unknown') s.response({ choices: [] }); else s.response({ choices: [{ message: { content: mode === 'nul' ? 'a\u0000b' : 'x'.repeat(1024 * 1024 + 1) }, finish_reason: 'stop' }] });
  const { task } = await s.enqueue(); value(await s.engine.scheduler.run(task.attemptId)); expect(value(s.engine.generation.read(task.taskId)).artifactRef).toBeNull();
  await s.engine.close(); const reopened = await s.open(); value(await reopened.scheduler.recover()); value(await reopened.scheduler.run(task.attemptId)); expect(s.requests).toHaveLength(1); expect(value(reopened.generation.read(task.taskId)).artifactRef).toBeNull();
});
it('keeps explicit text imports bounded and refuses binary fallback, invalid UTF-8 and NUL', async () => {
  const s = await nativeFixture(); const ref = await s.importFile(Buffer.from('plain <b>text</b>'), 'note.md');
  expect(value(s.engine.assets.metadata(ref))).toMatchObject({ mime: 'text/plain', width: 0, height: 0, byteLength: 17 });
  const preview = value(await s.engine.assets.read({ libraryId: ref.libraryId, ref, variant: 'thumbnail' })); expect(preview.mime).toBe('image/png'); expect(preview.bytes.length).toBeLessThan(65536);
  for (const [name, bytes] of [['bad.txt', Buffer.from([0xff])], ['nul.md', Buffer.from('a\0b')], ['huge.txt', Buffer.alloc(1024 * 1024 + 1, 65)], ['unknown.bin', Buffer.from('this is not an image')]] as const) await expect(s.importFile(bytes, name)).rejects.toThrow();
});
it('recovers text from a synced provider spool after interruption without posting again', async () => {
  const s = await nativeFixture(), { task } = await s.enqueue();
  const { ArtifactSource } = await import('../../packages/providers/src/artifact-source');
  // Simulates durable output reaching disk before its provider fact was committed.
  const permit = value(s.engine.generation.claim(task.attemptId));
  value(await s.engine.generation.acquireDispatch(task.attemptId, permit.leaseToken));
  value(await new ArtifactSource(s.root, undefined, 'text').stage(`${task.attemptId}-output`, Buffer.from('recovered text')));
  await s.engine.close(); const e = await s.open(); value(await e.scheduler.recover());
  const completed = value(e.generation.read(task.taskId)); expect(completed.state).toBe('SUCCEEDED'); expect(s.requests).toHaveLength(0);
  expect(Buffer.from(value(await e.assets.read({ libraryId: e.identity.libraryId, ref: completed.artifactRef, variant: 'original' })).bytes).toString()).toBe('recovered text');
});

it('preserves modern OpenAI token choice through profile freezing and real execution',async()=>{
  const s=await nativeFixture('openai-chat-v1','max_completion_tokens');const {task,prepared}=await s.enqueue();expect(prepared.config.parameters).toEqual({max_completion_tokens:1024});
  expect(value(await s.engine.scheduler.run(task.attemptId))).toMatchObject({state:'SUCCEEDED'});const body=JSON.parse(s.requests[0]!.body.toString());expect(body.max_completion_tokens).toBe(1024);expect(body.max_tokens).toBeUndefined();
});
