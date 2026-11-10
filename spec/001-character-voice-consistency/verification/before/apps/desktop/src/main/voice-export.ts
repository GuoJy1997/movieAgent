import { createHash,randomUUID } from 'node:crypto';
import { lstat, mkdir, open, realpath,link,unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { parseVoiceExport, type CharacterVoiceRevision, type VoiceExportReceipt } from '../../../../packages/contracts/src/character-voice.ts';
import type { MediaChunk, MediaRangeRequest, ReadLease } from '../../../../packages/contracts/src/media-info.ts';
import type { MediaReference } from '../../../../packages/contracts/src/assets.ts';
import { fail, ok, type Result } from '../../../../packages/contracts/src/result.ts';
import { canonicalPath, serializeDirectoryOperation,readBoundedFile,writeAtomicFile } from './project-directories.ts';
import {verifyFile} from './timeline-export.ts';

interface Binding { root: string; libraryId: string; projectId: string }
interface MediaIO { openMediaRead(ref: MediaReference, expectedHash?: string): Promise<Result<ReadLease>>; readMediaRange(input: MediaRangeRequest): Promise<Result<MediaChunk>>; closeMediaRead(leaseId: string): Promise<void> }
const relativeVoicePath = (voice: CharacterVoiceRevision) => `audio/voice/characters/${voice.entityRef.id}/${voice.id}-r${voice.revision}`;
async function checkDirectory(path: string) { const stat = await lstat(path); if (!stat.isDirectory() || stat.isSymbolicLink() || canonicalPath(await realpath(path)) !== canonicalPath(path)) throw Error('VOICE_EXPORT_PATH_UNSAFE'); }
async function exists(path: string) { try { const s=await lstat(path);if(!s.isFile()||s.isSymbolicLink()||s.nlink!==1)throw Error('VOICE_EXPORT_PATH_UNSAFE');return true; } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error; } }
interface ExportMember {hash:string;byteLength:number}
interface PublicationJournal extends ExportMember {requestId:string;sourceHash:string;member:'voice.json'|'reference.wav';temporaryName:string;dev:string;ino:string}
async function optionalStat(path:string){try{return await lstat(path,{bigint:true});}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return undefined;throw error;}}
/** Only this request's recorded private inode may lose its extra publication link. */
async function recoverPublication(directory:string,journalPath:string,requestId:string,sourceHash:string,members:Record<PublicationJournal['member'],ExportMember>){
  if(!await exists(journalPath))return;
  const journal=JSON.parse((await readBoundedFile(journalPath,4096)).toString('utf8')) as PublicationJournal;
  const expected=journal.member==='voice.json'||journal.member==='reference.wav'?members[journal.member]:undefined;
  const prefix=`.voice-${requestId}-`;
  if(!expected||journal.requestId!==requestId||journal.sourceHash!==sourceHash||journal.hash!==expected.hash||journal.byteLength!==expected.byteLength||typeof journal.temporaryName!=='string'||!journal.temporaryName.startsWith(prefix)||!/^[0-9a-f-]{36}\.partial$/.test(journal.temporaryName.slice(prefix.length))||!/^\d+$/.test(journal.dev)||!/^\d+$/.test(journal.ino))throw Error('VOICE_EXPORT_PATH_UNSAFE');
  const temporary=join(directory,journal.temporaryName),target=join(directory,journal.member),temp=await optionalStat(temporary),dest=await optionalStat(target);
  if(temp){
    if(!temp.isFile()||temp.isSymbolicLink()||temp.dev.toString()!==journal.dev||temp.ino.toString()!==journal.ino||temp.size!==BigInt(expected.byteLength))throw Error('VOICE_EXPORT_PATH_UNSAFE');
    if(dest){
      if(!dest.isFile()||dest.isSymbolicLink()||dest.dev!==temp.dev||dest.ino!==temp.ino||temp.nlink!==2n||dest.nlink!==2n)throw Error('VOICE_EXPORT_PATH_UNSAFE');
      // Verify the held inode while both recorded names exist; ordinary verifyFile still requires nlink=1.
      const handle=await open(temporary,'r');
      try{
        const held=await handle.stat({bigint:true});if(held.dev!==temp.dev||held.ino!==temp.ino)throw Error('VOICE_EXPORT_PATH_UNSAFE');
        const hash=createHash('sha256'),buffer=Buffer.alloc(1024*1024);let offset=0;
        while(offset<expected.byteLength){const read=await handle.read(buffer,0,Math.min(buffer.length,expected.byteLength-offset),offset);if(!read.bytesRead)throw Error('OBJECT_INTEGRITY_FAILED');hash.update(buffer.subarray(0,read.bytesRead));offset+=read.bytesRead;}
        const end=await handle.stat({bigint:true}),after=await lstat(temporary,{bigint:true}),final=await lstat(target,{bigint:true});
        if(hash.digest('hex')!==expected.hash||end.size!==temp.size||end.mtimeNs!==temp.mtimeNs||end.nlink!==2n||after.dev!==temp.dev||after.ino!==temp.ino||after.nlink!==2n||final.dev!==temp.dev||final.ino!==temp.ino||final.nlink!==2n)throw Error('OBJECT_INTEGRITY_FAILED');
      }finally{await handle.close();}
    }else{if(temp.nlink!==1n)throw Error('VOICE_EXPORT_PATH_UNSAFE');await verifyFile(temporary,expected,new AbortController().signal);}
    await unlink(temporary);
  }
  if(dest)await verifyFile(target,expected,new AbortController().signal);
  await unlink(journalPath);
}
async function publishMember(directory:string,journalPath:string,requestId:string,sourceHash:string,member:PublicationJournal['member'],expected:ExportMember,write:(handle:Awaited<ReturnType<typeof open>>)=>Promise<void>){
  const temporaryName=`.voice-${requestId}-${randomUUID()}.partial`,temporary=join(directory,temporaryName),handle=await open(temporary,'wx',0o600),identity=await handle.stat({bigint:true});
  let journaled=false;
  try{
    await write(handle);await handle.sync();await handle.close();await verifyFile(temporary,expected,new AbortController().signal);await checkDirectory(directory);
    if(await exists(journalPath))throw Error('VOICE_EXPORT_PATH_UNSAFE');
    const journal:PublicationJournal={requestId,sourceHash,member,temporaryName,dev:identity.dev.toString(),ino:identity.ino.toString(),...expected};
    // Atomic rename for the private journal avoids introducing a second hard-link crash window.
    await writeAtomicFile(journalPath,JSON.stringify(journal),true);journaled=true;
    await link(temporary,join(directory,member));await unlink(temporary);await verifyFile(join(directory,member),expected,new AbortController().signal);await unlink(journalPath);journaled=false;
  }finally{
    await handle.close();const remaining=await optionalStat(temporary);
    if(remaining&&remaining.isFile()&&!remaining.isSymbolicLink()&&remaining.nlink===1n&&remaining.dev===identity.dev&&remaining.ino===identity.ino){await unlink(temporary);if(journaled)await unlink(journalPath);}
  }
}

