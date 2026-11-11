export type TimelineReadStats={kind:'queue';active:number;queued:number}|{kind:'cache';size:number};
/** Counts only; observers never receive media references or authorization URLs. */
export function emitTimelineReadStats(stats:TimelineReadStats){if(typeof window!=='undefined')try{window.dispatchEvent(new CustomEvent('movieagent:timeline-read-stats',{detail:stats}));}catch{/* Observation cannot interrupt a read. */}}
