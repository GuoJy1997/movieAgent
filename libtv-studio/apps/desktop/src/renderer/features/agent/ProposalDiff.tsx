import * as React from 'react';
import type { AgentAcceptProposalInput, AgentProposalDraft, CapturedAgentTargets } from '../../../../../../packages/contracts/src/agent.ts';
import type { MediaReference } from '../../../../../../packages/contracts/src/assets.ts';

type Selection = Pick<AgentAcceptProposalInput, 'includeScript' | 'selectedShotKeys' | 'selectedEntityKeys'>;
interface FieldDiff { label: string; before: string; after: string }
interface SceneDiff { title: string; state: '保留' | '修改' | '不变' | '新增'; fields: FieldDiff[] }
export interface ProposalComparison {
  key: string;
  revision: number;
  applies: boolean;
  notice: string;
  fields: FieldDiff[];
  scenes?: SceneDiff[];
}
const kindNames = { character: '角色', scene: '场景设定', prop: '道具', style: '风格' };
const mediaLabel = (ref: MediaReference) => ref.kind === 'assetVersion'
  ? `${ref.assetId} · v${ref.version} · 资料库 ${ref.libraryId}`
  : `${ref.artifactId} · 固定原件 · 资料库 ${ref.libraryId}`;

function compare(before: Record<string, unknown>, after: Record<string, unknown>, labels: Record<string, string>): FieldDiff[] {
  return Object.entries(labels).flatMap(([key, label]) => {
    const oldValue = String(before[key] ?? ''), newValue = String(after[key] ?? '');
    return oldValue === newValue ? [] : [{ label, before: oldValue, after: newValue }];
  });
}

