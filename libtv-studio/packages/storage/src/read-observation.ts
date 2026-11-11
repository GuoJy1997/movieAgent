import{channel}from'node:diagnostics_channel';
export interface ReadPoolStats{poolId:string;kind:'original'|'derived';held:number;activeRanges:number;opening:number;closing:number;closeFailures:number}
const observations=channel('movieagent.media.readers');let nextPool=0;
/** Operational counts only: no paths, object IDs, authorization tokens or media bytes. */
export function observeReadPool(kind:ReadPoolStats['kind']){
 const poolId=String(++nextPool);
 return(held:number,activeRanges:number,opening:number,closing:number,closeFailures:number)=>{if(observations.hasSubscribers)observations.publish({poolId,kind,held,activeRanges,opening,closing,closeFailures} satisfies ReadPoolStats);};
}
