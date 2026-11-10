export const difficultyNames = { easy: 'Fácil', moderate: 'Moderada', hard: 'Exigente' };
export const roleNames = { tourist: 'Cliente / turista', guide: 'Guía', organization: 'Empresa / grupo', admin: 'Administrador' };
export const statusNames = { unknown: 'Estado sin confirmar', open: 'Abierto', caution: 'Precaución', closed: 'Cerrado' };
export const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
export const distance = meters => Number.isFinite(Number(meters)) && meters != null ? (Number(meters) / 1000).toLocaleString('es-BO', { maximumFractionDigits: 1 }) + ' km' : 'Sin datos';
export function duration(minutes) {
  if (minutes == null || !Number.isFinite(Number(minutes))) return 'Sin datos';
  const value = Math.round(Number(minutes));
  return value < 60 ? `${value} min` : `${Math.floor(value / 60)} h${value % 60 ? ` ${value % 60} min` : ''}`;
}
export const elevation = meters => meters == null || !Number.isFinite(Number(meters)) ? 'Sin datos' : Math.round(meters).toLocaleString('es-BO') + ' m';
export const today = () => new Date(Date.now() - 4 * 3600000).toISOString().slice(0, 10);
export function lineSegments(geometry) {
  const lines = geometry?.type === 'MultiLineString' ? geometry.coordinates : geometry?.type === 'LineString' ? [geometry.coordinates] : [];
  if (!Array.isArray(lines)) return [];
  return lines.filter(Array.isArray).map(line => line.filter(c => Array.isArray(c) && Number.isFinite(c[0]) && Number.isFinite(c[1]) && Math.abs(c[0]) <= 180 && Math.abs(c[1]) <= 90).map(c => [c[1], c[0]])).filter(line => line.length >= 2);
}
export function selectRoutes(routes, { query = '', difficulty = '', sort = 'recent' } = {}) {
  const normalize = value => String(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const selected = routes.filter(r => (!difficulty || r.difficulty === difficulty) && normalize(r.name).includes(normalize(query)));
  if (sort === 'short') selected.sort((a, b) => a.distance_m - b.distance_m);
  if (sort === 'long') selected.sort((a, b) => b.distance_m - a.distance_m);
  return selected;
}
export const sampleRoutes = [
  { id: 'example-luna', name: 'Sendero del Valle de la Luna', difficulty: 'easy', distance_m: 3200, estimated_minutes: 70, ascent_m: 120, completed_people: 0, views: 0, trail_status: 'unknown', place: 'Mallasa, al sur de La Paz', photo: '/assets/valle-luna.webp', credit: 'Valle de la Luna · EEJCC · CC BY-SA 4.0', description: 'Una propuesta visual para explorar el paisaje de Mallasa. Este recorrido y sus métricas son ejemplos de diseño, no una ruta verificada.', geometry: { type: 'MultiLineString', coordinates: [[[-68.097,-16.564],[-68.095,-16.563],[-68.092,-16.564],[-68.09,-16.562],[-68.088,-16.561],[-68.087,-16.558],[-68.085,-16.557]]] } },
  { id: 'example-palca', name: 'Miradores de Palca', difficulty: 'moderate', distance_m: 7800, estimated_minutes: 180, ascent_m: 340, completed_people: 0, views: 0, trail_status: 'unknown', place: 'Palca, alrededores de La Paz', description: 'Una ficha de ejemplo para mostrar distancia, desnivel y recorrido. Las coordenadas son ilustrativas y no deben utilizarse para navegar.', geometry: { type: 'MultiLineString', coordinates: [[[-67.97,-16.56],[-67.966,-16.555],[-67.96,-16.552],[-67.954,-16.548],[-67.95,-16.542],[-67.943,-16.54],[-67.936,-16.535]]] } },
  { id: 'example-cordillera', name: 'Una mirada a la Cordillera Real', difficulty: 'hard', distance_m: 9400, estimated_minutes: 270, ascent_m: 680, completed_people: 0, views: 0, trail_status: 'unknown', place: 'Cordillera Real, La Paz', photo: '/assets/huayna-potosi.webp', credit: 'Huayna Potosí · Das Morton · CC BY-SA 4.0', description: 'Ejemplo de una ficha de ruta exigente. La fotografía ilustra el entorno del Huayna Potosí; no documenta este trazado. Las cifras y el recorrido son sintéticos.', geometry: { type: 'MultiLineString', coordinates: [[[-68.161,-16.348],[-68.155,-16.342],[-68.15,-16.336],[-68.146,-16.33],[-68.138,-16.326],[-68.133,-16.32],[-68.128,-16.315]]] } },
  { id: 'example-mallasa', name: 'Un paseo por Mallasa', difficulty: 'easy', distance_m: 4600, estimated_minutes: 95, ascent_m: 160, completed_people: 0, views: 0, trail_status: 'unknown', place: 'Mallasa, La Paz', description: 'Otro ejemplo para comparar opciones en la lista y el mapa. La información es únicamente ilustrativa.', geometry: { type: 'MultiLineString', coordinates: [[[-68.089,-16.576],[-68.087,-16.573],[-68.083,-16.57],[-68.08,-16.567],[-68.078,-16.564],[-68.075,-16.56]]] } },
].map(r => ({ ...r, state: 'published', version: 1, warnings: 'Datos de ejemplo. No utilizar para navegar.', author_id: 'example', created_at: '2026-11-10T12:00:00Z' }));
