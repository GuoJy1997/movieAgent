import{channel}from'node:diagnostics_channel';import{afterAll,afterEach,expect,it}from'vitest';
import{setup,cleanup,image,unwrap,settings}from'./timeline-fixtures.ts';import{setupRender}from'./render-fixtures.ts';
const observed:any[]=[],events=channel('movieagent.media.readers'),listener=(value:unknown)=>observed.push(value);events.subscribe(listener);afterAll(()=>events.unsubscribe(listener));
afterEach(async()=>{await cleanup();observed.length=0;});
it('observes original lease lifetime and real active reads through close and disposal',async()=>{
 const f=await setup(),ref=await image(f.e,f.root),lease=unwrap(await f.e.assets.openMediaRead(ref));
 try{expect(observed.some(v=>v.kind==='original'&&v.held===1)).toBe(true);unwrap(await f.e.assets.readMediaRange({leaseId:lease.leaseId,offset:0,length:1}));expect(observed.some(v=>v.activeRanges===1)).toBe(true);await f.e.assets.closeMediaRead(lease.leaseId);await f.e.assets.closeMediaRead(lease.leaseId);expect(observed.every(v=>[v.held,v.activeRanges,v.opening,v.closing].every(n=>Number.isInteger(n)&&n>=0))).toBe(true);expect(observed.at(-1)).toMatchObject({held:0,activeRanges:0,opening:0,closing:0,closeFailures:0});}finally{await f.e.assets.closeMediaRead(lease.leaseId);}
});
it('observes derived and authorization-original pools returning to zero after read and disposal',async()=>{
 const f=await setupRender(),ref=await image(f.e,f.root),p=unwrap(await f.e.renders.prepareDerived({projectId:f.projectId,references:[ref],...settings,executionOwner:'qa',runId:'observation'}));unwrap(f.e.renders.enqueueDerived({planId:p.planId,planHash:p.planHash,executionOwner:p.executionOwner,runId:p.runId,diskBudgetBytes:p.requiredFreeBytes}));unwrap(f.e.renderScheduler.start());await f.e.renderScheduler.drain();
 const view=unwrap(f.e.renders.derived({projectId:f.projectId,planId:p.planId})),entry=view.entries[0]!;expect(entry).toBeDefined();const lease=unwrap(await f.e.renders.openDerivedMediaRead(entry.ref));unwrap(await f.e.renders.readDerivedMediaRange({leaseId:lease.leaseId,offset:0,length:1}));
 try{expect(observed.some(v=>v.kind==='derived'&&v.held===1&&v.activeRanges===1)).toBe(true);}finally{await f.e.renders.closeDerivedMediaRead(lease.leaseId);await f.e.close();}
 const latest=new Map(observed.map(v=>[v.poolId,v]));expect([...latest.values()].every(v=>v.held===0&&v.activeRanges===0&&v.opening===0&&v.closing===0&&v.closeFailures===0)).toBe(true);
},30000);
it('reports failed opens without inventing a lease or keeping an opening counter',async()=>{
 const f=await setup(),ref=await image(f.e,f.root);await f.e.assets.openMediaRead(ref,'0'.repeat(64));expect(observed.length).toBeGreaterThan(0);expect(observed.at(-1)).toMatchObject({held:0,activeRanges:0,opening:0,closing:0});
});
