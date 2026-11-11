import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { EntityWorkspace } from '../../../apps/desktop/src/renderer/features/entities/EntityWorkspace.tsx';
import { CreationWorkspace } from '../../../apps/desktop/src/renderer/features/creation/CreationWorkspace.tsx';
import { AgentWorkspace } from '../../../apps/desktop/src/renderer/features/agent/AgentWorkspace.tsx';
import { fixtureRuntime } from './runtime.ts';

let root: Root | undefined;
const fixture = {
  ...fixtureRuntime,
  mount(page: 'entity' | 'creation' | 'agent', data: Record<string, unknown>) {
    root?.unmount();
    fixtureRuntime.reset(data);
    root = createRoot(document.getElementById('root')!);
    root.render(page === 'entity' ? createElement(EntityWorkspace, { projectId: 'project' })
      : page === 'creation' ? createElement(CreationWorkspace, { projectId: 'project', directoryMode: false })
        : createElement(AgentWorkspace, { projectId: 'project', onCreation() {} }));
  },
};
declare global { interface Window { p3Fixture: typeof fixture } }
window.p3Fixture = fixture;
