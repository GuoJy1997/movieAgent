import { createElement, Fragment, useState } from 'react';
import { DraftNavigationGuard } from '../../../apps/desktop/src/renderer/state/DraftNavigationGuard.tsx';
import { timelineNavigate, useOwnedDraft } from '../../../apps/desktop/src/renderer/state/DraftNavigationGuard.tsx';
import { useRevisionDraft } from '../../../apps/desktop/src/renderer/features/creation/useRevisionDraft.ts';
import { timelineDraftClose } from '../../../apps/desktop/src/main/timeline-draft-close.ts';
import { useRuntime } from './runtime.ts';
import { createRoot, type Root } from 'react-dom/client';
import { fixtureRuntime } from './runtime.ts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '../../../packages/ui/src/tokens.css';
import '../../../apps/desktop/src/renderer/style.css';
import { useTimelineEditor } from '../../../apps/desktop/src/renderer/features/timeline/useTimelineEditor.ts';
import type { TimelineRevision } from '../../../packages/contracts/src/timeline.ts';
function EditorProbe({source}:{source:TimelineRevision}) { const editor=useTimelineEditor(source);fixture.editor=editor;return createElement('output',{'aria-label':'editor draft'},JSON.stringify(editor.draft)); }
function OwnerProbe({ id }: { id: string }) {
  const runtime = useRuntime(), draft = useRevisionDraft(() => ({ expectedRevision: 0, text: '' }));
  fixture.ownerEdits[id] = (text: string) => draft.change({ text });
  useOwnedDraft({ dirty: draft.dirty || draft.saving, save: () => draft.save(value => runtime.command('audio.saveVoiceLine', { projectId: 'project', id, expectedRevision: value.expectedRevision, text: value.text }), result => ({ expectedRevision: result.revision, text: result.text }), () => {}), discard: () => draft.reload({ expectedRevision: 0, text: '' }) }, draft.draft);
  return createElement('input', { 'aria-label': `草稿 ${id}`, value: draft.draft.text, onChange: (event: React.ChangeEvent<HTMLInputElement>) => draft.change({ text: event.target.value }) });
}
function OwnersProbe() {
  const [first, setFirst] = useState(true), [left, setLeft] = useState(false);
  fixture.navigate = () => timelineNavigate(() => setLeft(true));
  if (left) return createElement('p', {}, '已离开探针');
  return createElement('div', {}, first && createElement(OwnerProbe, { id: 'a' }), createElement(OwnerProbe, { id: 'b' }), createElement('button', { onClick: () => setFirst(false) }, '卸载 A'), createElement('button', { onClick: () => timelineNavigate(() => setLeft(true)) }, '离开探针'));
}
let root: Root | undefined;
const bridgeCalls: { kind: string; payload: unknown }[] = [];
let exportResult: unknown;
let subtitleText='';
let mainClose = timelineDraftClose(async () => 'cancel', () => {});
const fixture = {
  editor: undefined as ReturnType<typeof useTimelineEditor>|undefined,
  ownerEdits: {} as Record<string, (text: string) => void>,
  ...fixtureRuntime, bridgeCalls,
  navigate: () => {},
  mayQuit: () => mainClose.mayQuit(),
  updateMainDraft: (value: {dirty:boolean;token:string}) => mainClose.update(value),
  unmount: () => root?.unmount(),
  setExport(value: unknown) { exportResult = value; },
  setSubtitle(text:string){subtitleText=text;},
  async switchProject(projectId: string) {
    const { CreationWorkspace } = await import('../../../apps/desktop/src/renderer/features/creation/CreationWorkspace.tsx');
    root!.render(createElement(QueryClientProvider, { client: new QueryClient({ defaultOptions: { queries: { retry: false } } }) }, createElement(CreationWorkspace, { key: projectId, projectId, directoryMode: true })));
  },
  async mount(data: Record<string, unknown>) {
    root?.unmount(); fixtureRuntime.reset(data); bridgeCalls.length = 0;
    mainClose = timelineDraftClose(async () => 'cancel', () => {});
    window.studio = {
      setTimelineDraftState:async input=>{bridgeCalls.push({kind:'setTimelineDraftState',payload:input});mainClose.update(input);return {ok:true,value:undefined};},
      selectSubtitleFile:async()=>({ok:true,value:{name:'fixture.srt',text:subtitleText}}),
      mediaUrl: async input => { bridgeCalls.push({kind:'mediaUrl',payload:input}); return input.ref.kind==='artifact'&&input.ref.artifactId==='voice-take'||(data.__localMedia as unknown[]|undefined)?.some(ref=>JSON.stringify(ref)===JSON.stringify(input.ref))?{ok:true,value:'/fixture-proxy.wav?original=1'}:{ok:false,error:{code:'MISSING',message:'原件不可用'}}; },
      derivedMediaUrl: async input => { bridgeCalls.push({kind:'derivedMediaUrl',payload:input}); const waveforms=data.__waveforms as Record<string,unknown>|undefined; return {ok:true,value:waveforms&&input.cacheId in waveforms?'/fixture-waveform.json?id='+input.cacheId:'/fixture-proxy.wav?lease='+bridgeCalls.length}; },
      exportTimeline: async input => { bridgeCalls.push({kind:'exportTimeline',payload:input}); return exportResult; },
      cancelTimelineExport: async input => { bridgeCalls.push({kind:'cancelTimelineExport',payload:input}); return {ok:true,value:undefined}; },
      openModelConfigEditor: async input => { bridgeCalls.push({kind:'openModelConfigEditor',payload:input}); return {ok:true,value:{status:'cancelled'}}; },
    } as typeof window.studio;
    const mountedRoot = createRoot(document.getElementById('root')!);
    root = { render: content => mountedRoot.render(createElement(Fragment, null, createElement(DraftNavigationGuard), content)), unmount: () => mountedRoot.unmount() } as Root;
    if(data.__draftOwners){root.render(createElement(OwnersProbe));return;}
    if(data.__taskCenter){const {ProjectTaskCenter}=await import('../../../apps/desktop/src/renderer/features/subprojects/ProjectTaskCenter.tsx');root.render(createElement(QueryClientProvider,{client:new QueryClient()},createElement(ProjectTaskCenter,{projectId:'project',scope:{projectId:'project',subprojectId:'b'},canvasId:'canvas-b',onOpen:(subprojectId:string,canvasId:string|null)=>fixtureRuntime.calls.push({kind:'ui.openTaskSource',payload:{subprojectId,canvasId}})})));return;}
    if(data.__subprojects){const {SubprojectWorkspace}=await import('../../../apps/desktop/src/renderer/features/subprojects/SubprojectWorkspace.tsx');root.render(createElement(QueryClientProvider,{client:new QueryClient()},createElement(SubprojectWorkspace,{projectId:'project',onOpen:()=>{}})));return;}
    if(data.__configDialog){const {ConfigDialog}=await import('../../../apps/desktop/src/renderer/features/models/ConfigDialog.tsx');root.render(createElement(ConfigDialog,{...(data.__configDialog as object),onClose:()=>{}} as never));return;}
    if(data.__canvas){const {CanvasWorkspace}=await import('../../../apps/desktop/src/renderer/features/canvas/CanvasWorkspace.tsx');root.render(createElement(QueryClientProvider,{client:new QueryClient({defaultOptions:{queries:{retry:false}}})},createElement(CanvasWorkspace,{project:{libraryId:'library',id:'project',name:'Fixture'} as never,onOpenDialogue:async id=>{const {CreationWorkspace}=await import('../../../apps/desktop/src/renderer/features/creation/CreationWorkspace.tsx');root!.render(createElement(QueryClientProvider,{client:new QueryClient({defaultOptions:{queries:{retry:false}}})},createElement(CreationWorkspace,{projectId:'project',directoryMode:true,focusShotId:id,openDialogue:true})));}})));return;}
    if(data.__editor){root.render(createElement(EditorProbe,{source:data.__editor as TimelineRevision}));return;}
    if(data.__finishRun){const {FinishProposal}=await import('../../../apps/desktop/src/renderer/features/agent/FinishProposal.tsx');root.render(createElement(FinishProposal,{run:data.__finishRun as never}));return;}
    if(data.__voiceover){const {VoiceoverPanel}=await import('../../../apps/desktop/src/renderer/features/audio/VoiceoverPanel.tsx');root.render(createElement(QueryClientProvider,{client:new QueryClient()},createElement(VoiceoverPanel,{projectId:'project',dialogue:data.__voiceover as never})));return;}
    if(data.__auditions){const {VoiceIdentityAuditions}=await import('../../../apps/desktop/src/renderer/features/entities/VoiceIdentityAuditions.tsx');root.render(createElement(QueryClientProvider,{client:new QueryClient()},createElement(VoiceIdentityAuditions,{projectId:'project',voice:data.__auditions as never})));return;}
    if(data.__entity){const {EntityWorkspace}=await import('../../../apps/desktop/src/renderer/features/entities/EntityWorkspace.tsx');root.render(createElement(QueryClientProvider,{client:new QueryClient({defaultOptions:{queries:{retry:false}}})},createElement(EntityWorkspace,{projectId:'project'})));return;}
    if(data.__creation){const {CreationWorkspace}=await import('../../../apps/desktop/src/renderer/features/creation/CreationWorkspace.tsx');root.render(createElement(QueryClientProvider,{client:new QueryClient({defaultOptions:{queries:{retry:false}}})},createElement(CreationWorkspace,{projectId:'project',directoryMode:true})));return;}
    try {
      const path = '/apps/desktop/src/renderer/features/timeline/TimelineWorkspace.tsx';
      const { TimelineWorkspace } = await import(/* @vite-ignore */ path);
      root.render(createElement(QueryClientProvider,{client:new QueryClient({defaultOptions:{queries:{retry:false}}})},createElement('div',{className:'studio-shell'},createElement('aside',{className:'app-sidebar','aria-label':'工作区'},'MovieAgent STUDIO'),createElement('main',{className:'main-area'},createElement('div',{className:'page-container'},createElement(TimelineWorkspace, { projectId: 'project' }))))));
    } catch (error) { root.render(createElement('p', {}, '剪辑工作台尚未实现: '+String(error))); }
  },
};
declare global { interface Window { p4Fixture: typeof fixture } }
window.p4Fixture = fixture;
