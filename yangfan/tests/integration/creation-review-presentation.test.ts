import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { creationNavigation, resolveShotEditor } from '../../apps/desktop/src/renderer/features/creation/creation-navigation';
import { buildProposalDiffs, ProposalDiff } from '../../apps/desktop/src/renderer/features/agent/ProposalDiff';
import { agentApplication } from '../../packages/engine/src/agent-application';
import type { PreparedAgentTurn, AgentProposalDraft } from '../../packages/contracts/src/agent';
import type { ShotRevision } from '../../packages/contracts/src/creation';

const base = { libraryId: 'library', projectId: 'project', revision: 3, createdAt: '2026-10-26T00:00:00.000Z' };
const originalShot: ShotRevision = { ...base, id: 'shot', scriptId: 'script-a', sceneId: 'scene-a', order: 0, title: '来信', durationSeconds: 5, shotSize: '中景', cameraMovement: '固定', subject: '林舟', action: '站立', dialogue: '别走', sound: '风声', aspectRatio: '16:9', prompt: '旧码头', entityRefs: [{ libraryId: 'library', projectId: 'project', entityId: 'hero', revision: 3 }] };
const script = { ...base, id: 'script-a', title: '旧标题', synopsis: '旧梗概', body: '旧正文', scenes: [{ id: 'scene-a', title: '码头', location: '海边', time: '白天', description: '旧描述' }, { id: 'scene-b', title: '家中', location: '室内', time: '夜', description: '保留场景' }] };
const targets = { script, shots: [{ key: 'shot-0', value: originalShot }], entities: [{ key: 'entity-0', value: { ...base, id: 'hero', kind: 'character' as const, name: '林舟', description: '旧设定', constraints: '灰衣', references: [{ kind: 'assetVersion' as const, libraryId: 'library', assetId: 'portrait', version: 1 }] } }], assets: [{ key: 'asset-0', ref: { kind: 'assetVersion' as const, libraryId: 'library', assetId: 'portrait', version: 2 }, metadata: { hash: 'a'.repeat(64), mime: 'image/png', byteLength: 20, width: 2, height: 2 } }] };
const draft: AgentProposalDraft = {
  schemaVersion: 1, reply: '调整',
  script: { title: '新标题', synopsis: '新梗概', body: '新正文', scenes: [{ key: 'scene-0', title: '码头', location: '海边', time: '夜晚', description: '新描述' }, { key: 'new-scene', title: '站台', location: '车站', time: '黎明', description: '' }] },
  entities: [{ key: 'entity-0', kind: 'character', name: '林舟', description: '新设定', constraints: '蓝衣', assetKeys: ['asset-0'] }],
  shots: [{ key: 'shot-0', sceneKey: 'scene-0', order: 0, title: '来信', durationSeconds: 5, shotSize: '中景', cameraMovement: '固定', subject: '林舟', action: '转身', dialogue: '', sound: '风声', aspectRatio: '16:9', prompt: '旧码头', entityKeys: ['entity-0'] }],
};

it('dismisses canvas focus and editors atomically on explicit script switch, with an ownership guard', () => {
  const initial = { scriptId: '', focusDismissed: false, shot: null, editing: null };
  expect(resolveShotEditor(initial, 'shot', 'script-a', [originalShot])).toEqual(originalShot);
  const active = creationNavigation(initial, { type: 'patch', patch: { shot: originalShot, editing: script } });
  const switched = creationNavigation(active, { type: 'selectScript', scriptId: 'script-b' });
  expect(switched).toEqual({ scriptId: 'script-b', focusDismissed: true, shot: null, editing: null });
  expect(resolveShotEditor(switched, 'shot', 'script-b', [originalShot])).toBeNull();
  expect(resolveShotEditor({ ...initial, shot: originalShot }, 'shot', 'script-b', [originalShot])).toBeNull();
  expect(resolveShotEditor({ ...switched, shot: 'new' }, 'shot', 'script-b', [originalShot])).toBe('new');
});

