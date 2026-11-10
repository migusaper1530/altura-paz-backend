import {createServer,request as upstreamRequest} from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve,extname,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
export function createFrontendServer({backend='http://127.0.0.1:8088'}={}) {
  const upstream=new URL(backend);
  if(upstream.protocol!=='http:' || !['localhost','127.0.0.1','[::1]'].includes(upstream.hostname) || upstream.username || upstream.password)throw new Error('El backend de desarrollo debe ser HTTP local.');
  const root=fileURLToPath(new URL('../public/',import.meta.url));
  const types={'.html':'text/html; charset=utf-8','.css':'text/css','.mjs':'application/javascript','.js':'application/javascript','.svg':'image/svg+xml','.webp':'image/webp','.png':'image/png','.woff2':'font/woff2'};
  return createServer(async(req,res)=>{
    try {
      const url=new URL(req.url,'http://localhost');
      if(url.pathname.startsWith('/api/')){
        const headers={};for(const key of ['content-type','authorization','accept'])if(req.headers[key])headers[key]=req.headers[key];
        const proxy=upstreamRequest({hostname:upstream.hostname,port:upstream.port||80,path:url.pathname+url.search,method:req.method,headers},response=>{
          res.writeHead(response.statusCode||502,response.headers);response.pipe(res);
        });
        proxy.setTimeout(40000,()=>proxy.destroy(new Error('Tiempo de espera agotado')));
        proxy.on('error',()=>{if(!res.headersSent){res.writeHead(503,{'Content-Type':'application/json'});res.end(JSON.stringify({error:'No se pudo conectar con el backend local. Arranca los servicios de Altura Paz e inténtalo de nuevo.'}));}else res.destroy();});
        req.on('aborted',()=>proxy.destroy());req.pipe(proxy);return;
      }
      const path=resolve(root,'.'+decodeURIComponent(url.pathname==='/'?'/index.html':url.pathname));
      if(!path.startsWith(resolve(root)+sep)||!types[extname(path)])throw new Error('not found');
      const body=await readFile(path);res.writeHead(200,{'Content-Type':types[extname(path)],'Referrer-Policy':'strict-origin-when-cross-origin','X-Content-Type-Options':'nosniff'});res.end(body);
    }catch{res.writeHead(404,{'Content-Type':'text/plain; charset=utf-8'});res.end('No encontrado');}
  });
}
if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const port=Number(process.env.FRONTEND_PORT||8090);
  createFrontendServer({backend:process.env.BACKEND_URL||'http://127.0.0.1:8088'}).listen(port,'127.0.0.1',()=>console.log(`Sitio conectado al backend: http://localhost:${port}/\nVista de diseño opcional: http://localhost:${port}/?demo=1\nCtrl+C para detener.`));
}
