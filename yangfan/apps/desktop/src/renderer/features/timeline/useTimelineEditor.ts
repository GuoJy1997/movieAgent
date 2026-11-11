import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { TimelineRevision, TimelineOp, VideoClip, AudioClip } from '../../../../../../packages/contracts/src/timeline.ts';
import { applyTimelineOps } from '../../../../../../packages/domain/src/timeline-edit.ts';
import { useRuntime } from '../../services/runtime.tsx';
type Step = { id: string; operations: TimelineOp[] };
type Node = { value: TimelineRevision; sourceRevision: number; steps: Step[] };
const operations = (node: Node) => node.steps.flatMap(step => step.operations);
const sameContent = (a: TimelineRevision, b: TimelineRevision) => {
    const { revision: _ar, createdAt: _at, ...av } = a, { revision: _br, createdAt: _bt, ...bv } = b;
    return JSON.stringify(av) === JSON.stringify(bv);
};
const persisted = (value: TimelineRevision): Node => ({ value, sourceRevision: value.revision, steps: [] });
/** Each node is a persisted revision plus <=100 semantic operations, never a writeable snapshot. */
export function useTimelineEditor(source: TimelineRevision) {
    const runtime = useRuntime(), identity = `${source.libraryId}/${source.projectId}/${source.id}`;
    const initial = (value: TimelineRevision) => ({ baseline: value, draft: value, history: [persisted(value)], cursor: 0, error: '', saving: false });
    const [state, setState] = useState(() => initial(source));
    const current = useRef(state), scope = useRef(identity), active = useRef(true), flight = useRef(false);
    function update(next: typeof state) { current.current = next; setState(next); }
    useLayoutEffect(() => { active.current = true; return () => { active.current = false; scope.current = 'closed'; }; }, []);
    useLayoutEffect(() => { if (scope.current !== identity) { scope.current = identity; flight.current = false; update(initial(source)); } }, [identity]);
    const dirty = !sameContent(state.baseline, state.draft);
    useEffect(() => {
        const close = (event: BeforeUnloadEvent) => { if (dirty) { event.preventDefault(); event.returnValue = ''; } };
        window.addEventListener('beforeunload', close); return () => window.removeEventListener('beforeunload', close);
    }, [dirty]);
    function edit(edits: TimelineOp[]) {
        const s = current.current, node = s.history[s.cursor]!, result = applyTimelineOps(s.draft, edits);
        if (!result.ok) { update({ ...s, error: result.error.message }); return false; }
        if (operations(node).length + edits.length > 100) { update({ ...s, error: '待保存操作超过100条，请先保存，再继续编辑。' }); return false; }
        const next: Node = { value: result.value, sourceRevision: node.sourceRevision, steps: [...node.steps, { id: crypto.randomUUID(), operations: structuredClone(edits) }] };
        const history = [...s.history.slice(0, s.cursor + 1), next].slice(-51);
        update({ ...s, draft: next.value, history, cursor: history.length - 1, error: '' }); return true;
    }
    function travel(delta: number) {
        const s = current.current, cursor = s.cursor + delta;
        if (cursor >= 0 && cursor < s.history.length) update({ ...s, cursor, draft: s.history[cursor]!.value, error: '' });
    }
    async function save() {
        const s = current.current, submitted = s.history[s.cursor]!;
        if (flight.current || !runtime.online || runtime.pending) return false;
        if (sameContent(s.baseline, s.draft)) return true;
        const token = scope.current;
        flight.current = true; update({ ...s, saving: true });
        try {
            const common = { projectId: s.draft.projectId, timelineId: s.draft.id, expectedRevision: s.baseline.revision };
            const result = submitted.sourceRevision === s.baseline.revision
                ? await runtime.command('timeline.applyOps', { ...common, operations: operations(submitted) })
                : await runtime.command('timeline.restore', { ...common, sourceRevision: submitted.sourceRevision, ...(submitted.steps.length ? { operations: operations(submitted) } : {}) });
            if (!active.current || scope.current !== token || !result) return false;
            const now = current.current;
            const history = now.history.map(node => {
                // Only descendants of this exact submitted recipe gain the persisted anchor.
                if (node.sourceRevision !== submitted.sourceRevision || node.steps.length < submitted.steps.length || !submitted.steps.every((step, i) => node.steps[i]?.id === step.id)) return node;
                const steps = node.steps.slice(submitted.steps.length);
                return { value: steps.length ? { ...node.value, revision: result.revision } : result, sourceRevision: result.revision, steps };
            });
            const draft = history[now.cursor]!.value;
            update({ ...now, baseline: result, history, draft, error: '' }); return sameContent(result, draft);
        } finally { if (active.current && scope.current === token) { flight.current = false; update({ ...current.current, saving: false }); } }
    }
    async function restore(sourceRevision: number) {
        const s = current.current;
        if (flight.current || !runtime.online || runtime.pending || !sameContent(s.baseline, s.draft)) return false;
        const token = scope.current, captured = s.history[s.cursor]!;
        flight.current = true; update({ ...s, saving: true });
        try {
            const result = await runtime.command('timeline.restore', { projectId: s.draft.projectId, timelineId: s.draft.id, expectedRevision: s.baseline.revision, sourceRevision });
            if (!active.current || scope.current !== token || !result) return false;
            const now = current.current, node = now.history[now.cursor]!;
            if (node === captured) { update({ ...initial(result), saving: true }); return true; }
            // B retains its historical anchor; only the acknowledged CAS baseline advances.
            update({ ...now, baseline: result, error: '' }); return false;
        } finally { if (active.current && scope.current === token) { flight.current = false; update({ ...current.current, saving: false }); } }
    }
    function discard() { update(initial(current.current.baseline)); }
    function adopt(value: TimelineRevision) { if (value.id === current.current.draft.id) update(initial(value)); }
    return { ...state, dirty, edit, save, restore, discard, adopt, undo: () => travel(-1), redo: () => travel(1), canUndo: state.cursor > 0, canRedo: state.cursor < state.history.length - 1 };
}
export type TimelineClip = VideoClip | AudioClip;
