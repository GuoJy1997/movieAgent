import { parseSaveEntity, parseSaveScript, parseSaveShot } from '../../contracts/src/creation.ts';
import type { AgentProposalDraft } from '../../contracts/src/agent.ts';
import { fail, isRecord, ok, type Result } from '../../contracts/src/result.ts';
const key = (v: unknown): v is string => typeof v === 'string' && /^[a-zA-Z0-9_-]{1,64}$/.test(v);
const keys = (v: Record<string, unknown>, required: string[], optional: string[] = []) => required.every(k => Object.hasOwn(v, k)) && Object.keys(v).every(k => required.includes(k) || optional.includes(k));
const refs = (v: unknown, max: number): v is string[] => Array.isArray(v) && v.length <= max && v.every(key) && new Set(v).size === v.length;
/** Strict complete-document parsing. Never extract a likely JSON fragment from prose. */
export function parseAgentProposal(text: string): Result<AgentProposalDraft> {
    const invalid = () => fail('INVALID_AGENT_OUTPUT', '模型输出不是完整的受限创作提案。');
    if (Buffer.byteLength(text, 'utf8') > 256 * 1024)
        return invalid();
    let source = text.trim();
    if (source.startsWith('```')) {
        const match = /^```json\s*\n([\s\S]*)\n```$/.exec(source);
        if (!match)
            return invalid();
        source = match[1]!;
    }
    let v: unknown;
    try {
        v = JSON.parse(source);
    }
    catch {
        return invalid();
    }
    if (!isRecord(v) || !keys(v, ['schemaVersion', 'reply'], ['script', 'entities', 'shots']) || v.schemaVersion !== 1 || typeof v.reply !== 'string' || v.reply.length > 8000)
        return invalid();
    const script = v.script ?? null, entities = v.entities === undefined ? [] : v.entities, shots = v.shots === undefined ? [] : v.shots;
    if (!Array.isArray(entities) || entities.length > 32 || !Array.isArray(shots) || shots.length > 32)
        return invalid();
    const base = {
        projectId: 'project', id: 'object', expectedRevision: 0
    };
    if (script !== null) {
        if (!isRecord(script) || !keys(script, ['title', 'synopsis', 'body', 'scenes']) || !Array.isArray(script.scenes) || script.scenes.some(s => !isRecord(s) || !keys(s, ['key', 'title', 'location', 'time', 'description']) || !key(s.key)))
            return invalid();
        const scenes = script.scenes.map(({ key, ...s }) => ({
            ...s, id: key
        }));
        if (!parseSaveScript({
            ...base, ...script, scenes
        }).ok)
            return invalid();
    }
    for (const entity of entities) {
        if (!isRecord(entity) || !keys(entity, ['key', 'kind', 'name', 'description', 'constraints', 'assetKeys']) || !key(entity.key) || !refs(entity.assetKeys, 4))
            return invalid();
        const { key: _key, assetKeys: _refs, ...fields } = entity;
        if (!parseSaveEntity({
            ...base, ...fields, references: []
        }).ok)
            return invalid();
    }
    for (const shot of shots) {
        if (!isRecord(shot) || !keys(shot, ['key', 'sceneKey', 'order', 'title', 'durationSeconds', 'shotSize', 'cameraMovement', 'subject', 'action', 'dialogue', 'sound', 'aspectRatio', 'prompt', 'entityKeys']) || !key(shot.key) || !key(shot.sceneKey) || !refs(shot.entityKeys, 8))
            return invalid();
        const { key: _key, sceneKey, entityKeys: _refs, ...fields } = shot;
        if (!parseSaveShot({
            ...base, ...fields, scriptId: 'script', sceneId: sceneKey, entityRefs: []
        }).ok)
            return invalid();
    }
    if (new Set(entities.map(e => e.key)).size !== entities.length || new Set(shots.map(s => s.key)).size !== shots.length)
        return invalid();
    return ok({
        schemaVersion: 1, reply: v.reply, script, entities, shots
    } as AgentProposalDraft);
}
