import{it,expect,vi}from'vitest';import{mkdtemp,rm,readFile}from'node:fs/promises';import{join}from'node:path';import{tmpdir}from'node:os';import{createHash}from'node:crypto';
it('simulates a schema27 package refusing schema28 before modifying its database',async()=>{
 const root=await mkdtemp(join(tmpdir(),'schema28-floor-'));
 try{
  const current=await import('../../packages/storage/src/database.ts'),created=await current.openLibrary({root});if(!created.ok)throw Error(created.error.code);await created.value.close();
  const path=join(root,'library.sqlite'),before=createHash('sha256').update(await readFile(path)).digest('hex');
  vi.doMock('../../packages/contracts/src/schema.ts',()=>({CURRENT_SCHEMA_VERSION:27}));vi.resetModules();
  const old=await import('../../packages/storage/src/database.ts');expect(await old.openLibrary({root})).toMatchObject({ok:false,error:{code:'UNSUPPORTED_SCHEMA'}});
  expect(createHash('sha256').update(await readFile(path)).digest('hex')).toBe(before);
 }finally{vi.doUnmock('../../packages/contracts/src/schema.ts');vi.resetModules();await rm(root,{recursive:true,force:true});}
});