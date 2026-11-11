import{expect,it}from'vitest';
import{resolvePreviewBatch,type PreviewBatch}from'../../apps/desktop/src/renderer/features/timeline/preview-batches.ts';
import type{RenderJobView}from'../../packages/contracts/src/render.ts';
const batch:PreviewBatch={id:'contain-0',references:[],videoFit:'contain',state:'enqueued',planId:'plan',executionOwner:'user',job:{libraryId:'library',projectId:'project',jobId:'job'}};
function job(state:RenderJobView['state']):RenderJobView{return{libraryId:'library',projectId:'project',jobId:'job',planId:'plan',kind:'derived',state,phase:state.toLowerCase(),progressTicks:0,cancelRequested:false,needsResume:false,attempt:1,history:[],errorCode:null,outputRef:null,derived:[]};}
it.each([['PREPARED','prepared'],['QUEUED','queued'],['RUNNING','running'],['VERIFYING','running'],['PUBLISHING','running'],['SUCCEEDED','succeeded'],['FAILED','failed'],['CANCELLED','cancelled'],['INTERRUPTED','interrupted']]as const)('follows the bound proxy job through %s', (state,want)=>{expect(resolvePreviewBatch(batch,[job(state)])).toBe(want);});
it('keeps enqueue pending until its job becomes visible',()=>{expect(resolvePreviewBatch(batch,[])).toBe('enqueued');});
it.each(['jobId','planId','projectId','libraryId','kind']as const)('ignores a job with a different %s',key=>{expect(resolvePreviewBatch(batch,[{...job('SUCCEEDED'),[key]:'other'}as RenderJobView])).toBe('enqueued');});
it('keeps preparation failures without associating an unrelated job',()=>{expect(resolvePreviewBatch({...batch,job:undefined,state:'failed'},[job('SUCCEEDED')])).toBe('failed');});
