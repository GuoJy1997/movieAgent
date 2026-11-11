import { useEffect, useState } from 'react';
import { Handle, Position, useUpdateNodeInternals, type Node, type NodeProps } from '@xyflow/react';
import type { CanvasNodeView } from '../../../../../../packages/contracts/src/canvas.ts';
import { MediaPreview } from '../assets/MediaPreview.tsx';
import { taskLabel } from '../tasks/task-labels.ts';
export type StudioNode = Node<{ node: CanvasNodeView; dirty: boolean; label: string; inputPorts: string[]; outputKind: string; soundSource?: string; onOpenDialogue?(): void }, 'studio'>;
export const freshnessLabels = {
  none: '尚无输出',
  current: '与当前输入一致',
  stale: '输出来自旧输入',
  unknown: '输出来源关系未知',
};
export function CanvasCard({ id, data, selected }: NodeProps<StudioNode>) {
  const [video, setVideo] = useState(false);
  const updateNodeInternals=useUpdateNodeInternals(),ports=data.inputPorts.join('|');
  useEffect(()=>{updateNodeInternals(id);},[id,ports,updateNodeInternals]);
  const node = data.node,
    content = node.content;
  return (
    <article aria-label={data.label} className={`canvas-card ${selected ? 'selected' : ''}`}>
      {data.inputPorts.map((port,i)=><Handle key={port} id={port} type="target" position={Position.Left} style={{top:65+i*24}} aria-label={`输入 ${port}`}><span className="port-label">{({prompt:'提示词',reference:'参考',first_frame:'首帧',last_frame:'尾帧',voice_reference:'声音参考'} as Record<string,string>)[port]}</span></Handle>)}
      <Handle id="output" type="source" position={Position.Right} aria-label={`输出 ${data.outputKind}`} />
      <header>
        <span>{content.type === 'text' ? '≡' : 'media' in content ? '▧' : '◇'}</span>
        <strong>
          {content.type === 'text' ? '文本' : 'media' in content ? (video ? '视频 · 固定版本' : '媒体 · 固定版本') : '媒体生成'}
        </strong>
        <small>{data.dirty ? '未保存' : `v${node.semanticRevision}`}</small>
      </header>
      <small className="node-kind">{data.label} · {({text:'文本',image:'图片',video:'视频'} as Record<string,string>)[data.outputKind]??data.outputKind}</small>
      {'voiceBinding' in content&&content.voiceBinding&&<small>角色 {content.voiceBinding.characterRef.id} · 声音 {content.voiceBinding.voiceRef.id} v{content.voiceBinding.voiceRef.revision}</small>}
      {data.soundSource && <div className="nodrag nopan"><small>声音来源：{data.soundSource}</small>{data.onOpenDialogue && <button type="button" onClick={event => { event.stopPropagation(); data.onOpenDialogue?.(); }}>打开对白/剪辑</button>}</div>}
      {content.type === 'text' ? (
        <p className="node-text">{content.text || '选择节点，在右侧写下文字。'}</p>
      ) : 'media' in content ? (
        <div className="node-media">
          <MediaPreview media={content.media} onKind={setVideo} />
        </div>
      ) : (
        <>
          <div className="node-media">
            {node.selectedOutput ? (
              <MediaPreview media={node.selectedOutput} />
            ) : (
              <div className="generation-placeholder">
                <span>◇</span>
                <p>等待你的下一次生成</p>
              </div>
            )}
          </div>
          <p className="node-prompt">{content.prompt || '选择节点，编辑提示词'}</p>
          <footer>
            {node.activeTask ? taskLabel[node.activeTask.state] : freshnessLabels[node.freshness ?? 'none']}
          </footer>
        </>
      )}
    </article>
  );
}
