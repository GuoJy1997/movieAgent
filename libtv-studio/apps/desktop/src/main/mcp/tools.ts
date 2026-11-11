import {z} from 'zod';
import {idSchema as id,scopeSchema as scope,mediaRefSchema as ref,importSchema} from './import-schema.ts';
const instance={instanceId:id},scoped={...instance,scope},write={...scoped,requestId:id};
const revision=z.number().int().positive(),nonnegative=z.number().int().nonnegative();
const text=z.string().max(8000),refVersion=z.object({libraryId:id,id,revision}).strict();
const make=(description:string,shape:z.ZodRawShape,readOnly=true,openWorld=false)=>({description,schema:z.object(shape).strict(),readOnly,openWorld});
export const toolDefinitions={
 system_instances:make('List running enabled MovieAgent workspaces; choose an explicit instanceId.',{}),
 system_doctor:make('Check the selected local desktop engine and connection.',instance),
 system_capabilities:make('Read available M1 tools, import limits and supported scope.',instance),
 workspace_list:make('List registered local project directories.',instance),
 workspace_open:make('Open a registered workspace in MovieAgent; then discover its instance.',{...instance,workspaceId:id,requestId:id},false),
 project_list:make('List projects in this workspace.',instance),
 project_create:make('Create a project in a legacy unbound library. Directory projects use the launcher.',{...instance,requestId:id,name:z.string().trim().min(1).max(200)},false),
 subproject_list:make('List episodes/subprojects of a parent project.',{...instance,projectId:id}),
 subproject_create:make('Create an episode sharing parent project resources.',{...write,title:z.string().trim().min(1).max(200),number:z.string().max(40).optional()},false),
 import_sources:make('Read once-authorized image source directories and the application inbox.',instance),
 assets_list:make('List fixed project image/media assets with pagination.',{...scoped,view:z.enum(['current','common','all','unclassified']).default('all'),offset:nonnegative.default(0),limit:z.number().int().min(1).max(200).default(50)}),
 assets_get:make('Read a fixed asset version and declared external provenance.',{...scoped,ref}),
 assets_preview:make('Return a thumbnail as MCP image content; does not regenerate the image.',{...scoped,ref}),
 assets_import:{description:'Collect an external PNG/JPEG/WebP into this project; stable requestId prevents duplicates. Poll imports_get/wait, then bind or reuse the returned asset version.',schema:importSchema.extend(instance).strict(),readOnly:false,openWorld:false},
 assets_update:make('Rename/tag an asset with an expected metadata revision.',{...write,assetId:id,expectedRevision:revision,name:z.string().trim().min(1).max(200),tags:z.array(z.string().trim().min(1).max(32)).max(20)},false),
 assets_share:make('Mark an existing project asset as shared across episodes.',{...write,ref,shared:z.boolean()},false),
 imports_get:make('Read durable import status, partial bindings and the collected asset.',{...scoped,operationId:id}),
 imports_wait:make('Wait up to 10 seconds for a local import, preserving its operation ID.',{...scoped,operationId:id,timeoutMs:z.number().int().min(0).max(10000).default(1000)}),
 imports_resume:make('Resume incomplete steps of the same import without duplicating its asset.',{...write,operationId:id},false),
 imports_cancel:make('Stop remaining import steps; already collected assets are preserved.',{...write,operationId:id},false),
 creation_get:make('Read current entities, scripts, shots and selected outputs.',{...scoped,scriptId:id.optional()}),
 entity_save:make('Create/update a parent-project character, scene, prop or style with fixed references.',{...write,id,expectedRevision:nonnegative,kind:z.enum(['character','scene','prop','style']),name:z.string().trim().min(1).max(200),description:text,constraints:text,references:z.array(ref).max(4)},false),
 shot_select_image:make('Select an imported fixed asset as a shot image. This alone does not generate video.',{...write,shotId:id,expectedRevision:revision,expectedSelectionRevision:nonnegative,ref},false),
 canvas_list:make('List canvases in an episode.',scoped),
 canvas_create:make('Create an empty canvas in the selected episode.',{...write,title:z.string().trim().min(1).max(200)},false),
 canvas_get:make('Read the graph and current revision.',{...scoped,canvasId:id}),
 canvas_add_image:make('Create an image node referencing a fixed collected asset.',{...write,canvasId:id,baseRevision:nonnegative,nodeId:id,ref,x:z.number().finite().min(-1000000).max(1000000),y:z.number().finite().min(-1000000).max(1000000)},false),
 canvas_connect:make('Connect fixed node incarnations with an explicit input role.',{...write,canvasId:id,baseRevision:nonnegative,edgeId:id,sourceNodeId:id,sourceIncarnation:id,targetNodeId:id,targetIncarnation:id,targetPort:z.enum(['prompt','reference','first_frame','last_frame','voice_reference'])},false),
 models_list:make('Read model/profile capabilities without keys, headers or connection URLs.',scoped),
 production_prepare:make('Freeze a shot video plan using reusedImages. Reused shots create zero image model steps.',{...write,scriptId:id,canvasId:id,shots:z.array(z.object({shotId:id,revision}).strict()).min(1).max(16),imageProfileRef:refVersion.optional(),videoProfileRef:refVersion,reusedImages:z.array(z.object({shotId:id,ref,role:z.enum(['first_frame','reference'])}).strict()).max(16).default([])},false),
 production_apply:make('Apply a frozen production plan to the canvas without submitting any paid task.',{...write,productionId:id,approvedHash:z.string().regex(/^[a-f0-9]{64}$/),expectedCanvasRevision:nonnegative},false),
 production_prepare_execution:make('Prepare and attach a fixed media workflow; no provider submission.',{...write,productionId:id},false),
 production_execute:make('Request desktop confirmation of this fixed workflow and budget, then enqueue once. Caller booleans cannot authorize spend.',{...write,productionId:id,budgetLimitMicros:z.number().int().positive().max(1e12),stepAllowanceMicros:z.number().int().positive().max(1e12)},false,true),
 production_get:make('Read the production and sanitized workflow progress.',{...scoped,productionId:id}),
 production_cancel:make('Stop future submissions in this production; accepted tasks may still complete.',{...write,productionId:id},false),
 tasks_get:make('Read a task, including unknown submission and collection state.',{...scoped,taskId:id}),
 tasks_wait:make('Wait up to 10 seconds on the same task ID, without resubmission.',{...scoped,taskId:id,timeoutMs:z.number().int().min(0).max(10000).default(1000)}),
 tasks_cancel:make('Request cancellation of one existing task.',{...write,taskId:id},false),
 tasks_reconcile:make('Reconcile an existing unknown/accepted task without creating a new generation.',{...write,taskId:id},false,true)
};
export type McpToolName=keyof typeof toolDefinitions;
export function validateTool(name:string,args:unknown){
 if(!Object.hasOwn(toolDefinitions,name))return null;
 const tool=toolDefinitions[name as McpToolName];if(!tool)return null;
 const parsed=tool.schema.safeParse(args);return parsed.success?parsed.data as Record<string,unknown>:null;
}
