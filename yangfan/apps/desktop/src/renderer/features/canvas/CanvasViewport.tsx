import {useReactFlow,useViewport} from '@xyflow/react';
import {CanvasIcon} from './CanvasIcon.tsx';
export function CanvasViewport({minimap,showEdges,onMinimap,onEdges}:{minimap:boolean;showEdges:boolean;onMinimap():void;onEdges():void}){
 const flow=useReactFlow(),{zoom}=useViewport();
 return <div className="canvas-viewport-tools" role="group" aria-label="画布视图">
 <button aria-label="缩小画布" title="缩小画布" disabled={zoom<=0.251} onClick={()=>void flow.zoomOut()}><CanvasIcon name="zoom-out" size={18}/></button>
 <button aria-label="重置缩放为100%" title="恢复100%" onClick={()=>void flow.zoomTo(1)}>{Math.round(zoom*100)}%</button>
 <button aria-label="放大画布" title="放大画布" disabled={zoom>=1.799} onClick={()=>void flow.zoomIn()}><CanvasIcon name="zoom-in" size={18}/></button>
 <span/>
 <button aria-label="适应全部节点" title="适应全部节点" onClick={()=>void flow.fitView({padding:0.18,maxZoom:1})}><CanvasIcon name="focus-centered" size={18}/></button>
 <button aria-label="显示小地图" title="显示小地图" aria-pressed={minimap} onClick={onMinimap}><CanvasIcon name="map" size={18}/></button>
 <button aria-label="显示连线" title="显示连线" aria-pressed={showEdges} onClick={onEdges}><CanvasIcon name="link" size={18}/></button>
 </div>;
}
