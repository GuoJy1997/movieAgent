import {it,expect} from 'vitest';
import {QueryClient,QueryObserver} from '@tanstack/react-query';
import {workspaceQueryFreshness} from '../../apps/desktop/src/renderer/services/query-policy.ts';
it('keeps completed fixed metadata cached across live-job invalidations while live states continue refreshing',async()=>{
 const client=new QueryClient({defaultOptions:{queries:{retry:false}}});let fixed=0,live=0;
 const a=new QueryObserver(client,{queryKey:['plan','fixed'],queryFn:async()=>({revision:++fixed}),...workspaceQueryFreshness('fixed',true)}),b=new QueryObserver(client,{queryKey:['job','live'],queryFn:async()=>({progress:++live}),...workspaceQueryFreshness('live',true)});
 const stopA=a.subscribe(()=>{}),stopB=b.subscribe(()=>{});
 try{await a.refetch();await b.refetch();const countFixed=fixed,countLive=live;for(let i=0;i<5;i++)await client.invalidateQueries();expect(fixed).toBe(countFixed);expect(live).toBe(countLive+5);expect(a.getCurrentResult().data).toEqual({revision:1});}finally{stopA();stopB();client.clear();}
});
