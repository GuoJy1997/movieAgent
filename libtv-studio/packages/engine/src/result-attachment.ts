import type { ArtifactRef } from '../../contracts/src/assets.ts';
import type { CanvasOutput, RunBinding } from '../../contracts/src/canvas.ts';
import { ok, type Result } from '../../contracts/src/result.ts';
import { trySelectRunOutput, type SelectionDecision } from '../../domain/src/run-binding.ts';
import type { LibraryHandle } from '../../storage/src/database.ts';
import type { canvasFor } from './canvas-service.ts';

/** Called in the same short transaction as artifact and provider verification publication. */
export function attachRunOutput(library: LibraryHandle, canvas: ReturnType<typeof canvasFor>, taskId: string, artifactRef: ArtifactRef): Result<SelectionDecision | null> {
  const stored = library.db.prepare('SELECT binding_json FROM run_binding WHERE task_id=?').get(taskId);
  if (!stored) return ok(null); // Standalone inline generations have no canvas owner.
  const binding = JSON.parse(stored.binding_json as string) as RunBinding;
  const existing = library.db.prepare('SELECT output_json FROM canvas_output WHERE run_binding_id=?').get(binding.runBindingId);
  if (existing) return ok(null);
  const node = canvas.currentNode(binding.canvasId, binding.nodeId);
  const decision = trySelectRunOutput(binding, { node, artifactRef });
  if (!decision.ok) return decision;
  if(decision.value.kind==='selected'&&!canvas.bindingInputsCurrent(binding))decision.value={kind:'history',reason:'semantic'};
  const output: CanvasOutput = {
    runBindingId: binding.runBindingId,
    taskId,
    nodeId: binding.nodeId,
    incarnation: binding.incarnation,
    semanticRevision: binding.semanticRevision,
    artifactRef,
    selection: decision.value.kind,
    reason: decision.value.reason,
  };
  library.db.prepare('INSERT INTO canvas_output(run_binding_id,artifact_id,output_json) VALUES(?,?,?)').run(binding.runBindingId, artifactRef.artifactId, JSON.stringify(output));
  if (decision.value.kind === 'selected' && node) {
    canvas.writeNode(binding.canvasId, { ...node, selectedOutput: artifactRef, selectionRevision: node.selectionRevision + 1 });
  }
  canvas.notify(canvas.publishChange(binding.canvasId, binding.runBindingId, [binding.nodeId]));
  return decision;
}
