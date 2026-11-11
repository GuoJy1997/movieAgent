import {createServer} from 'vite';
import {resolve} from 'node:path';
import {readFileSync} from 'node:fs';
const server=await createServer({configFile:false,root:process.cwd(),cacheDir:resolve('node_modules/.vite-yangfan-preview'),esbuild:{jsx:'automatic'},server:{host:'127.0.0.1',port:4175,strictPort:true},plugins:[{name:'yangfan-isolated-preview',enforce:'pre',resolveId(id){if(id.endsWith('/runtime.tsx'))return resolve('tests/fixtures/p4-renderer/runtime.ts');},configureServer(vite){
 vite.middlewares.use('/qa-media/',(req,res)=>{const name=(req.url??'').split('?')[0].replace(/^\//,'');if(!['scooter.png','linxia.png','coast.png','poster-weekend.png','poster-sea.png','poster-city.png','poster-wind.png','episode-sunset.png','episode-plan.png'].includes(name)){res.statusCode=404;res.end();return;}res.setHeader('Content-Type','image/png');res.end(readFileSync(resolve('../verification/2026-11-07-spec005-ui/media',name)));});

 vite.middlewares.use('/qa-posters/',(req,res)=>{
  const name=(req.url??'').split('?')[0].replace(/^\//,'');
  if(!['poster-weekend.png','poster-sea.png','poster-city.png','poster-wind.png','poster-weekend-v2.png','poster-sea-v2.png','poster-city-v2.png'].includes(name)){res.statusCode=404;res.end();return;}
  res.setHeader('Content-Type','image/png');
  res.end(readFileSync(resolve('../output/yangfan-posters-hd-2026-11-08',name)));
 });

 vite.middlewares.use('/yangfan-preview',(_req,res)=>{res.setHeader('Content-Type','text/html');res.end('<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/><title>羊番TV · 隔离 UI 验证</title></head><body><div id="root"></div><script type="module" src="/tests/fixtures/p4-renderer/yangfan-preview.ts"></script></body></html>');});
}}]});await server.listen();console.log('Isolated UI: http://127.0.0.1:4175/yangfan-preview');