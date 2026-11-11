/** Fixed metadata is requested only after its owning job has completed.
 * URLs and job state remain separately authorized/refreshed. */
export type WorkspaceQueryPolicy = 'live' | 'fixed';
export function workspaceQueryFreshness(policy:WorkspaceQueryPolicy,online:boolean) {
 return policy==='fixed'
  ? {staleTime:'static' as const,refetchInterval:false as const}
  : {staleTime:0,refetchInterval:online?1500:false as const};
}
