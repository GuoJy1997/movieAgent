import { expect, it } from 'vitest';
import { useCanvasDraft } from '../../apps/desktop/src/renderer/state/canvas-draft.ts';
import type { CanvasNodeView } from '../../packages/contracts/src/canvas.ts';
const node: CanvasNodeView = {
  nodeId: 'n',
  incarnation: 'first',
  semanticRevision: 1,
  layoutRevision: 1,
  selectionRevision: 1,
  content: { type: 'text', text: 'saved' },
  layout: { x: 0, y: 0 },
  selectedOutput: null,
  activeRunBindingId: null,
  freshness: null,
  activeTask: null,
};
it('layout ACK retains independently edited text and content CAS baseline', () => {
  const state = useCanvasDraft.getState();
  state.edit('l:e:c', node, { content: { type: 'text', text: 'draft' } });
  state.edit('l:e:c', { ...node, semanticRevision: 2 }, { layout: { x: 42, y: 16 } });
  state.ack('l:e:c', node, 'layout');
  const draft = useCanvasDraft.getState().scopes['l:e:c']?.drafts['n:first'];
  expect(draft?.content).toEqual({ type: 'text', text: 'draft' });
  expect(draft?.base.semanticRevision).toBe(1);
  expect(draft?.layout).toBeUndefined();
});
it('recreated node and another library never inherit the previous incarnation draft', () => {
  const state = useCanvasDraft.getState();
  state.edit(
    'another:e:c',
    { ...node, incarnation: 'second' },
    { content: { type: 'text', text: 'new library' } },
  );
  expect(useCanvasDraft.getState().scopes['l:e:c']?.drafts['n:second']).toBeUndefined();
  expect(useCanvasDraft.getState().scopes['another:e:c']?.drafts['n:first']).toBeUndefined();
});

it('late content ACK does not erase text typed while save was in flight', () => {
  const state = useCanvasDraft.getState();
  const sent = { type: 'text' as const, text: 'sent' };
  state.edit('inflight', node, { content: sent });
  state.edit('inflight', node, { content: { type: 'text', text: 'typed after send' } });
  state.ack('inflight', node, 'content', sent);
  const draft = useCanvasDraft.getState().scopes.inflight?.drafts['n:first'];
  expect(draft?.content).toEqual({ type: 'text', text: 'typed after send' });
  expect(draft?.base.semanticRevision).toBe(2);
});
it('captures each field baseline when editing that field first, without rebasing an existing dirty field', () => {
  const state = useCanvasDraft.getState();
  state.edit('field-baselines', node, { content: { type: 'text', text: 'draft' } });
  state.edit('field-baselines', { ...node, semanticRevision: 2, layoutRevision: 4 }, { layout: { x: 2, y: 3 } });
  state.edit('field-baselines', { ...node, semanticRevision: 3, layoutRevision: 5 }, { content: { type: 'text', text: 'more draft' }, layout: { x: 4, y: 5 } });
  expect(useCanvasDraft.getState().scopes['field-baselines']?.drafts['n:first']?.base).toMatchObject({ semanticRevision: 1, layoutRevision: 4 });
});
