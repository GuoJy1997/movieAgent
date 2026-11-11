import {z} from 'zod';
export const idSchema=z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/);
export const scopeSchema=z.object({libraryId:idSchema,projectId:idSchema,subprojectId:idSchema}).strict();
export const mediaRefSchema=z.discriminatedUnion('kind',[
 z.object({kind:z.literal('assetVersion'),libraryId:idSchema,assetId:idSchema,version:z.number().int().positive()}).strict(),
 z.object({kind:z.literal('artifact'),libraryId:idSchema,artifactId:idSchema}).strict()
]);
export const importBindingSchema=z.discriminatedUnion('kind',[
 z.object({kind:z.literal('entity'),entityId:idSchema,expectedRevision:z.number().int().nonnegative()}).strict(),
 z.object({kind:z.literal('shot'),shotId:idSchema,expectedRevision:z.number().int().positive(),expectedSelectionRevision:z.number().int().nonnegative()}).strict(),
 z.object({kind:z.literal('canvas'),canvasId:idSchema,baseRevision:z.number().int().nonnegative(),nodeId:idSchema.optional(),x:z.number().finite().min(-1000000).max(1000000),y:z.number().finite().min(-1000000).max(1000000)}).strict()
]);
export const importSchema=z.object({
 requestId:idSchema,scope:scopeSchema,name:z.string().trim().min(1).max(200),
 source:z.discriminatedUnion('kind',[
  z.object({kind:z.literal('localFile'),importSourceId:idSchema,path:z.string().min(1).max(1024)}).strict(),
  z.object({kind:z.literal('bytes'),fileName:z.string().min(1).max(200),mimeType:z.enum(['image/png','image/jpeg','image/webp']),base64:z.string().min(4).max(11184812)}).strict()
 ]),
 tags:z.array(z.string().trim().min(1).max(32)).max(20).optional(),shared:z.boolean().optional(),
 targetAsset:z.object({assetId:idSchema,expectedVersion:z.number().int().positive()}).strict().optional(),
 sourceInfo:z.object({sourceKind:z.enum(['agent','user','external']),sourceApp:z.string().max(100).optional(),model:z.string().max(200).optional(),prompt:z.string().max(16000).optional(),generatedAt:z.iso.datetime().optional()}).strict().optional(),
 bindings:z.array(importBindingSchema).max(16).optional()
}).strict();
