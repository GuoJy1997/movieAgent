// A local, read-only server for this design study. No dependency install required.
const http=require('node:http');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname);
const types={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'application/javascript; charset=utf-8','.json':'application/json; charset=utf-8','.md':'text/plain; charset=utf-8','.jpg':'image/jpeg','.png':'image/png'};
const server=http.createServer((req,res)=>{if(!['GET','HEAD'].includes(req.method)){res.writeHead(405);res.end();return;}let pathname;try{pathname=decodeURIComponent(new URL(req.url,'http://127.0.0.1').pathname);}catch{res.writeHead(400);res.end();return;}const file=path.resolve(root,'.'+(pathname==='/'?'/index.html':pathname));if(file!==root&&!file.startsWith(root+path.sep)){res.writeHead(403);res.end();return;}const ext=path.extname(file);if(!Object.hasOwn(types,ext)){res.writeHead(404);res.end();return;}fs.stat(file,(err,stat)=>{if(err||!stat.isFile()){res.writeHead(404);res.end();return;}res.writeHead(200,{'Content-Type':types[ext],'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self'; connect-src 'none'; object-src 'none'; frame-ancestors 'self'; form-action 'none'"});if(req.method==='HEAD'){res.end();return;}fs.createReadStream(file).pipe(res);});});
server.listen(5171,'127.0.0.1',()=>console.log('Design study: http://127.0.0.1:5171/'));