export function voiceExporter(binding: Binding | null, io: MediaIO) {
  return async function exportVoice(raw: unknown, read: () => Promise<Result<CharacterVoiceRevision>>): Promise<Result<VoiceExportReceipt>> {
    const parsed = parseVoiceExport(raw); if (!parsed.ok) return parsed;
    const input = parsed.value;
    if (!binding) return fail('NO_DIRECTORY_PROJECT', '请先打开目录项目。');
    if (input.projectId !== binding.projectId) return fail('WRONG_PROJECT', '声音导出项目与目录绑定不符。');
    return serializeDirectoryOperation(binding.root, async () => {
      try {
        const current = await read(); if (!current.ok) return current;
        const voice = current.value;
        if (voice.libraryId !== binding.libraryId || voice.projectId !== input.projectId || voice.id !== input.voiceRef.id || voice.revision !== input.voiceRef.revision) return fail('REVISION_CONFLICT', '声音档案已有新修订。');
        const relative = relativeVoicePath(voice), directory = join(binding.root, relative), metadataPath = join(directory, 'voice.json'), referencePath = join(directory, 'reference.wav');
        await checkDirectory(binding.root);let parent=binding.root;for(const part of relative.split('/')){parent=join(parent,part);await mkdir(parent).catch(error=>{if(error.code!=='EEXIST')throw error;});await checkDirectory(parent);}
        const opened = await io.openMediaRead(voice.reference.ref, voice.reference.hash); if (!opened.ok) return opened;
        const lease=opened.value,byteLength=lease.byteLength;
        try {
        if(lease.mime!=='audio/wav'||lease.hash!==voice.reference.hash||!Number.isSafeInteger(byteLength)||byteLength<=0||byteLength>16*1024*1024)return fail('VOICE_EXPORT_MEDIA_UNSUPPORTED','声音快照需要固定 WAV 参考音频。');
        const metadata = { schemaVersion: 1, requestId: input.requestId, libraryId: binding.libraryId, projectId: input.projectId, voice: { id: voice.id, revision: voice.revision, entityRef: voice.entityRef, name: voice.name, dialect: voice.dialect, performanceNotes: voice.performanceNotes }, reference: { hash: lease.hash, byteLength, probeId: voice.reference.probeId, sourceInTicks: voice.reference.sourceInTicks, durationTicks: voice.reference.durationTicks, mime: lease.mime } };
        const metadataBytes=Buffer.from(JSON.stringify(metadata,null,2)),journalPath=join(directory,`.voice-${input.requestId}.journal.json`),members={'voice.json':{hash:createHash('sha256').update(metadataBytes).digest('hex'),byteLength:metadataBytes.length},'reference.wav':{hash:voice.reference.hash,byteLength}};
        await recoverPublication(directory,journalPath,input.requestId,voice.reference.hash,members);
        if (await exists(metadataPath)) {
          const metadata = JSON.parse((await readBoundedFile(metadataPath,65536)).toString('utf8')) as { requestId?: string; reference?: { hash?: string; byteLength?: number } };
          if (metadata.requestId !== input.requestId) return fail('VOICE_EXPORT_EXISTS', '此声音修订已经导出，不能覆盖。');
          const hash = metadata.reference?.hash, byteLength = metadata.reference?.byteLength;
          if (hash !== voice.reference.hash || !Number.isSafeInteger(byteLength) || byteLength!<=0 || byteLength!>16*1024*1024) return fail('VOICE_EXPORT_EXISTS', '已有声音导出元数据不符。');
          await verifyFile(metadataPath,members['voice.json'],new AbortController().signal);
          if (await exists(referencePath)) {
            await verifyFile(referencePath,{hash,byteLength:byteLength!},new AbortController().signal);
            return ok({ ...input, relativePath: `${relative}/reference.wav`, hash, byteLength: byteLength! });
          }
        }
          if (!(await exists(metadataPath))) {
            await publishMember(directory,journalPath,input.requestId,voice.reference.hash,'voice.json',members['voice.json'],async handle=>{await handle.writeFile(metadataBytes);});
          }
          await publishMember(directory,journalPath,input.requestId,voice.reference.hash,'reference.wav',members['reference.wav'],async reference=>{
            const hash = createHash('sha256'); let offset = 0;
            while (offset < byteLength) {
              const chunk = await io.readMediaRange({ leaseId: lease.leaseId, offset, length: Math.min(1024 * 1024, byteLength - offset) });
              if (!chunk.ok || !chunk.value.bytes.byteLength || chunk.value.bytes.length>Math.min(1024*1024,byteLength-offset)||chunk.value.offset!==offset) throw Error('OBJECT_INTEGRITY_FAILED');
              await reference.writeFile(chunk.value.bytes); hash.update(chunk.value.bytes); offset += chunk.value.bytes.byteLength;
            }
            if (hash.digest('hex') !== voice.reference.hash) throw Error('OBJECT_INTEGRITY_FAILED');
          });
        await checkDirectory(directory);
        return ok({ ...input, relativePath: `${relative}/reference.wav`, hash: voice.reference.hash, byteLength });
        }finally{await io.closeMediaRead(lease.leaseId);}
      } catch (error) {
        const code = error instanceof Error && /^[A-Z][A-Z0-9_]+$/.test(error.message) ? error.message : 'VOICE_EXPORT_FAILED';
        return fail(code, '声音导出未完成，请使用原请求核对重试。');
      }
    });
  };
}
