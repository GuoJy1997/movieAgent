import type { CanvasEdge, CanvasNode, CanvasSnapshot, CanvasGraphInputs } from '../../contracts/src/canvas.ts';
import type { ModelCapabilities } from '../../contracts/src/models.ts';
import { fail, ok, type Result } from '../../contracts/src/result.ts';
export type GraphKind = 'text' | 'image' | 'video';
export interface GraphType {
    output: GraphKind;
    inputs: ModelCapabilities['inputKinds'][number][];
    adapter: string | null;
}
/** Validation depends on declared capabilities and fixed-original MIME, never model names. */
export function validateGraph(nodes: CanvasNode[], edges: CanvasEdge[], typeOf: (node: CanvasNode) => Result<GraphType>): Result<void> {
    const ids = new Set<string>();
    for (const edge of edges) {
        const source = nodes.find(n => n.nodeId === edge.sourceNodeId && n.incarnation === edge.sourceIncarnation);
        const target = nodes.find(n => n.nodeId === edge.targetNodeId && n.incarnation === edge.targetIncarnation);
        if (!source || !target)
            return fail('GRAPH_DANGLING', '连线节点不存在或身份已变化。');
        if (source.nodeId === target.nodeId)
            return fail('GRAPH_CYCLE', '不支持自环。');
        if (ids.has(edge.id))
            return fail('GRAPH_DUPLICATE', '连线身份重复。');
        ids.add(edge.id);
        const from = typeOf(source), to = typeOf(target);
        if (!from.ok)
            return from;
        if (!to.ok)
            return to;
        const expected = edge.targetPort === 'prompt' ? 'text' : 'image';
        if (target.content.type !== 'generation' || from.value.output !== expected || !to.value.inputs.includes(expected) || ['first_frame', 'last_frame'].includes(edge.targetPort) && to.value.adapter !== 'minimax-video-v2')
            return fail('GRAPH_TYPE_MISMATCH', '连线类型不兼容，请先断开连接再更换节点输入或模型。');
        const incoming = edges.filter(e => e.targetNodeId === target.nodeId);
        const samePort = incoming.filter(e => e.targetPort === edge.targetPort);
        if (samePort.length > (edge.targetPort === 'reference' ? 4 : 1) || incoming.filter(e => e.targetPort !== 'prompt').length > 4 || incoming.some(e => e.targetPort === 'reference') && incoming.some(e => ['first_frame', 'last_frame'].includes(e.targetPort)) || edges.some(e => e.id !== edge.id && e.sourceNodeId === edge.sourceNodeId && e.targetNodeId === edge.targetNodeId && e.targetPort === edge.targetPort))
            return fail('GRAPH_PORT_LIMIT', '输入端口重复、超限或参考图模式冲突。');
    }
    const visiting = new Set<string>(), done = new Set<string>();
    function visit(id: string): boolean {
        if (visiting.has(id))
            return false;
        if (done.has(id))
            return true;
        visiting.add(id);
        for (const edge of edges.filter(e => e.sourceNodeId === id))
            if (!visit(edge.targetNodeId))
                return false;
        visiting.delete(id);
        done.add(id);
        return true;
    }
    return nodes.every(n => visit(n.nodeId)) ? ok(undefined) : fail('GRAPH_CYCLE', '连线不能形成环。');
}
/** Stable topological scope. current and selection never expand to upstream generation. */
export function graphScope(snapshot: CanvasSnapshot, mode: 'current' | 'upstream' | 'selection', nodeIds: string[]): Result<CanvasNode[]> {
    if (mode === 'current' && nodeIds.length !== 1 || !nodeIds.length || new Set(nodeIds).size !== nodeIds.length)
        return fail('INVALID_INPUT', '请选择明确的执行节点。');
    const selected = new Set(nodeIds);
    if (nodeIds.some(id => !snapshot.nodes.some(n => n.nodeId === id && (mode === 'selection' || n.content.type === 'generation'))))
        return fail('GENERATION_NODE_NOT_FOUND', '执行范围含不存在的生成节点。');
    if (mode === 'upstream') {
        const add = (id: string) => { for (const edge of snapshot.edges.filter(e => e.targetNodeId === id))
            if (!selected.has(edge.sourceNodeId)) {
                selected.add(edge.sourceNodeId);
                add(edge.sourceNodeId);
            } };
        nodeIds.forEach(add);
    }
    const ordered: CanvasNode[] = [], visited = new Set<string>();
    const visit = (id: string) => { if (visited.has(id))
        return; visited.add(id); snapshot.edges.filter(e => e.targetNodeId === id && selected.has(e.sourceNodeId)).sort((a, b) => a.id.localeCompare(b.id)).forEach(e => visit(e.sourceNodeId)); const node = snapshot.nodes.find(n => n.nodeId === id)!; if (node.content.type === 'generation')
        ordered.push(node); };
    [...selected].sort().forEach(visit);
    if (!ordered.length) return fail('GENERATION_NODE_NOT_FOUND', '所选范围没有生成节点。');
    return ordered.length <= 32 ? ok(ordered) : fail('GRAPH_LIMIT', '最多32个生成步骤。');
}
/** Exact transitive input provenance, independent of layout and active-run labels. */
export function graphInputSnapshot(nodes: CanvasNode[], edges: CanvasEdge[], nodeId: string): CanvasGraphInputs {
    const visited = new Set<string>(), selected = new Map<string, CanvasEdge>();
    function visit(id: string) { for (const edge of edges.filter(e => e.targetNodeId === id)) {
        selected.set(edge.id, edge);
        if (!visited.has(edge.sourceNodeId)) {
            visited.add(edge.sourceNodeId);
            visit(edge.sourceNodeId);
        }
    } }
    visit(nodeId);
    return { edges: [...selected.values()].sort((a, b) => a.id.localeCompare(b.id)), nodes: [...visited].sort().map(id => { const n = nodes.find(n => n.nodeId === id)!; return { nodeId: n.nodeId, incarnation: n.incarnation, semanticRevision: n.semanticRevision, selectionRevision: n.selectionRevision, selectedOutput: n.selectedOutput }; }) };
}
