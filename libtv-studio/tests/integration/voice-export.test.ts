import { expect, it } from 'vitest';
import { audioFixture, audioValue, audioExecute, fixtureWav } from '../fixtures/audio-generation.ts';
import { readFile, unlink, link, lstat, writeFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { join } from 'node:path';

it('publishes a fixed voice snapshot without paths or credentials and never overwrites it', async () => {
  const s = await audioFixture('openai-speech-v1', { native: true }), projectId = s.projectId, bytes = fixtureWav(2), audio = await s.importAudio(bytes, 'voice.wav');
  audioValue(await audioExecute(s.engine, 'creation.saveEntity', { projectId, id: 'a', expectedRevision: 0, kind: 'character', name: 'A', description: '', constraints: '', references: [] }));
  const probe = audioValue(await s.engine.mediaInfo.ensure(audio));
  audioValue(await audioExecute(s.engine, 'voice.save', { projectId, id: 'voice', expectedRevision: 0, draft: { entityRef: { id: 'a', revision: 1 }, name: 'A voice', dialect: '山东话', performanceNotes: '', reference: { ref: audio, hash: probe.objectHash, probeId: probe.probeId, sourceInTicks: 0, durationTicks: 96000 } } }));
  const module = await import('../../apps/desktop/src/main/voice-export.ts');
  expect(module.voiceExporter).toBeTypeOf('function');
  const input = { projectId, voiceRef: { id: 'voice', revision: 1 }, requestId: crypto.randomUUID() };
  const exporter = module.voiceExporter!({ root: s.root, libraryId: s.engine.identity.libraryId, projectId }, s.engine.assets);
  let broken=true;
  const interrupted=module.voiceExporter!({root:s.root,libraryId:s.engine.identity.libraryId,projectId},{...s.engine.assets,readMediaRange:async input=>{
    if(!broken)return s.engine.assets.readMediaRange(input);
    if(input.offset===0){const read=await s.engine.assets.readMediaRange({...input,length:3});return read;}
    return {ok:false,error:{code:'FIXTURE_DISCONNECT',message:'fixture disconnect'}};
  }});
  expect(await interrupted(input,()=>Promise.resolve(s.engine.voices.read({projectId,voiceRef:input.voiceRef})))).toMatchObject({ok:false});
  await expect(readFile(join(s.root,'audio/voice/characters/a/voice-r1/reference.wav'))).rejects.toMatchObject({code:'ENOENT'});
  broken=false;
  const receipt = await exporter(input, () => Promise.resolve(s.engine.voices.read({ projectId, voiceRef: input.voiceRef })));
  expect(receipt).toMatchObject({ ok: true, value: { relativePath: 'audio/voice/characters/a/voice-r1/reference.wav', hash: probe.objectHash, byteLength: bytes.length } });
  if (!receipt.ok) return;
  expect(await readFile(join(s.root, receipt.value.relativePath))).toEqual(bytes);
  const metadata = await readFile(join(s.root, 'audio/voice/characters/a/voice-r1/voice.json'), 'utf8');
  expect(metadata).toContain('山东话'); expect(metadata).not.toContain(s.root); expect(metadata).not.toContain('credential');
  const directory=join(s.root,'audio/voice/characters/a/voice-r1');
  const journalPath=join(directory,`.voice-${input.requestId}.journal.json`);
  for(const member of ['voice.json','reference.wav']){
    const target=join(directory,member),temporaryName=`.voice-${input.requestId}-${randomUUID()}.partial`,temporary=join(directory,temporaryName);
    await link(target,temporary);
    const stat=await lstat(temporary,{bigint:true}),content=await readFile(target);
    const journal={requestId:input.requestId,sourceHash:probe.objectHash,member,temporaryName,dev:stat.dev.toString(),ino:stat.ino.toString(),hash:createHash('sha256').update(content).digest('hex'),byteLength:content.length};
    await writeFile(journalPath,JSON.stringify({...journal,ino:'0'}));
    expect(await exporter(input,()=>Promise.resolve(s.engine.voices.read({projectId,voiceRef:input.voiceRef})))).toMatchObject({ok:false});
    expect((await lstat(temporary)).nlink).toBe(2);
    expect(await readFile(target)).toEqual(content);
    await writeFile(journalPath,JSON.stringify(journal));
    await unlink(temporary);await writeFile(temporary,content);
    expect(await exporter(input,()=>Promise.resolve(s.engine.voices.read({projectId,voiceRef:input.voiceRef})))).toMatchObject({ok:false});
    expect(await readFile(temporary)).toEqual(content);expect(await readFile(target)).toEqual(content);
    await unlink(temporary);await link(target,temporary);
    expect(await exporter(input,()=>Promise.resolve(s.engine.voices.read({projectId,voiceRef:input.voiceRef})))).toEqual(receipt);
    await expect(lstat(temporary)).rejects.toMatchObject({code:'ENOENT'});
    expect((await lstat(target)).nlink).toBe(1);
  }
  await unlink(join(s.root, receipt.value.relativePath));
  expect(await exporter(input, () => Promise.resolve(s.engine.voices.read({ projectId, voiceRef: input.voiceRef })))).toEqual(receipt);
  expect(await exporter({ ...input, requestId: crypto.randomUUID() }, () => Promise.resolve(s.engine.voices.read({ projectId, voiceRef: input.voiceRef })))).toMatchObject({ ok: false, error: { code: 'VOICE_EXPORT_EXISTS' } });
});
