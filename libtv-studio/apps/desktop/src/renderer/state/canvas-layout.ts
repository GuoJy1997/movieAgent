import type { CanvasNodeView } from '../../../../../packages/contracts/src/canvas.ts';
/** Find a free cell for a new card without moving any saved layout. */
export function nextCanvasLayout(nodes: Pick<CanvasNodeView,'layout'>[]) {
  for (let cell=0;cell<=nodes.length*4;cell++) {
    const candidate={x:80+(cell%3)*350,y:80+Math.floor(cell/3)*550};
    if(!nodes.some(n=>Math.abs(n.layout.x-candidate.x)<320&&Math.abs(n.layout.y-candidate.y)<510))return candidate;
  }
  return {x:80,y:80+nodes.length*550};
}
