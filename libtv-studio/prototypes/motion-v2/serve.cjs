const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const root = __dirname;
const mime = {'.html':'text/html; charset=utf-8','.js':'application/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.png':'image/png','.jpg':'image/jpeg','.svg':'image/svg+xml'};
const server = http.createServer((request,response)=>{
  let pathname;
  try {pathname=decodeURIComponent(new URL(request.url,'http://127.0.0.1').pathname);} catch {response.writeHead(400).end();return;}
  const file = path.resolve(root, '.' + (pathname==='/'?'/index.html':pathname));
  if(!file.startsWith(root+path.sep)){response.writeHead(403).end();return;}
  if(!['GET','HEAD'].includes(request.method)){response.writeHead(405).end();return;}
  fs.stat(file,(error,stat)=>{
    if(error||!stat.isFile()){response.writeHead(404).end();return;}
    response.writeHead(200,{'Content-Type':mime[path.extname(file)]||'application/octet-stream','Content-Length':stat.size,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
    if(request.method==='HEAD'){response.end();return;}
    const stream=fs.createReadStream(file);stream.on('error',()=>response.destroy());stream.pipe(response);
  });
});
server.listen(5167,'127.0.0.1',()=>process.stdout.write('Motion preview ready at http://127.0.0.1:5167\n'));
