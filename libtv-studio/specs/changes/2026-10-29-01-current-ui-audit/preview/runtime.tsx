import { useSyncExternalStore } from 'react';
import { queryData } from './data.ts';
const listeners=new Set<()=>void>();let version=0;let error:any=null;
function publish(){version++;listeners.forEach(l=>l());}
const runtime={online:true,busy:false,pending:false,descriptor:{libraryId:'library',connectionEpoch:'audit-preview'},get error(){return error;},clearError(){error=null;publish();},async refresh(){publish();},async recover(){},async command(kind:string,payload:unknown){window.auditPreview.calls.push({kind,payload});error={code:'AUDIT_READ_ONLY',message:'此为只读 UI 审查。保存、生成、导出、导入及文件操作均未执行。'};publish();return undefined;}};
export function useRuntime(){useSyncExternalStore(l=>{listeners.add(l);return()=>{listeners.delete(l);}},()=>version);return runtime;}
export function RuntimeProvider({children}:any){return children;}
export function useWorkspaceQuery(kind:string,payload:any,enabled=true){useSyncExternalStore(l=>{listeners.add(l);return()=>{listeners.delete(l);}},()=>version);const data=enabled?queryData(kind,payload):undefined;return{data,isPending:false,isLoading:false,isSuccess:enabled,error:null,refetch:async()=>({data})};}
