import { createHash } from 'node:crypto';
import type { AgentProposalDraft, PreparedAgentTurn, AgentAcceptProposalInput } from '../../contracts/src/agent.ts';
import type { CreationBatch, CreationKind } from '../../contracts/src/creation.ts';
import { fail, ok, type Result } from '../../contracts/src/result.ts';
export const agentDigest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const objectId = (runId: string, kind: string, key: string) => `agent-${agentDigest([runId, kind, key]).slice(0, 48)}`;
export interface AgentApplication {
    batch: CreationBatch;
    versions: {
        kind: CreationKind;
        id: string;
        revision: number;
    }[];
    entityKeys: string[];
    shotKeys: string[];
    includeScript: boolean;
}
/** Resolve only user-captured aliases or deterministic engine-owned new identities. */
export function agentApplication(prepared: PreparedAgentTurn, draft: AgentProposalDraft, selection: Pick<AgentAcceptProposalInput, 'selectedShotKeys' | 'selectedEntityKeys' | 'includeScript'>): Result<AgentApplication> {
    const bad = () => fail('INVALID_AGENT_OUTPUT', '提案引用未知目标、场景、实体或模板不允许的动作。');
    const targets = prepared.targets, projectId = prepared.projectId;
    if ((draft.script && !prepared.template.allowed.includes('script')) || (draft.entities.length && !prepared.template.allowed.includes('entity')) || (draft.shots.length && !prepared.template.allowed.includes('shot')))
        return bad();
    if (selection.selectedShotKeys.some(k => !draft.shots.some(s => s.key === k)) || selection.selectedEntityKeys.some(k => !draft.entities.some(e => e.key === k)) || selection.includeScript && !draft.script)
        return bad();
    const chosen = draft.shots.filter(s => selection.selectedShotKeys.includes(s.key)), needed = new Set([...selection.selectedEntityKeys, ...chosen.flatMap(s => s.entityKeys)]);
    const entities = draft.entities.filter(e => needed.has(e.key));
    const versions: AgentApplication['versions'] = [];
    const batch: CreationBatch = {
        projectId, entities: [], scripts: [], shots: []
    };
    const scriptId = targets.script?.id ?? objectId(prepared.runId, 'script', 'script');
    const includeScript = !!draft.script && (selection.includeScript || chosen.length > 0 && (!targets.script || chosen.some(s => draft.script!.scenes.some(scene => scene.key === s.sceneKey))));
    if ((includeScript || chosen.length) && targets.script)
        versions.push({
            kind: 'script', id: targets.script.id, revision: targets.script.revision
        });
    const scenes = new Map(targets.script?.scenes.map((s, i) => [`scene-${i}`, s.id]) ?? []);
    if (includeScript && draft.script) {
        const selectedSceneKeys = new Set(chosen.map(s => s.sceneKey));
        const draftScenes = selection.includeScript ? draft.script.scenes : draft.script.scenes.filter(s => selectedSceneKeys.has(s.key));
        const updates = draftScenes.map(({ key, ...fields }) => {
            const id = scenes.get(key) ?? objectId(prepared.runId, 'scene', key);
            scenes.set(key, id);
            return {
                id, ...fields
            };
        });
        // Partial adoption preserves existing scenes, ensuring unrelated shots never dangle.
        const oldScenes = targets.script?.scenes ?? [];
        const finalScenes = [...oldScenes.filter(s => !updates.some(u => u.id === s.id)), ...updates];
        batch.scripts.push({
            projectId, id: scriptId, expectedRevision: targets.script?.revision ?? 0, title: (!selection.includeScript && targets.script ? targets.script : draft.script).title, synopsis: (!selection.includeScript && targets.script ? targets.script : draft.script).synopsis, body: (!selection.includeScript && targets.script ? targets.script : draft.script).body, scenes: finalScenes
        });
    }
    if (chosen.length && !targets.script && !includeScript)
        return bad();
    for (const e of entities) {
        const old = targets.entities.find(x => x.key === e.key)?.value;
        const refs = e.assetKeys.map(k => targets.assets.find(a => a.key === k)?.ref);
        if (refs.some(r => !r))
            return bad();
        if (old)
            versions.push({
                kind: 'entity', id: old.id, revision: old.revision
            });
        const { key, assetKeys: _assets, ...fields } = e;
        batch.entities.push({
            ...fields, projectId, id: old?.id ?? objectId(prepared.runId, 'entity', key), expectedRevision: old?.revision ?? 0, references: refs.map(r => r!)
        });
    }
    for (const s of chosen) {
        const old = targets.shots.find(x => x.key === s.key)?.value;
        if (old)
            versions.push({
                kind: 'shot', id: old.id, revision: old.revision
            });
        const entityRefs = [];
        for (const key of s.entityKeys) {
            const entity = entities.find(e => e.key === key), captured = targets.entities.find(e => e.key === key)?.value;
            if (!entity && !captured)
                return bad();
            if (captured && !versions.some(v => v.kind === 'entity' && v.id === captured.id))
                versions.push({
                    kind: 'entity', id: captured.id, revision: captured.revision
                });
            entityRefs.push({
                libraryId: prepared.libraryId, projectId, entityId: captured?.id ?? objectId(prepared.runId, 'entity', key), revision: (captured?.revision ?? 0) + (entity ? 1 : 0)
            });
        }
        const sceneId = scenes.get(s.sceneKey);
        if (!sceneId)
            return bad();
        const { key, sceneKey: _scene, entityKeys: _entities, ...fields } = s;
        batch.shots.push({
            ...fields, projectId, id: old?.id ?? objectId(prepared.runId, 'shot', key), expectedRevision: old?.revision ?? 0, scriptId, sceneId, entityRefs
        });
    }
    return ok({
        batch, versions, entityKeys: entities.map(e => e.key).sort(), shotKeys: chosen.map(s => s.key).sort(), includeScript
    });
}