/** Review only captured originals; selection/dependency rules mirror agentApplication's merge, never write. */
export function buildProposalDiffs(targets: CapturedAgentTargets, draft: AgentProposalDraft, selection: Selection): ProposalComparison[] {
  const comparisons: ProposalComparison[] = [];
  const chosen = draft.shots.filter(shot => selection.selectedShotKeys.includes(shot.key));
  const neededEntities = new Set([...selection.selectedEntityKeys, ...chosen.flatMap(shot => shot.entityKeys)]);
  const includesScript = Boolean(draft.script && (selection.includeScript || chosen.length > 0 &&
    (!targets.script || chosen.some(shot => draft.script!.scenes.some(scene => scene.key === shot.sceneKey)))));
  const updatedScenes = includesScript && draft.script
    ? draft.script.scenes.filter(scene => selection.includeScript || chosen.some(shot => shot.sceneKey === scene.key))
    : [];
  const sceneLabels = { title: '标题', location: '地点', time: '时间', description: '描述' };

  if (targets.script && draft.script) {
    const old = targets.script;
    // Existing scenes omitted from the draft are retained, even when the entire script is selected.
    const retained = old.scenes.filter((_, index) => !updatedScenes.some(scene => scene.key === `scene-${index}`));
    const scenes: SceneDiff[] = retained.map(scene => ({ title: scene.title, state: '保留', fields: [] }));
    for (const scene of updatedScenes) {
      const original = old.scenes.find((_, index) => scene.key === `scene-${index}`);
      const fields = compare(original ? { ...original } : {}, { ...scene }, sceneLabels);
      scenes.push({ title: scene.title, state: original ? fields.length ? '修改' : '不变' : '新增', fields });
    }
    comparisons.push({
      key: 'script', revision: old.revision, applies: includesScript,
      notice: !includesScript ? '本次未采用剧本，不写入剧本变化。' : selection.includeScript
        ? '采用剧本文字与提案场景；未出现在提案中的已有场景仍然保留。'
        : '仅合并所选镜头需要的场景，保留原标题、梗概和正文；其余已有场景保留。',
      fields: includesScript && selection.includeScript
        ? compare({ ...old }, { ...draft.script }, { title: '标题', synopsis: '梗概', body: '正文' }) : [],
      scenes,
    });
  }

  for (const entity of draft.entities) {
    const old = targets.entities.find(target => target.key === entity.key)?.value;
    if (!old) continue;
    const applies = neededEntities.has(entity.key);
    comparisons.push({
      key: `entity:${entity.key}`, revision: old.revision, applies,
      notice: !applies ? '本次未采用此实体，不写入变化。' : selection.selectedEntityKeys.includes(entity.key)
        ? '采用此实体的新修订；已有镜头的固定引用不会自动改写。'
        : '此实体是所选镜头的必要依赖，会随镜头一起采用新修订。',
      fields: applies ? compare(
        { ...old, kind: kindNames[old.kind], references: old.references.map(mediaLabel).join('\n') },
        { ...entity, kind: kindNames[entity.kind], references: entity.assetKeys.map(key => {
          const asset = targets.assets.find(target => target.key === key);
          return asset ? mediaLabel(asset.ref) : `未解析引用 ${key}`;
        }).join('\n') },
        { kind: '类型', name: '名称', description: '描述', constraints: '一致性约束', references: '固定素材引用' },
      ) : [],
    });
  }

  for (const shot of draft.shots) {
    const old = targets.shots.find(target => target.key === shot.key)?.value;
    if (!old) continue;
    const applies = selection.selectedShotKeys.includes(shot.key);
    const oldScene = targets.script?.scenes.find(scene => scene.id === old.sceneId);
    const capturedScene = targets.script?.scenes.find((_, index) => shot.sceneKey === `scene-${index}`);
    const updatedScene = updatedScenes.find(scene => scene.key === shot.sceneKey);
    const oldReferences = old.entityRefs.map(ref => {
      const entity = targets.entities.find(target => target.value.id === ref.entityId)?.value;
      return `${entity?.name ?? ref.entityId} · ${ref.entityId} · v${ref.revision}`;
    }).join('\n');
    const newReferences = shot.entityKeys.map(key => {
      const captured = targets.entities.find(target => target.key === key)?.value;
      const update = draft.entities.find(entity => entity.key === key && neededEntities.has(key));
      return captured
        ? `${update?.name ?? captured.name} · ${captured.id} · v${captured.revision + (update ? 1 : 0)}`
        : `${update?.name ?? key} · 新实体 ${key} · v1`;
    }).join('\n');
    comparisons.push({
      key: `shot:${shot.key}`, revision: old.revision, applies,
      notice: applies ? '替换此镜头的下列字段；引用使用本次采用后确定的实体修订。' : '本次未选择此镜头，不写入变化。',
      fields: applies ? compare(
        { ...old, scene: `${oldScene?.title ?? old.sceneId} · ${old.sceneId}`, references: oldReferences },
        { ...shot, scene: `${updatedScene?.title ?? capturedScene?.title ?? shot.sceneKey} · ${capturedScene?.id ?? `新场景 ${shot.sceneKey}`}`, references: newReferences },
        { title: '标题', order: '排序', durationSeconds: '时长（秒）', shotSize: '景别', cameraMovement: '运镜', subject: '主体', action: '动作', dialogue: '台词', sound: '声音', aspectRatio: '画幅', prompt: '生成提示词', scene: '所属场景', references: '固定实体引用' },
      ) : [],
    });
  }
  return comparisons;
}

function ChangedFields({ fields }: { fields: FieldDiff[] }) {
  return (
    <dl className="proposal-diff-fields">
      {fields.map(field => (
        <div className="creation-card" key={field.label}>
          <dt><strong>{field.label}</strong></dt>
          <dd style={{ margin: 0 }}>
            <div className="form-grid">
              <div><small>采用前</small><pre>{field.before || '（空）'}</pre></div>
              <div><small>采用后</small><pre>{field.after || '（空）'}</pre></div>
            </div>
          </dd>
        </div>
      ))}
    </dl>
  );
}

export function ProposalDiff({ comparison }: { comparison: ProposalComparison | undefined }): React.ReactElement | null {
  if (!comparison) return null;
  return (
    <section aria-label="已有内容变更对照" className="form-stack">
      <h4>变更对照 · 捕获版本 v{comparison.revision}</h4>
      <p className="hint">{comparison.notice}</p>
      <ChangedFields fields={comparison.fields} />
      {comparison.applies && comparison.fields.length === 0 && <p>上述文字字段保持不变。</p>}
      {comparison.scenes && (
        <details open>
          <summary>{comparison.applies ? '采用后的场景顺序与变化' : '现有场景（本轮保留）'}</summary>
          {comparison.scenes.map((scene, index) => (
            <section key={`${index}-${scene.title}`}>
              <h4>{index + 1}. {scene.title} · {scene.state}</h4>
              <ChangedFields fields={scene.fields} />
            </section>
          ))}
        </details>
      )}
    </section>
  );
}
