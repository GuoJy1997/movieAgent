import { expect, it } from 'vitest';
import { value, execute } from '../fixtures/native-generation';
import { graphFixture } from '../fixtures/workflow';
it('validates typed edges, cycles, incarnations and explicit graph revision', async () => {
 const s = await graphFixture();
 expect(s.read().edges).toEqual([]);
 value(await s.apply([{kind:'addEdge',edge:s.edge('ab')}]));
 expect(s.read().edges).toHaveLength(1);
 expect(await s.apply([{kind:'addEdge',edge:s.edge('ba','b','a')}])).toMatchObject({ok:false,error:{code:'GRAPH_CYCLE'}});
 expect(await s.apply([{kind:'addEdge',edge:s.edge('self','a','a')}])).toMatchObject({ok:false});
 expect(await s.apply([{kind:'addEdge',edge:s.edge('bad','a','c','reference')}])).toMatchObject({ok:false,error:{code:'GRAPH_TYPE_MISMATCH'}});
 expect(await s.apply([{kind:'addEdge',edge:{...s.edge('old','a','c'),sourceIncarnation:'old'}}])).toMatchObject({ok:false});
 expect(await s.apply([{kind:'removeEdge',edgeId:'ab'}],0)).toMatchObject({ok:false,error:{code:'CANVAS_CONFLICT'}});
});
it('invalidates downstream semantics on manual content/selection/edges but not layout; delete undo restores fresh identities and edges', async () => {
 const s=await graphFixture(); value(await s.apply([{kind:'addEdge',edge:s.edge('ab')},{kind:'addEdge',edge:s.edge('bc','b','c')}]));
 const before=s.node('c').semanticRevision, a=s.node('a');
 value(await s.apply([{kind:'setLayout',nodeId:'a',incarnation:a.incarnation,expectedRevision:a.layoutRevision,layout:{x:30,y:10}}])); expect(s.node('c').semanticRevision).toBe(before);
 value(await s.apply([{kind:'setContent',nodeId:'a',incarnation:a.incarnation,expectedRevision:a.semanticRevision,content:{...a.content,prompt:'edited'}}])); expect(s.node('c').semanticRevision).toBeGreaterThan(before);
 const b=s.node('b'); const deleted=value(await s.apply([{kind:'delete',nodeId:'b',incarnation:b.incarnation,expectedSemanticRevision:b.semanticRevision,expectedLayoutRevision:b.layoutRevision,expectedSelectionRevision:b.selectionRevision,expectedRunBindingId:null}])); expect(s.read().edges).toEqual([]);
 value(await execute(s.engine,'canvas.applyCommand',{canvasId:s.canvasId,baseRevision:s.read().revision,undoCommandId:deleted.commandId}));
 expect(s.node('b').incarnation).not.toBe(b.incarnation); expect(s.read().edges).toHaveLength(2); expect(s.read().edges[0].targetIncarnation).toBe(s.node('b').incarnation);
});
it('rejects type-incompatible edits and selections on connected source nodes using original MIME',async()=>{
 const s=await graphFixture();const {addWorkflowModel}=await import('../fixtures/workflow'),sharp=(await import('sharp')).default;
 const image=await addWorkflowModel(s,'image','openai-image-v1'),video=await addWorkflowModel(s,'video','minimax-video-v2');
 for(const [id,profileRef]of [['a',image],['b',video]] as const){const n=s.node(id);value(await s.apply([{kind:'setContent',nodeId:id,incarnation:n.incarnation,expectedRevision:n.semanticRevision,content:{...n.content,profileRef}}]));}
 value(await s.apply([{kind:'addEdge',edge:s.edge('ab','a','b','first_frame')}]));const text=await s.importFile(Buffer.from('text'),'input.txt'),a=s.node('a');
 expect(await s.apply([{kind:'selectOutput',nodeId:'a',incarnation:a.incarnation,expectedRevision:a.selectionRevision,output:text}])).toMatchObject({ok:false,error:{code:'GRAPH_TYPE_MISMATCH'}});
 expect(await s.apply([{kind:'setContent',nodeId:'a',incarnation:a.incarnation,expectedRevision:a.semanticRevision,content:{...a.content,profileRef:s.prepareInput().profileRef}}])).toMatchObject({ok:false,error:{code:'GRAPH_TYPE_MISMATCH'}});
 const b=s.node('b');expect(await s.apply([{kind:'setContent',nodeId:'b',incarnation:b.incarnation,expectedRevision:b.semanticRevision,content:{...b.content,profileRef:image}}])).toMatchObject({ok:false,error:{code:'GRAPH_TYPE_MISMATCH'}});
 const png=await sharp({create:{width:256,height:256,channels:3,background:'#234567'}}).png().toBuffer(),ref=await s.importFile(png);value(await s.apply([{kind:'selectOutput',nodeId:'a',incarnation:a.incarnation,expectedRevision:a.selectionRevision,output:ref}]));
 expect(s.node('b').semanticRevision).toBeGreaterThan(b.semanticRevision);
 value(await s.apply([{kind:'create',nodeId:'fixed',content:{type:'media',media:ref},layout:{x:0,y:0}}]));value(await s.apply([{kind:'removeEdge',edgeId:'ab'},{kind:'addEdge',edge:s.edge('fb','fixed','b','first_frame')}]));const fixed=s.node('fixed');
 expect(await s.apply([{kind:'setContent',nodeId:'fixed',incarnation:fixed.incarnation,expectedRevision:fixed.semanticRevision,content:{type:'media',media:text}}])).toMatchObject({ok:false,error:{code:'GRAPH_TYPE_MISMATCH'}});
});
it('applies a connected batch delete from one observed snapshot and restores both nodes with fresh edge incarnations',async()=>{
 const s=await graphFixture();value(await s.apply([{kind:'addEdge',edge:s.edge('ab')},{kind:'addEdge',edge:s.edge('bc','b','c')}]));const original=['a','b'].map(id=>s.node(id));
 const deleted=value(await s.apply(original.map(n=>({kind:'delete',nodeId:n.nodeId,incarnation:n.incarnation,expectedSemanticRevision:n.semanticRevision,expectedLayoutRevision:n.layoutRevision,expectedSelectionRevision:n.selectionRevision,expectedRunBindingId:n.activeRunBindingId}))));
 value(await execute(s.engine,'canvas.applyCommand',{canvasId:s.canvasId,baseRevision:s.read().revision,undoCommandId:deleted.commandId}));expect(s.read().edges).toHaveLength(2);for(const n of original)expect(s.node(n.nodeId).incarnation).not.toBe(n.incarnation);for(const e of s.read().edges){expect(e.sourceIncarnation).toBe(s.node(e.sourceNodeId).incarnation);expect(e.targetIncarnation).toBe(s.node(e.targetNodeId).incarnation);}
});
it('edits and reads a canvas with more than128 unrelated edges while a small plan passes actual connection DTO validation',async()=>{
 const s=await graphFixture(),{LocalConnection}=await import('../../apps/desktop/src/main/local-connection'),{CommandOutbox}=await import('../../apps/desktop/src/main/command-outbox'),{join}=await import('node:path');
 const {isCanvasSnapshot}=await import('../../packages/contracts/src/canvas'),{isPreparedWorkflow,isWorkflowView}=await import('../../packages/contracts/src/workflows');
 const content=s.node('a').content,operations=Array.from({length:130},(_,i)=>[{kind:'create',nodeId:'fixed'+i,content:{type:'text',text:'fixed '+i},layout:{x:i,y:0}},{kind:'create',nodeId:'target'+i,content,layout:{x:i,y:100}}]).flat();
 for(let offset=0;offset<operations.length;offset+=100)value(await s.apply(operations.slice(offset,offset+100)));
 const edges=Array.from({length:130},(_,i)=>({kind:'addEdge',edge:s.edge('component'+i,'fixed'+i,'target'+i)}));
 for(let offset=0;offset<edges.length;offset+=100)value(await s.apply(edges.slice(offset,offset+100)));
 const outbox=new CommandOutbox(join(s.root,'client/large-graph.sqlite')),connection=new LocalConnection({identity:s.engine.identity,execute:async c=>s.engine.commands.execute(c),query:async q=>s.engine.commands.query(q),readEvents:async q=>s.engine.events.read(q)},outbox);
 const base={schemaVersion:1 as const,libraryId:s.engine.identity.libraryId,connectionEpoch:connection.connectionEpoch};
 try{
 const snapshot=value(await connection.query({...base,queryId:'large-graph',kind:'canvas.read',payload:{canvasId:s.canvasId}}));expect(isCanvasSnapshot(snapshot)).toBe(true);expect(snapshot.edges).toHaveLength(130);
 const receipt=value(await connection.execute({...base,commandId:'small-in-large',kind:'workflow.prepare',payload:{canvasId:s.canvasId,mode:'current',nodeIds:['target0'],executionOwner:'human',runId:'large-canvas-small-plan'}}));expect(isPreparedWorkflow(receipt)).toBe(true);expect(receipt.steps).toHaveLength(1);expect(receipt.steps[0].graphInputs.edges).toHaveLength(1);expect(receipt.observations).toHaveLength(2);
 value(await execute(s.engine,'workflow.approveAndEnqueue',{planId:receipt.planId,approvedPlanHash:receipt.planHash,currency:'CNY',budgetLimitMicros:10,stepAllowances:{target0:10},acknowledgeUnknown:true,executionOwner:receipt.executionOwner,runId:receipt.runId}));value(await s.engine.workflows.wake());let workflow=value(s.engine.workflows.read(receipt.planId));value(await s.engine.scheduler.run(workflow.steps[0].task.attemptId));value(await s.engine.workflows.wake());workflow=value(await connection.query({...base,queryId:'small-workflow',kind:'workflow.read',payload:{workflowId:receipt.planId}}));expect(isWorkflowView(workflow)).toBe(true);expect(workflow.state).toBe('succeeded');expect(s.requests).toHaveLength(1);
 }finally{outbox.close();}
});
it('rejects an oversized actual provenance closure explicitly rather than truncating it or returning an invalid plan DTO',async()=>{
 const s=await graphFixture(),content=s.node('a').content,create=Array.from({length:130},(_,i)=>({kind:'create',nodeId:'deep'+i,content,layout:{x:i,y:0}}));for(let i=0;i<create.length;i+=100)value(await s.apply(create.slice(i,i+100)));
 const edges=Array.from({length:129},(_,i)=>({kind:'addEdge',edge:s.edge('deep-edge'+i,'deep'+i,'deep'+(i+1))}));for(let i=0;i<edges.length;i+=100)value(await s.apply(edges.slice(i,i+100)));
 const ref=await s.importFile(Buffer.from('explicit selected input'),'deep.txt'),source=s.node('deep128');value(await s.apply([{kind:'selectOutput',nodeId:source.nodeId,incarnation:source.incarnation,expectedRevision:source.selectionRevision,output:ref}]));
 expect(await execute(s.engine,'workflow.prepare',{canvasId:s.canvasId,mode:'current',nodeIds:['deep129'],executionOwner:'human',runId:'oversize-closure'})).toMatchObject({ok:false,error:{code:'GRAPH_LIMIT',message:expect.stringContaining('来源闭包超过128')}});expect(s.requests).toHaveLength(0);
});
