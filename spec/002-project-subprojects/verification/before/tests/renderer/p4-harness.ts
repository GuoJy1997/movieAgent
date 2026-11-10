import { chromium, type Browser, type Page } from '@playwright/test';
import { createServer } from 'vite';
import { resolve } from 'node:path';
import type {} from '../fixtures/p4-renderer/main.tsx';
export const timeline = { libraryId:'library',projectId:'project',id:'timeline-a',revision:1,scriptRef:{id:'script',revision:1},title:'剪辑 A',timebase:48000 as const,fps:{num:30 as const,den:1 as const},canvas:{width:1920 as const,height:1080 as const},videoClips:[{id:'clip-a',kind:'image' as const,media:{kind:'assetVersion' as const,libraryId:'library',assetId:'picture',version:1},sourceHash:'a'.repeat(64),sourceProbeId:null,sourceInTicks:0,startTicks:0,durationTicks:240000,fit:'contain' as const,gainMilli:1000,mute:true}],audioClips:[],subtitleCues:[],subtitleStyle:{fontId:'noto-sans-cjk-sc' as const,fontSize:48,color:'#ffffff',bottomMargin:60,outline:2},createdAt:'2026-10-27T00:00:00Z' };
export function queries() { return {
  'timeline.list':{libraryId:'library',projectId:'project',timelines:[timeline,{...timeline,id:'timeline-b',title:'剪辑 B'}]},
  'timeline.read:timeline-a':timeline,'timeline.read:timeline-b':{...timeline,id:'timeline-b',title:'剪辑 B'},
  'timeline.history':{revisions:[timeline]},'creation.read':{scripts:[{id:'script',revision:1,title:'剧本'}],shots:[],selections:[]},
  'asset.search':{assets:[]},'audio.read':{voiceLines:[],takes:[],transcripts:[],diagnostics:[]},'profile.list':{profiles:[]},'model.list':{models:[]},'task.list':{tasks:[]},'render.list':{jobs:[]},'timeline.exports':{exports:[]},
}; }
export async function harness() {
  const server = await createServer({configFile:false,root:process.cwd(),esbuild:{jsx:'automatic'},server:{host:'127.0.0.1',port:0},optimizeDeps:{include:['react','react-dom','react-dom/client','react/jsx-dev-runtime','@tanstack/react-query','@xyflow/react','zustand'],entries:['tests/fixtures/p4-renderer/main.tsx']},plugins:[{name:'p4-fixture',enforce:'pre',resolveId(id){if(id.endsWith('/runtime.tsx')) return resolve('tests/fixtures/p4-renderer/runtime.ts');},configureServer(vite){vite.middlewares.use('/p4-fixture',(_req,res)=>{res.setHeader('Content-Type','text/html');res.end('<div id="root"></div><script type="module" src="/tests/fixtures/p4-renderer/main.tsx"></script>');});}}]});
  server.middlewares.use('/fixture-proxy.wav',(_req,res)=>{const wave=Buffer.alloc(44+96000);wave.write('RIFF');wave.writeUInt32LE(wave.length-8,4);wave.write('WAVEfmt ',8);wave.writeUInt32LE(16,16);wave.writeUInt16LE(1,20);wave.writeUInt16LE(1,22);wave.writeUInt32LE(48000,24);wave.writeUInt32LE(96000,28);wave.writeUInt16LE(2,32);wave.writeUInt16LE(16,34);wave.write('data',36);wave.writeUInt32LE(96000,40);res.setHeader('Content-Type','audio/wav');res.end(wave);});
  await server.listen();
  await server.warmupRequest('/tests/fixtures/p4-renderer/main.tsx');
  await server.waitForRequestsIdle();
  const addr=server.httpServer!.address();
  const browser=await chromium.launch({headless:true,executablePath:process.env.MOVIEAGENT_TEST_CHROMIUM});
  const address=`http://127.0.0.1:${typeof addr==='object'&&addr?addr.port:0}/p4-fixture`;
  // Warm the complete browser-imported graph before per-interaction deadlines.
  const readiness=await browser.newPage();await readiness.goto(address);await readiness.waitForFunction(()=>!!window.p4Fixture);await readiness.close();
  return {server,browser,address};
}
export async function mounted(h: {browser:Browser;address:string}, run:(page:Page)=>Promise<void>,data:Record<string,unknown>=queries()) {
  const page=await h.browser.newPage({viewport:{width:1100,height:850}}); page.setDefaultTimeout(3000);
  await page.clock.install();
  await page.route('**/fixture-waveform.json?*',route=>{const id=new URL(route.request().url()).searchParams.get('id')!;const body=(data.__waveforms as Record<string,unknown>)[id];return route.fulfill({contentType:'application/json',body:JSON.stringify(body)});});
  await page.route('**/fixture-proxy.wav?*',route=>{const wave=Buffer.alloc(44+96000);wave.write('RIFF');wave.writeUInt32LE(wave.length-8,4);wave.write('WAVEfmt ',8);wave.writeUInt32LE(16,16);wave.writeUInt16LE(1,20);wave.writeUInt16LE(1,22);wave.writeUInt32LE(48000,24);wave.writeUInt32LE(96000,28);wave.writeUInt16LE(2,32);wave.writeUInt16LE(16,34);wave.write('data',36);wave.writeUInt32LE(96000,40);return route.fulfill({contentType:'audio/wav',body:wave});});
  const errors:string[]=[],posts:string[]=[];page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(r.method()==='POST')posts.push(r.url());});
  try {await page.goto(h.address);await page.waitForFunction(()=>!!window.p4Fixture);await page.evaluate(data=>window.p4Fixture.mount(data),data);await run(page);if(errors.length)throw Error(errors.join(';'));if(posts.length)throw Error('Unexpected POST '+posts.join(';'));}finally{await page.close();}
}
export async function calls(page:Page,n:number){await page.waitForFunction(n=>window.p4Fixture.calls.length===n,n);}