it('renders changed captured fields and exact fixed references, including emptied dialogue', () => {
  const diffs = buildProposalDiffs(targets, draft, { includeScript: true, selectedShotKeys: ['shot-0'], selectedEntityKeys: [] });
  const shot = diffs.find(d => d.key === 'shot:shot-0')!;
  expect(shot.fields.find(f => f.label === '动作')).toMatchObject({ before: '站立', after: '转身' });
  expect(shot.fields.find(f => f.label === '台词')).toMatchObject({ before: '别走', after: '' });
  expect(shot.fields.find(f => f.label === '固定实体引用')?.after).toContain('v4');
  const entity = diffs.find(d => d.key === 'entity:entity-0')!;
  expect(entity.fields.find(f => f.label === '一致性约束')).toMatchObject({ before: '灰衣', after: '蓝衣' });
  expect(entity.fields.find(f => f.label === '固定素材引用')).toMatchObject({ before: expect.stringContaining('portrait · v1'), after: expect.stringContaining('portrait · v2') });
  expect(entity.notice).toContain('必要依赖');
  const html = renderToStaticMarkup(createElement(ProposalDiff, { comparison: shot }));
  expect(html).toContain('采用前'); expect(html).toContain('采用后'); expect(html).toContain('站立'); expect(html).toContain('转身'); expect(html).toContain('（空）');
  expect(html).not.toContain('textarea');
});

it('matches merge semantics: omitted scenes are retained and partial adoption preserves prose', () => {
  for (const includeScript of [false, true]) {
    const selection = { includeScript, selectedShotKeys: ['shot-0'], selectedEntityKeys: [] };
    const comparison = buildProposalDiffs(targets, draft, selection).find(d => d.key === 'script')!;
    const actual = agentApplication({ targets, template: { allowed: ['script', 'entity', 'shot'] }, projectId: 'project', libraryId: 'library', runId: 'run' } as PreparedAgentTurn, draft, selection);
    expect(actual.ok).toBe(true);
    if (!actual.ok) return;
    expect(comparison.scenes?.map(s => s.title)).toEqual(actual.value.batch.scripts[0]!.scenes.map(s => s.title));
    expect(comparison.scenes?.find(s => s.title === '家中')?.state).toBe('保留');
    expect(comparison.scenes?.find(s => s.title === '码头')?.state).toBe('修改');
    expect(comparison.scenes?.some(s => s.state === '新增')).toBe(includeScript);
    expect(comparison.fields.some(f => f.label === '正文')).toBe(includeScript);
    expect(renderToStaticMarkup(createElement(ProposalDiff, { comparison }))).not.toContain('删除场景');
  }
});

it('does not invent writes for unchecked targets or diff cards for new objects', () => {
  const diffs = buildProposalDiffs(targets, draft, { includeScript: false, selectedShotKeys: [], selectedEntityKeys: [] });
  expect(diffs.every(d => !d.applies && d.fields.length === 0)).toBe(true);
  expect(buildProposalDiffs({ script: null, shots: [], entities: [], assets: [] }, draft, { includeScript: true, selectedShotKeys: ['shot-0'], selectedEntityKeys: [] })).toEqual([]);
});

it('shows cleared reference lists as removals while leaving unselected content alone', () => {
  const changed = { ...draft, entities: [{ ...draft.entities[0]!, assetKeys: [] }], shots: [{ ...draft.shots[0]!, entityKeys: [] }] };
  const diffs = buildProposalDiffs(targets, changed, { includeScript: false, selectedShotKeys: ['shot-0'], selectedEntityKeys: ['entity-0'] });
  expect(diffs.find(d => d.key === 'entity:entity-0')?.fields.find(f => f.label === '固定素材引用')?.after).toBe('');
  expect(diffs.find(d => d.key === 'shot:shot-0')?.fields.find(f => f.label === '固定实体引用')?.after).toBe('');
});
