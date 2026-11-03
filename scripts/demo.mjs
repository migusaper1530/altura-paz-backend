import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
const base=process.env.API_URL||'http://localhost:8088';const tag=randomUUID().slice(0,8),password='Demo-passphrase-12345';
const evidence=[];
async function request(label,method,path,body,token){
  const r=await fetch(base+path,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:body===undefined?undefined:JSON.stringify(body)});
  const result=await r.json();if(!r.ok)throw new Error(label+': '+JSON.stringify(result));
  evidence.push({step:label,status:r.status,path});console.log('✓ '+label);return result;
}
console.log('Altura Paz · demostración con datos sintéticos. GPX ilustrativo; no navegar.');
let ready=false;
for(let i=0;i<50;i++){
  try {const a=await fetch(base+'/api/routes');const b=await fetch(base+'/api/users/00000000-0000-4000-8000-000000000000');if(a.status===200&&b.status===404){ready=true;break;}}
  catch{}
  await new Promise(r=>setTimeout(r,1000));
}
if(!ready)throw new Error('La API no está lista; revisa docker compose logs');
const a=await request('Crear cuenta autora','POST','/api/auth/register',{email:`autora-${tag}@example.test`,name:'Autora demo',password});
const b=await request('Crear cuenta visitante','POST','/api/auth/register',{email:`visitante-${tag}@example.test`,name:'Senderista demo',password});
const route=await request('Importar GPX como borrador','POST','/api/routes/import-gpx',{name:'Palca · demostración '+tag,description:'Trazado sintético. Sirve para demostrar el sistema; no utilizar para navegar.',difficulty:'moderate',gpx_content:readFileSync('examples/palca-ilustrativo.gpx','utf8')},a.access_token);
await request('Publicar ruta','POST',`/api/routes/${route.id}/publish`,undefined,a.access_token);
const v=await request('Registrar visita autenticada','POST',`/api/routes/${route.id}/visits`,undefined,b.access_token);assert.equal(v.views,1);
const today=new Date(Date.now()-4*3600000).toISOString().slice(0,10);
await request('Declarar finalización manual','POST',`/api/routes/${route.id}/completion`,{completed_on:today},b.access_token);
const repeated=await request('Repetir declaración sin duplicar personas','POST',`/api/routes/${route.id}/completion`,{completed_on:today},b.access_token);assert.equal(repeated.completed_people,1);
await request('Añadir comentario en un punto del trazado','POST',`/api/routes/${route.id}/comments`,{body:'Comentario de demostración asociado al inicio.',location:[-67.956,-16.557]},b.access_token);
await request('Publicar reporte sin verificación previa','POST',`/api/routes/${route.id}/reports`,{category:'obstacle',body:'Piedras sueltas: reporte sintético para la demostración.',location:[-67.956,-16.557]},b.access_token);
let audit;
for(let i=0;i<20;i++){const r=await fetch(`${base}/api/routes/${route.id}/audit`);audit=await r.json();if(audit.anchor_status==='matches_recorded_proof')break;await new Promise(r=>setTimeout(r,1000));}
assert.equal(audit.anchor_status,'matches_recorded_proof','No se confirmó el registro blockchain a tiempo');
const receipt=audit.proofs[0];const live=await request('Consultar la prueba directamente en la EVM local','GET','/api/proofs/'+receipt.proof_id);
assert.equal(live.digest,audit.current_digest);assert.equal(live.chain_id,31337);
evidence.push({step:'Huella verificada en EVM local',route_id:route.id,version:route.version,chain_id:live.chain_id,contract_address:live.contract_address,transaction_hash:receipt.transaction_hash,digest:live.digest,distance_m:route.distance_m,ascent_m:route.ascent_m,estimated_minutes:route.estimated_minutes,completed_people:1});
mkdirSync('evidence',{recursive:true});writeFileSync('evidence/demo-result.json',JSON.stringify({run_at:new Date().toISOString(),kind:'synthetic_local_demo',steps:evidence},null,2));
console.log('\nRuta pública de la demo: '+base+'/api/routes/'+route.id);console.log('Recibo y resultados: evidence/demo-result.json');console.log('La red usada es local. No se ha desplegado en Sepolia.');
