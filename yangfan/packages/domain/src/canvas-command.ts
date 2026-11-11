import type { CanvasEdge, CanvasNode, CanvasOperation } from '../../contracts/src/canvas.ts';
import type { Result } from '../../contracts/src/result.ts';
import { ok } from '../../contracts/src/result.ts';

export type CanvasInverse = CanvasOperation | { kind: 'restore'; node: CanvasNode; edges?: CanvasEdge[] };
export function canvasConflict(field: string, expected: unknown, current: unknown): Result<never> {
  return { ok: false, error: { code: 'CANVAS_CONFLICT', message: '画布相关字段已变化，请检查差异。', fieldErrors: { [field]: `expected=${JSON.stringify(expected)}; current=${JSON.stringify(current)}` } } };
}
/** Global canvas revision orders events; only a touched field can conflict. */
export function checkCanvasOperation(node: CanvasNode | null, operation: Exclude<CanvasOperation, { kind: 'create' | 'addEdge' | 'removeEdge' }>): Result<void> {
  if (!node || node.incarnation !== operation.incarnation) return canvasConflict(`${operation.nodeId}.incarnation`, operation.incarnation, node?.incarnation ?? null);
  if (operation.kind === 'delete') {
    for (const [field, expected, current] of [
      ['content', operation.expectedSemanticRevision, node.semanticRevision],
      ['layout', operation.expectedLayoutRevision, node.layoutRevision],
      ['selection', operation.expectedSelectionRevision, node.selectionRevision],
      ['run', operation.expectedRunBindingId, node.activeRunBindingId],
    ] as const) {
      if (expected !== current) return canvasConflict(`${node.nodeId}.${field}`, expected, current);
    }
    return ok(undefined);
  }
  const field = operation.kind === 'setContent' ? 'content' : operation.kind === 'setLayout' ? 'layout' : 'selection';
  const current = operation.kind === 'setContent' ? node.semanticRevision : operation.kind === 'setLayout' ? node.layoutRevision : node.selectionRevision;
  if (current === operation.expectedRevision) return ok(undefined);
  const proposed = operation.kind === 'setContent' ? operation.content : operation.kind === 'setLayout' ? operation.layout : operation.output;
  const value = operation.kind === 'setContent' ? node.content : operation.kind === 'setLayout' ? node.layout : node.selectedOutput;
  return canvasConflict(
    `${node.nodeId}.${field}`,
    { revision: operation.expectedRevision, proposed },
    { revision: current, value },
  );
}
