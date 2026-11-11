import { create } from 'zustand';
import type {
  CanvasContent,
  CanvasNodeView,
  CanvasLayout,
} from '../../../../../packages/contracts/src/canvas.ts';
type Draft = { base: CanvasNodeView; content?: CanvasContent; layout?: CanvasLayout };
export const draftKey = (node: Pick<CanvasNodeView, 'nodeId' | 'incarnation'>) =>
  `${node.nodeId}:${node.incarnation}`;
interface State {
  scopes: Record<string, { selected: string | null; drafts: Record<string, Draft> }>;
  select(scope: string, selected: string | null): void;
  edit(scope: string, node: CanvasNodeView, update: Pick<Draft, 'content' | 'layout'>): void;
  clear(scope: string, nodeId: string): void;
  ack(scope: string, node: CanvasNodeView, field: 'content' | 'layout', sent?: CanvasContent | CanvasLayout): void;
}
export const useCanvasDraft = create<State>((set) => ({
  scopes: {},
  select: (scope, selected) =>
    set((s) => ({ scopes: { ...s.scopes, [scope]: { drafts: s.scopes[scope]?.drafts ?? {}, selected } } })),
  edit: (scope, node, update) =>
    set((s) => {
      const previous = s.scopes[scope]?.drafts[draftKey(node)];
      // Capture a field's CAS only on its first edit; reconnect/snapshot refresh
      // must never rebase an already dirty field onto a newer saved version.
      const base = {
        ...(previous?.base ?? node),
        ...(update.content && !previous?.content ? { semanticRevision: node.semanticRevision } : {}),
        ...(update.layout && !previous?.layout ? { layoutRevision: node.layoutRevision } : {}),
      };
      return {
        scopes: {
          ...s.scopes,
          [scope]: {
            selected: node.nodeId,
            drafts: {
              ...s.scopes[scope]?.drafts,
              [draftKey(node)]: { ...previous, base, ...update },
            },
          },
        },
      };
    }),
  clear: (scope, nodeId) =>
    set((s) => {
      const current = s.scopes[scope];
      if (!current) return s;
      const drafts = { ...current.drafts };
      delete drafts[nodeId];
      return { scopes: { ...s.scopes, [scope]: { ...current, drafts } } };
    }),
  ack: (scope, node, field, sent) =>
    set((s) => {
      const current = s.scopes[scope],
        key = draftKey(node),
        draft = current?.drafts[key];
      if (!current || !draft) return s;
      const next = {
        ...draft,
        base: {
          ...draft.base,
          [field === 'content' ? 'semanticRevision' : 'layoutRevision']:
            node[field === 'content' ? 'semanticRevision' : 'layoutRevision'] + 1,
        },
      };
      if (sent === undefined || JSON.stringify(draft[field]) === JSON.stringify(sent)) delete next[field];
      const drafts = { ...current.drafts };
      if (next.content || next.layout) drafts[key] = next;
      else delete drafts[key];
      return { scopes: { ...s.scopes, [scope]: { ...current, drafts } } };
    }),
}));
