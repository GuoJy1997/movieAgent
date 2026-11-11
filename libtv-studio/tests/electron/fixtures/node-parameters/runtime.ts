/** Fixture-only command boundary; never imported by a production build. */
export function useRuntime(){return {command:async(kind:string,payload:unknown)=>{(window as any).parameterSave={kind,payload};return undefined;}};}
