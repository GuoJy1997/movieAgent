import {isRevisionRef} from './models.ts';
import {isVoiceCatalog,isVoiceCloneJob,type VoiceCatalog,type VoiceCloneJob} from './voice-management.ts';
import { parseAudioRead, parseAudioBatchRead, isAudioSnapshot, isAudioBatchSnapshot } from './audio.ts';
import { parseVoiceoverRead, isVoiceoverContext, type VoiceoverContext } from './voiceover.ts';
import { parseRenderList, parseRenderRead, parseRenderPlanRead, isRenderSnapshot, isRenderJobView, isRenderPlan, isDerivedMediaPlan, isDerivedMediaView, type LocalMediaPlan } from './render.ts';
import {parseTimelineList,parseTimelineRead,parseTimelineHistory,isTimelineRevision,isTimelineList,isTimelineHistory,type TimelineRevision,type TimelineList,type TimelineHistory,type TimelineReadInput} from './timeline.ts';
import { isExportSnapshot, type ExportSnapshot } from './timeline-export.ts';
import { isAgentSession, isAgentRun, isAgentList, isAgentTemplates, type AgentSessionView, type AgentRunView, type AgentSessionList, type AgentTemplateList } from './agent.ts';
import { isFinishRun, isFinishRunList, isFinishTemplateList, type FinishRunView, type FinishRunList, type FinishTemplateList } from './finish-agent.ts';
import { isCharacterVoiceSnapshot, isCharacterVoiceRevision, isShotDialogueSnapshot, type CharacterVoiceSnapshot, type CharacterVoiceRevision, type ShotDialogueSnapshot } from './character-voice.ts';
import { isDialogueProductionView, isDialogueTakeSnapshot, isVoiceAuditionStatus, isDialogueProductionList, parseDialogueProductionList, type DialogueProductionListInput, type DialogueProductionList, type DialogueProductionView, type DialogueTakeSnapshot, type VoiceAuditionStatus } from './dialogue-production.ts';
import {isDialogueReviewContext,type DialogueReviewContext} from './dialogue-production.ts';
import {isWorkflowView,isWorkflowSnapshot,type WorkflowView,type WorkflowSnapshot} from './workflows.ts';
import { isTaskSnapshot, isTaskView, type TaskSnapshot, type TaskView } from './generation.ts';
import { fail, isRecord, ok, type Result } from './result.ts';
import { isReceipt, validId, type CommandReceipt } from './commands.ts';
import { isProject, type ProjectRef } from './projects.ts';
import { isProviderSnapshot, isModelSnapshot, isProfileSnapshot, type ProviderSnapshot, type ModelSnapshot, type ProfileSnapshot } from './models.ts';
import { parseAssetSearch, isAssetHistory, type AssetHistory, type AssetSearchInput, isAssetSnapshot, type AssetSnapshot } from './assets.ts';
import { isCanvasSnapshot, type CanvasSnapshot } from './canvas.ts';
import { parseCreationRead, parseCreationHistory, isCreationSnapshot, isCreationHistory, type CreationReadInput, type CreationHistoryInput, type CreationSnapshot, type CreationHistory } from './creation.ts';
import { isShotProductionView,isShotProductionHistory,isShotProductionIssuesView,type ShotProductionView,type ShotProductionHistory,type ShotProductionIssuesView } from './shot-production.ts';
export interface ProjectSnapshot { projects: ProjectRef[]; snapshotSeq: number; streamId: string }
export interface QueryMap {
 'render.list': { input: {projectId:string}; output: import('./render.ts').RenderSnapshot };
 'render.read': { input: {projectId:string;jobId:string}; output: import('./render.ts').RenderJobView };
 'render.plan': { input: {projectId:string;planId:string}; output: LocalMediaPlan };
 'media.derived': { input: {projectId:string;planId:string}; output: import('./render.ts').DerivedMediaView };
 'audio.read': { input: { projectId: string }; output: import('./audio.ts').AudioSnapshot };
 'audio.voiceoverContext': { input: { projectId: string; takeId: string }; output: VoiceoverContext };
 'audio.batch': { input: { projectId: string; planId: string }; output: import('./audio.ts').AudioBatchSnapshot };
 'timeline.exports':{input:{projectId:string;timelineId:string};output:ExportSnapshot};
 'timeline.list':{input:{projectId:string};output:TimelineList};
 'timeline.read':{input:TimelineReadInput;output:TimelineRevision};
 'timeline.history':{input:Omit<TimelineReadInput,'revision'>;output:TimelineHistory};
 'shots.production':{input:{productionId:string};output:ShotProductionView};
 'shots.history':{input:{projectId:string;shotId:string};output:ShotProductionHistory};
 'shots.collectionIssues':{input:{productionId:string};output:ShotProductionIssuesView};
 'agent.list':{input:{projectId:string};output:AgentSessionList};
 'agent.read':{input:{sessionId:string};output:AgentSessionView};
 'agent.run':{input:{runId:string};output:AgentRunView};
 'agent.templates':{input:Record<string,never>;output:AgentTemplateList};
 'finish.read':{input:{projectId:string;runId:string};output:FinishRunView};
 'finish.list':{input:{sessionId:string};output:FinishRunList};
 'finish.templates':{input:Record<string,never>;output:FinishTemplateList};
 'voice.qualification':{input:{projectId:string;voiceRef:import('./creation.ts').CreationRef;profileRef:import('./models.ts').RevisionRef};output:VoiceAuditionStatus};
 'voice.catalog':{input:{projectId:string;profileRef:import('./models.ts').RevisionRef};output:VoiceCatalog};
 'voice.clone.list':{input:{projectId:string};output:{libraryId:string;projectId:string;jobs:VoiceCloneJob[]}};
 'voice.clone.get':{input:{projectId:string;jobId:string};output:VoiceCloneJob};
 'voice.history':{input:{projectId:string;entityId?:string};output:CharacterVoiceSnapshot};
 'voice.list':{input:{projectId:string;entityId?:string};output:CharacterVoiceSnapshot};
 'voice.read':{input:{projectId:string;voiceRef:import('./creation.ts').CreationRef};output:CharacterVoiceRevision};
 'dialogue.read':{input:{projectId:string;shotId:string;revision?:number};output:ShotDialogueSnapshot};
 'dialogue.production':{input:{projectId:string;planId:string};output:DialogueProductionView};
 'dialogue.productions':{input:DialogueProductionListInput;output:DialogueProductionList};
 'dialogue.takes':{input:{projectId:string;shotId:string};output:DialogueTakeSnapshot};
 'dialogue.reviewContext':{input:{projectId:string;takeId:string};output:DialogueReviewContext};
 'voice.auditionStatus':{input:{projectId:string;voiceRef:import('./creation.ts').CreationRef;profileRef:import('./models.ts').RevisionRef;route:import('./character-voice.ts').DialogueRoute};output:VoiceAuditionStatus};
 'creation.read': { input: CreationReadInput; output: CreationSnapshot };
 'creation.history': { input: CreationHistoryInput; output: CreationHistory };
 'workflow.read':{input:{workflowId:string};output:WorkflowView};
 'workflow.list':{input:Record<string,never>;output:WorkflowSnapshot};
  'canvas.read': { input: { canvasId: string }; output: CanvasSnapshot };
  'task.list': { input: Record<string, never>; output: TaskSnapshot };
  'task.read': { input: { taskId: string }; output: TaskView };
  'project.list': { input: Record<string, never>; output: ProjectSnapshot };
  'command.receipt': { input: { commandId: string }; output: CommandReceipt | null };
  'provider.list': { input: Record<string, never>; output: ProviderSnapshot };
  'model.list': { input: Record<string, never>; output: ModelSnapshot };
  'profile.list': { input: Record<string, never>; output: ProfileSnapshot };
  'asset.history': { input: { assetId: string }; output: AssetHistory };
  'asset.search': { input: AssetSearchInput; output: AssetSnapshot };
}
export interface QueryEnvelope<K extends keyof QueryMap = keyof QueryMap> {
  schemaVersion: 1; libraryId: string; connectionEpoch: string; queryId: string; kind: K; payload: QueryMap[K]['input'];
}
export function parseQuery(value: unknown): Result<QueryEnvelope> {
  if (!isRecord(value) || value.schemaVersion !== 1 || !validId(value.libraryId) || !validId(value.connectionEpoch) || !validId(value.queryId) || !isRecord(value.payload)) return fail('INVALID_INPUT', '查询格式无效。');
  if(value.kind==='audio.voiceoverContext'){const parsed=parseVoiceoverRead(value.payload);return parsed.ok?ok({...value,payload:parsed.value} as unknown as QueryEnvelope):parsed;}
  if (value.kind === 'audio.read' || value.kind === 'audio.batch') {
    const parsed = value.kind === 'audio.read' ? parseAudioRead(value.payload) : parseAudioBatchRead(value.payload);
    return parsed.ok ? ok({ ...value, payload: parsed.value } as unknown as QueryEnvelope) : parsed;
  }
  for (const [kind, parser] of [['render.list',parseRenderList],['render.read',parseRenderRead],['render.plan',parseRenderPlanRead],['media.derived',parseRenderPlanRead]] as const) {
    if (value.kind === kind) { const parsed = parser(value.payload); return parsed.ok ? ok({...value,payload:parsed.value} as unknown as QueryEnvelope) : parsed; }
  }
  for(const [kind,parser] of [['timeline.exports',parseTimelineHistory],['timeline.list',parseTimelineList],['timeline.read',parseTimelineRead],['timeline.history',parseTimelineHistory]] as const){if(value.kind===kind){const p=parser(value.payload);return p.ok?ok({...value,payload:p.value} as unknown as QueryEnvelope):p;}}
  if(value.kind==='shots.production'&&validId(value.payload.productionId)&&Object.keys(value.payload).length===1)return ok(value as unknown as QueryEnvelope<'shots.production'>);
  if(value.kind==='shots.collectionIssues'&&validId(value.payload.productionId)&&Object.keys(value.payload).length===1)return ok(value as unknown as QueryEnvelope<'shots.collectionIssues'>);
  if(value.kind==='shots.history'&&validId(value.payload.projectId)&&validId(value.payload.shotId)&&Object.keys(value.payload).length===2)return ok(value as unknown as QueryEnvelope<'shots.history'>);
  for (const [kind,key] of [['agent.list','projectId'],['agent.read','sessionId'],['agent.run','runId'],['finish.list','sessionId']]) if(value.kind===kind&&validId(value.payload[key!])&&Object.keys(value.payload).length===1)return ok(value as unknown as QueryEnvelope);
  if (value.kind === 'finish.read' && validId(value.payload.projectId) && validId(value.payload.runId) && Object.keys(value.payload).length===2) return ok(value as unknown as QueryEnvelope<'finish.read'>);
  if(value.kind==='voice.qualification'&&validId(value.payload.projectId)&&isRecord(value.payload.voiceRef)&&validId(value.payload.voiceRef.id)&&Number.isSafeInteger(value.payload.voiceRef.revision)&&(value.payload.voiceRef.revision as number)>0&&Object.keys(value.payload.voiceRef).length===2&&isRevisionRef(value.payload.profileRef)&&Object.keys(value.payload).length===3)return ok(value as unknown as QueryEnvelope<'voice.qualification'>);
  if(value.kind==='voice.catalog'&&validId(value.payload.projectId)&&isRecord(value.payload.profileRef)&&Object.keys(value.payload).length===2)return ok(value as unknown as QueryEnvelope<'voice.catalog'>);
  if(value.kind==='voice.clone.list'&&validId(value.payload.projectId)&&Object.keys(value.payload).length===1)return ok(value as unknown as QueryEnvelope<'voice.clone.list'>);
  if(value.kind==='voice.clone.get'&&validId(value.payload.projectId)&&validId(value.payload.jobId)&&Object.keys(value.payload).length===2)return ok(value as unknown as QueryEnvelope<'voice.clone.get'>);
  if ((value.kind === 'voice.list'||value.kind === 'voice.history') && validId(value.payload.projectId) && Object.keys(value.payload).every(key => ['projectId','entityId'].includes(key)) && (value.payload.entityId === undefined || validId(value.payload.entityId))) return ok(value as unknown as QueryEnvelope<'voice.list'>);
  if (value.kind === 'voice.read' && validId(value.payload.projectId) && isRecord(value.payload.voiceRef) && validId(value.payload.voiceRef.id) && Number.isSafeInteger(value.payload.voiceRef.revision) && Object.keys(value.payload).length===2) return ok(value as unknown as QueryEnvelope<'voice.read'>);
  if (value.kind === 'dialogue.read' && validId(value.payload.projectId) && validId(value.payload.shotId) && Object.keys(value.payload).every(key => ['projectId','shotId','revision'].includes(key)) && (value.payload.revision === undefined || Number.isSafeInteger(value.payload.revision))) return ok(value as unknown as QueryEnvelope<'dialogue.read'>);
  if (value.kind === 'dialogue.production' && validId(value.payload.projectId) && validId(value.payload.planId) && Object.keys(value.payload).length===2) return ok(value as unknown as QueryEnvelope<'dialogue.production'>);
  if (value.kind === 'dialogue.productions') { const parsed = parseDialogueProductionList(value.payload); return parsed.ok ? ok({ ...value, payload: parsed.value } as unknown as QueryEnvelope<'dialogue.productions'>) : parsed; }
  if (value.kind === 'dialogue.takes' && validId(value.payload.projectId) && validId(value.payload.shotId) && Object.keys(value.payload).length===2) return ok(value as unknown as QueryEnvelope<'dialogue.takes'>);
  if(value.kind==='dialogue.reviewContext'&&validId(value.payload.projectId)&&validId(value.payload.takeId)&&Object.keys(value.payload).length===2)return ok(value as unknown as QueryEnvelope<'dialogue.reviewContext'>);
  if (value.kind === 'voice.auditionStatus' && validId(value.payload.projectId) && isRecord(value.payload.voiceRef) && isRecord(value.payload.profileRef) && ['native-reference','dubbed-lipsync','voiceover'].includes(value.payload.route as string) && Object.keys(value.payload).length===4) return ok(value as unknown as QueryEnvelope<'voice.auditionStatus'>);
  if (['agent.templates','finish.templates'].includes(value.kind as string) && Object.keys(value.payload).length===0) return ok(value as unknown as QueryEnvelope);
  if (value.kind === 'creation.read') { const parsed = parseCreationRead(value.payload); return parsed.ok ? ok({ ...value, payload: parsed.value } as unknown as QueryEnvelope<'creation.read'>) : parsed; }
  if (value.kind === 'creation.history') { const parsed = parseCreationHistory(value.payload); return parsed.ok ? ok({ ...value, payload: parsed.value } as unknown as QueryEnvelope<'creation.history'>) : parsed; }
  if(value.kind==='workflow.read' && validId(value.payload.workflowId) && Object.keys(value.payload).length===1)return ok(value as unknown as QueryEnvelope<'workflow.read'>);
  if (value.kind === 'asset.search') { const parsed = parseAssetSearch(value.payload); return parsed.ok ? ok({ ...value, payload: parsed.value } as unknown as QueryEnvelope<'asset.search'>) : parsed; }
  if (value.kind === 'asset.history' && validId(value.payload.assetId) && Object.keys(value.payload).length === 1) return ok(value as unknown as QueryEnvelope<'asset.history'>);
  if (value.kind === 'canvas.read' && validId(value.payload.canvasId) && Object.keys(value.payload).length === 1) return ok(value as unknown as QueryEnvelope<'canvas.read'>);
  if (['workflow.list', 'project.list', 'provider.list', 'model.list', 'profile.list', 'task.list'].includes(value.kind as string) && Object.keys(value.payload).length === 0) return ok(value as unknown as QueryEnvelope);
  if (value.kind === 'task.read' && validId(value.payload.taskId) && Object.keys(value.payload).length === 1) return ok(value as unknown as QueryEnvelope<'task.read'>);
  if (value.kind === 'command.receipt' && validId(value.payload.commandId) && Object.keys(value.payload).length === 1) return ok(value as unknown as QueryEnvelope<'command.receipt'>);
  return fail(['asset.history', 'canvas.read', 'project.list', 'provider.list', 'model.list', 'profile.list', 'asset.search', 'task.list', 'task.read', 'command.receipt'].includes(value.kind as string) ? 'INVALID_INPUT' : 'UNKNOWN_QUERY', '查询名称或参数无效。');
}
export function isSnapshot(value: unknown): value is ProjectSnapshot {
  return isRecord(value) && Array.isArray(value.projects) && value.projects.every(isProject) && Number.isSafeInteger(value.snapshotSeq) && (value.snapshotSeq as number) >= 0 && validId(value.streamId);
}
export const queryOutputValidators = {
 'audio.read': isAudioSnapshot, 'audio.batch': isAudioBatchSnapshot, 'audio.voiceoverContext': isVoiceoverContext,
 'render.list': isRenderSnapshot, 'render.read': isRenderJobView, 'render.plan': (value: unknown): value is LocalMediaPlan => isRenderPlan(value) || isDerivedMediaPlan(value), 'media.derived': isDerivedMediaView,
 'timeline.exports':isExportSnapshot,'timeline.list':isTimelineList,'timeline.read':isTimelineRevision,'timeline.history':isTimelineHistory,
 'shots.production':isShotProductionView,'shots.history':isShotProductionHistory,'shots.collectionIssues':isShotProductionIssuesView,
 'agent.list':isAgentList,'agent.read':isAgentSession,'agent.run':isAgentRun,'agent.templates':isAgentTemplates,
 'finish.read':isFinishRun,'finish.list':isFinishRunList,'finish.templates':isFinishTemplateList,
 'voice.qualification':isVoiceAuditionStatus,'voice.catalog':isVoiceCatalog,'voice.clone.list':(x:unknown):x is {libraryId:string;projectId:string;jobs:VoiceCloneJob[]}=>isRecord(x)&&validId(x.libraryId)&&validId(x.projectId)&&Array.isArray(x.jobs)&&x.jobs.every(isVoiceCloneJob),'voice.clone.get':isVoiceCloneJob,'voice.history':isCharacterVoiceSnapshot,'voice.list':isCharacterVoiceSnapshot,'voice.read':isCharacterVoiceRevision,'dialogue.read':isShotDialogueSnapshot,
 'dialogue.production':isDialogueProductionView,'dialogue.takes':isDialogueTakeSnapshot,'voice.auditionStatus':isVoiceAuditionStatus,
 'dialogue.reviewContext':isDialogueReviewContext,
 'dialogue.productions':isDialogueProductionList,
 'creation.read': isCreationSnapshot,
 'creation.history': isCreationHistory,
 'workflow.read':isWorkflowView,
 'workflow.list':isWorkflowSnapshot,
  'canvas.read': isCanvasSnapshot,
  'task.list': isTaskSnapshot,
  'task.read': isTaskView,
  'project.list': isSnapshot,
  'command.receipt': (value: unknown): value is CommandReceipt | null => value === null || isReceipt(value),
  'provider.list': isProviderSnapshot,
  'model.list': isModelSnapshot,
  'profile.list': isProfileSnapshot,
  'asset.search': isAssetSnapshot,
  'asset.history': isAssetHistory,
};
