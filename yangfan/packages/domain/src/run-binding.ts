import type { ArtifactRef } from '../../contracts/src/assets.ts';
import type { CanvasNode, CanvasOutput, OutputFreshness, RunBinding, SelectionReason } from '../../contracts/src/canvas.ts';
import { fail, ok, type Result } from '../../contracts/src/result.ts';

export interface SelectionDecision { kind: 'selected' | 'history'; reason: SelectionReason }
export function outputFreshness(node: CanvasNode, outputs: CanvasOutput[]): OutputFreshness | null {
  if (node.content.type !== 'generation') return null;
  if (!node.selectedOutput) return 'none';
  const selected = node.selectedOutput;
  if (selected.kind !== 'artifact') return 'unknown';
  const source = outputs.find(output => output.nodeId === node.nodeId && output.artifactRef.libraryId === selected.libraryId && output.artifactRef.artifactId === selected.artifactId);
  if (!source) return 'unknown';
  return source.incarnation === node.incarnation && source.semanticRevision === node.semanticRevision ? 'current' : 'stale';
}
/** Pure ownership decision; output collection and task success are independent. */
export function trySelectRunOutput(binding: RunBinding, output: { node: CanvasNode | null; artifactRef: ArtifactRef }): Result<SelectionDecision> {
  if (binding.libraryId !== output.artifactRef.libraryId) return fail('WRONG_LIBRARY', '输出属于其他资料库。');
  const node = output.node;
  if (!node) return ok({ kind: 'history', reason: 'deleted' });
  if (node.nodeId !== binding.nodeId || node.incarnation !== binding.incarnation) return ok({ kind: 'history', reason: 'incarnation' });
  if (node.semanticRevision !== binding.semanticRevision) return ok({ kind: 'history', reason: 'semantic' });
  if (node.activeRunBindingId !== binding.runBindingId) return ok({ kind: 'history', reason: 'run' });
  if (node.selectionRevision !== binding.selectionRevision) return ok({ kind: 'history', reason: 'selection' });
  return ok({ kind: 'selected', reason: 'current' });
}
