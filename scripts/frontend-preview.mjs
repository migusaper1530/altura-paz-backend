import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve,extname,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../public/',import.meta.url));
const port=Number(process.env.FRONTEND_PORT||8090);
const types={'.html':'text/html; charset=utf-8','.css':'text/css','.mjs':'application/javascript','.js':'application/javascript','.svg':'image/svg+xml','.webp':'image/webp','.png':'image/png','.woff2':'font/woff2'};
const server=createServer(async(req,res)=>{
  try {
    const url=new URL(req.url,'http://localhost');
    if(url.pathname.startsWith('/api/')){
      res.writeHead(503,{'Content-Type':'application/json'});res.end(JSON.stringify({error:'Esta vista previa muestra el diseño. Inicia Docker para usar la API real.'}));return;
    }
    const path=resolve(root,'.'+decodeURIComponent(url.pathname==='/'?'/index.html':url.pathname));
    if(!path.startsWith(resolve(root)+sep)||!types[extname(path)])throw new Error('not found');
    const body=await readFile(path);res.writeHead(200,{'Content-Type':types[extname(path)],'Referrer-Policy':'strict-origin-when-cross-origin','X-Content-Type-Options':'nosniff'});res.end(body);
  }catch{res.writeHead(404,{'Content-Type':'text/plain; charset=utf-8'});res.end('No encontrado');}
});
server.listen(port,'127.0.0.1',()=>console.log(`Vista de diseño: http://localhost:${port}/?demo=1\nSin datos de ejemplo: http://localhost:${port}/\nCtrl+C para detener.`));
