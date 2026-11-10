import test from 'node:test';
import assert from 'node:assert/strict';
import {escapeHtml, distance, duration, elevation, lineSegments, selectRoutes, sampleRoutes} from '../public/ui.mjs';
test('contenido de usuarios se puede insertar como texto sin abrir etiquetas o atributos',()=>{
 const payload='<img src=x onerror="alert(1)"> & \' onclick=\'bad';
 const escaped=escapeHtml(payload);
 assert(!escaped.includes('<'));assert(!escaped.includes('>'));assert(!escaped.includes('"'));assert(!escaped.includes("'"));
 assert(escaped.includes('&lt;img'));assert.equal(escapeHtml(null),'');
});
test('las métricas distinguen datos ausentes de ascenso cero y horas completas',()=>{
 assert.equal(elevation(null),'Sin datos');assert.equal(elevation(0),'0 m');
 assert.equal(distance(undefined),'Sin datos');assert.match(distance(3200),/3[,.]2 km/);
 assert.equal(duration(60),'1 h');assert.equal(duration(95),'1 h 35 min');assert.equal(duration(0),'0 min');
});
test('las búsquedas admiten tildes y los filtros y orden no modifican el catálogo',()=>{
 const source=structuredClone(sampleRoutes);const first=source[0].id;
 assert.equal(selectRoutes(source,{query:'CORDILLERA',difficulty:'hard'}).length,1);
 assert.equal(selectRoutes([{name:'Cañón',difficulty:'easy'}],{query:'canon'}).length,1);
 const ordered=selectRoutes(source,{sort:'long'});assert.equal(ordered[0].distance_m,9400);assert.equal(source[0].id,first);
 assert.equal(selectRoutes(source,{query:'no existe'}).length,0);
});
test('los segmentos GPX se mantienen separados y las coordenadas inválidas no se trazan',()=>{
 const result=lineSegments({type:'MultiLineString',coordinates:[[[ -68,-16],[-68.1,-16.1]],[[ -68.2,-16.2],[-68.3,-16.3]],[[999,0]],null]});
 assert.equal(result.length,2);assert.deepEqual(result[0],[[-16,-68],[-16.1,-68.1]]);
 assert.deepEqual(lineSegments({type:'Point',coordinates:[0,0]}),[]);
 assert.deepEqual(lineSegments({type:'LineString',coordinates:[[0,0],[1,1]]}),[[[0,0],[1,1]]]);
});
