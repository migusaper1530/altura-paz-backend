import { escapeHtml as esc, distance, duration, elevation, today, lineSegments, selectRoutes, sampleRoutes, difficultyNames, roleNames, statusNames } from './ui.mjs';
const $ = selector => document.querySelector(selector);
const state = { demo: new URLSearchParams(location.search).get('demo') === '1', routes: [], selected: null, token: null, user: null, view: 'explore', difficulty: '', query: '', sort: 'recent', offset: 0, more: false, layers: new Map(), generation: 0, completed: new Set() };
let map, routeLayer, locationMarker, toastTimer, sessionTimer;
const mountain = '<svg viewBox="0 0 60 50" aria-hidden="true"><path d="M4 43 24 7l28 36H4Zm15-27 6 9 7-8M30 43l9-16"/></svg>';
const badge = route => `<span class="badge ${esc(route.difficulty)}">${esc(difficultyNames[route.difficulty] || 'Sin dificultad')}</span>`;
const metric = route => `<span><strong>${distance(route.distance_m)}</strong></span><span class="metric-separator"></span><span>${duration(route.estimated_minutes)}</span><span class="metric-separator"></span><span>↗ ${elevation(route.ascent_m)}</span>`;
function toast(message, error = false) { clearTimeout(toastTimer); const t = $('#toast'); t.textContent = message; t.classList.toggle('error', error); t.hidden = false; toastTimer = setTimeout(() => { t.hidden = true; }, 5500); }
function clearSession() { state.token = null; state.user = null; state.completed.clear(); clearTimeout(sessionTimer); $('#account-button').textContent = 'Ingresar ↗'; $('#admin-nav').hidden = true; }
async function api(path, options = {}) {
  if (state.demo) throw new Error('Estás viendo el diseño. Abre las rutas reales para usar tu cuenta.');
  const response = await fetch('/api' + path, { ...options, headers: { 'Content-Type': 'application/json', ...(state.token ? { Authorization: 'Bearer ' + state.token } : {}), ...options.headers }, body: options.body === undefined ? undefined : JSON.stringify(options.body) });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401 && state.token) { clearSession(); toast('Tu sesión terminó. Vuelve a ingresar.', true); }
    let message = payload.error?.message || payload.error || 'No se pudo completar la solicitud.';
    if (Array.isArray(message)) message = message.map(item => `${item.path ? item.path + ': ' : ''}${item.message || item}`).join('\n');
    if (typeof message === 'object') message = message.message || 'Revisa los datos e inténtalo otra vez.';
    if (response.status === 503) message = 'Los servicios están apagados o no responden. Inicia el backend e inténtalo de nuevo.';
    if (response.status === 429) message = 'Has hecho varias solicitudes. Espera un minuto e inténtalo otra vez.';
    throw new Error(message);
  }
  return payload;
}
function modal(title, content, kicker = '') { $('#modal-title').textContent = title; $('#modal-kicker').textContent = kicker; $('#modal-body').innerHTML = content; if (!$('#modal').open) $('#modal').showModal(); }
function errorBox(form, error) { const node = form.querySelector('.form-error'); node.textContent = error.message || String(error); node.hidden = false; }
function formTask(selector, handler) {
  const form = $(selector);
  form?.addEventListener('submit', async event => {
    event.preventDefault(); const button = form.querySelector('[type=submit]'); const text = button.textContent;
    button.disabled = true; button.textContent = 'Un momento…'; form.querySelector('.form-error').hidden = true;
    try { await handler(Object.fromEntries(new FormData(form)), form); } catch (error) { errorBox(form, error); }
    finally { if (button.isConnected) { button.disabled = false; button.textContent = text; } }
  });
}
const errorMarkup = '<div class="form-error" role="alert" hidden></div>';
function initMap() {
  if (!globalThis.L) { $('#map-message').textContent = 'El mapa no está disponible. Puedes explorar las rutas desde la lista.'; $('#map-message').hidden = false; return; }
  map = L.map('map', { zoomControl: false, minZoom: 7, maxZoom: 19 }).setView([-16.49, -68.07], 11);
  L.control.zoom({ position: 'topright' }).addTo(map);
  L.control.scale({ imperial: false, position: 'bottomleft' }).addTo(map);
  const tiles = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors' }).addTo(map);
  let failed = 0;
  tiles.on('tileerror', () => { if (++failed > 3) { $('#map-message').textContent = 'No se pudo cargar la cartografía. Revisa tu conexión; los trazados y la lista siguen disponibles.'; $('#map-message').hidden = false; } });
  tiles.on('tileload', () => { if (failed) { failed = 0; $('#map-message').hidden = true; } });
  routeLayer = L.featureGroup().addTo(map);
}
function drawRoutes(items, fit = true) {
  if (!map) return;
  routeLayer.clearLayers(); state.layers.clear();
  items.forEach((route, index) => {
    const segments = lineSegments(route.geometry); if (!segments.length) return;
    const white = L.polyline(segments, { color: 'white', weight: 8, opacity: .9 }).addTo(routeLayer);
    const line = L.polyline(segments, { color: '#2c6750', weight: 4, opacity: .85 }).addTo(routeLayer);
    const marker = L.marker(segments[0][0], { icon: L.divIcon({ className: 'route-pin', html: String(index + 1), iconSize: [32, 32], iconAnchor: [16, 16] }), title: route.name, keyboard: true }).addTo(routeLayer);
    marker.on('click', () => selectRoute(route.id)); line.on('click', () => selectRoute(route.id));
    const end = segments.at(-1).at(-1); L.marker(end, { icon: L.divIcon({ className: 'route-end', iconSize: [12, 12], iconAnchor: [6, 6] }), interactive: false }).addTo(routeLayer);
    state.layers.set(route.id, { line, marker, white });
  });
  if (fit) fitMap();
}
function fitMap() { if (map && routeLayer.getBounds().isValid()) map.fitBounds(routeLayer.getBounds(), { padding: [65, 70], maxZoom: 14, animate: false }); }
function renderRoutes() {
  const items = selectRoutes(state.routes, { query: state.query, difficulty: state.difficulty, sort: state.sort });
  $('#result-count').textContent = `${items.length}${state.more ? '+' : ''} ${items.length === 1 ? 'ruta' : 'rutas'} ${state.demo ? 'de ejemplo' : 'publicadas'}`;
  $('#route-list').innerHTML = items.length ? items.map(route => `<button class="route-card ${route.id === state.selected ? 'selected' : ''}" data-route="${esc(route.id)}" aria-label="Ver ${esc(route.name)}" aria-pressed="${route.id === state.selected}">${route.photo ? `<img class="route-thumbnail" src="${esc(route.photo)}" alt="" loading="lazy">` : `<div class="route-placeholder">${mountain}</div>`}<div class="route-summary">${badge(route)}<h3>${esc(route.name)}</h3><p class="route-location">${esc(route.place || 'La Paz y alrededores')}</p><div class="metrics">${metric(route)}</div></div><span class="card-open" aria-hidden="true">›</span></button>`).join('') : '<div class="empty"><div class="mountain-empty">⌁</div><h3>Aquí empieza otro camino.</h3><p>No hay rutas con estos filtros. Prueba otra búsqueda o comparte tu primer GPX.</p><button class="button secondary" data-action="reset">Quitar filtros</button><button class="text-button" data-action="import">Importar una ruta</button></div>';
  if (!items.some(r => r.id === state.selected)) { state.selected = null; $('#map-card').hidden = true; }
  $('#load-more').hidden = state.demo || !state.more;
  drawRoutes(items);
}
async function loadRoutes(append = false) {
  const generation = ++state.generation;
  $('#status-banner').hidden = true;
  if (state.demo) { state.routes = sampleRoutes; renderRoutes(); return; }
  if (!append) { state.offset = 0; $('#route-list').innerHTML = '<div class="empty"><p>Buscando caminos…</p></div>'; }
  try {
    const query = new URLSearchParams({ limit: '20', offset: String(state.offset) });
    if (state.query) query.set('q', state.query); if (state.difficulty) query.set('difficulty', state.difficulty);
    const result = await api('/routes?' + query); if (generation !== state.generation || state.view !== 'explore') return;
    state.routes = append ? [...state.routes, ...result.items] : result.items; state.more = result.items.length === 20; renderRoutes();
  } catch (error) {
    if (generation !== state.generation || state.view !== 'explore') return;
    state.routes = []; state.more = false; $('#result-count').textContent = 'Sin conexión con las rutas';
    $('#route-list').innerHTML = `<div class="empty"><div class="mountain-empty">⌁</div><h3>El camino sigue aquí.</h3><p>${esc(error.message)}</p><button class="button primary" data-action="retry">Volver a intentar</button><p><a class="text-button" href="/?demo=1">Explorar el diseño con rutas de ejemplo</a></p></div>`;
  }
}
async function selectRoute(id) {
  let route = state.routes.find(r => r.id === id); if (!route) return;
  state.selected = id;
  document.querySelectorAll('[data-route]').forEach(el => { el.classList.toggle('selected', el.dataset.route === id); el.setAttribute('aria-pressed', String(el.dataset.route === id)); });
  for (const [key, layer] of state.layers) { layer.line.setStyle({ color: key === id ? '#173e32' : '#648c64', weight: key === id ? 5 : 3, opacity: key === id ? 1 : .7 }); layer.marker.getElement()?.classList.toggle('active', key === id); }
  const layer = state.layers.get(id); if (layer && map) { layer.line.bringToFront(); layer.marker.setZIndexOffset(1000); map.fitBounds(layer.line.getBounds(), { paddingTopLeft: [45, 90], paddingBottomRight: [60, 310], maxZoom: 14, animate: false }); }
  $('#map-card').innerHTML = `${route.photo ? `<img class="map-card-photo" src="${esc(route.photo)}" alt="Paisaje de referencia; créditos en la ficha">` : ''}<button class="map-card-close" data-action="unselect" aria-label="Cerrar ficha">✕</button><div class="map-card-body">${badge(route)}<h2>${esc(route.name)}</h2><p>${esc(route.place || 'Ruta compartida en La Paz')}</p><div class="metrics"><span><strong>${distance(route.distance_m)}</strong>Distancia</span><span><strong>${duration(route.estimated_minutes)}</strong>Tiempo estimado</span><span><strong>${elevation(route.ascent_m)}</strong>Ascenso</span></div><button class="button primary full" data-detail="${esc(id)}">Explorar esta ruta <span aria-hidden="true">↗</span></button></div>`;
  $('#map-card').hidden = false;
  if (matchMedia('(max-width:760px)').matches) showDetail(route);
}
async function showDetail(route) {
  modal(route.name, '<p class="muted">Abriendo el recorrido…</p>', state.demo ? 'Ruta de ejemplo' : 'El recorrido');
  try {
    if (!state.demo) route = await api('/routes/' + encodeURIComponent(route.id));
    if (!state.demo && state.user) api(`/routes/${route.id}/visits`, { method: 'POST' }).catch(() => {});
    const own = state.user?.id === route.author_id;
    $('#modal-body').innerHTML = `${route.photo ? `<img class="detail-cover" src="${esc(route.photo)}" alt="Paisaje de referencia"><p class="detail-caption">${esc(route.credit)}</p>` : ''}<div>${badge(route)} <span class="badge neutral">${esc(statusNames[route.trail_status] || 'Estado sin confirmar')}</span>${route.state === 'draft' ? ' <span class="badge neutral">Borrador</span>' : ''}</div><div class="detail-metrics"><div><strong>${distance(route.distance_m)}</strong><small>Distancia</small></div><div><strong>${duration(route.estimated_minutes)}</strong><small>Tiempo estimado</small></div><div><strong>${elevation(route.ascent_m)}</strong><small>Ascenso acumulado</small></div></div><p class="detail-description">${esc(route.description)}</p>${route.warnings ? `<div class="callout"><strong>Antes de salir</strong><br>${esc(route.warnings)}</div>` : ''}<p class="form-help">${Number(route.completed_people) || 0} cuentas declaran haber completado esta ruta. Registro manual, sin verificación GPS. Revisa las condiciones y tu preparación antes de salir.</p><div class="detail-section"><div class="form-actions">${own ? `<button class="button secondary" data-edit="${esc(route.id)}">Editar ruta</button>${route.state === 'draft' ? `<button class="button primary" data-publish="${esc(route.id)}">Publicar ruta</button>` : ''}` : ''}${route.state === 'published' ? `<button class="button primary" data-complete="${esc(route.id)}">Registrar finalización</button>` : ''}</div></div><section class="detail-section"><h3>Fotografías del camino</h3><div id="route-photos"><p class="form-help">${state.demo ? 'Las fotos de ejemplo ilustran el paisaje; no documentan este trazado.' : 'Cargando fotografías…'}</p></div>${!state.demo && route.state === 'published' ? `<button class="text-button" data-photo="${esc(route.id)}">Añadir una fotografía</button>` : ''}</section><section class="detail-section"><h3>Lo que cuenta la comunidad</h3><div id="route-comments"><p class="form-help">${state.demo ? 'Los comentarios aparecerán aquí cuando las personas compartan su experiencia.' : 'Cargando comentarios…'}</p></div>${route.state === 'published' ? `<form id="comment-form" class="form-stack" style="margin-top:14px"><label class="field">Comparte tu experiencia<textarea name="body" required maxlength="2000" placeholder="¿Qué deberían saber quienes vengan después?"></textarea></label>${errorMarkup}<button class="button secondary" type="submit">Publicar comentario</button></form>` : ''}</section>`;
    formTask('#comment-form', async ({ body }) => { if (!requireUser()) return; await api(`/routes/${route.id}/comments`, { method: 'POST', body: { body } }); toast('Comentario publicado.'); showDetail(route); });
    if (!state.demo && route.state === 'published') {
      const [photos, comments] = await Promise.all([api(`/routes/${route.id}/photos`), api(`/routes/${route.id}/comments`)]);
      if (!$('#route-photos') || $('#modal-title').textContent !== route.name) return;
      $('#route-photos').innerHTML = photos.length ? `<div class="photo-grid">${photos.map(p => `<figure><img loading="lazy" src="${esc(p.url)}" alt="${esc(p.caption)}"><figcaption>${esc(p.caption)}</figcaption></figure>`).join('')}</div>` : '<p class="form-help">Todavía no hay fotografías. Comparte la primera.</p>';
      $('#route-comments').innerHTML = comments.length ? comments.map(c => `<div class="comment"><p>${esc(c.body)}</p><time>${esc(new Date(c.created_at).toLocaleDateString('es-BO'))}</time></div>`).join('') : '<p class="form-help">Sé la primera persona en compartir su experiencia.</p>';
    } else if (!state.demo) { $('#route-photos').textContent = 'Publica el borrador para añadir fotografías.'; $('#route-comments').textContent = 'Los comentarios estarán disponibles al publicar.'; }
  } catch (error) { $('#modal-body').innerHTML = `<div class="form-error">${esc(error.message)}</div>`; }
}
function requireUser() { if (state.demo) { toast('Esta es una vista de diseño. Abre las rutas reales para guardar cambios.', true); return false; } if (!state.user) { showAuth(); return false; } return true; }
function showAuth(register = false) {
  const demoHelp = state.demo ? '<div class="callout">Puedes revisar el formulario. Para crear una cuenta o ingresar, <a href="/">abre las rutas reales</a> con el backend encendido.</div>' : '';
  modal(register ? 'El camino es mejor compartido.' : 'Qué bueno verte de nuevo.', `${demoHelp}<form id="auth-form" class="form-stack">${register ? `<fieldset style="border:0;padding:0;margin:0"><legend class="field" style="margin-bottom:10px">¿Cómo quieres participar?</legend><div class="role-picker"><label class="role-option"><input type="radio" name="role" value="tourist" checked><strong>Turista</strong>Descubre y comparte</label><label class="role-option"><input type="radio" name="role" value="guide"><strong>Guía</strong>Comparte tu experiencia</label><label class="role-option"><input type="radio" name="role" value="organization"><strong>Empresa / grupo</strong>Camina en comunidad</label></div></fieldset><label class="field">Tu nombre<input name="name" required maxlength="100" autocomplete="name"></label><div id="role-fields"></div>` : ''}<label class="field">Correo electrónico<input type="email" name="email" required maxlength="254" autocomplete="email"></label><label class="field">Contraseña<input type="password" name="password" required minlength="${register ? 12 : 1}" maxlength="128" autocomplete="${register ? 'new-password' : 'current-password'}">${register ? '<small>Usa al menos 12 caracteres.</small>' : ''}</label>${errorMarkup}<button class="button primary full" type="submit">${register ? 'Crear mi cuenta' : 'Ingresar'}</button><p class="form-help">Las cuentas de administrador ingresan aquí con su correo y contraseña.</p></form><p class="auth-switch">${register ? '¿Ya tienes una cuenta?' : '¿Es tu primera visita?'} <button class="text-button" data-action="${register ? 'login' : 'register'}">${register ? 'Ingresar' : 'Crear una cuenta'}</button></p>`, 'Tu espacio en Altura Paz');
  $('#auth-form').addEventListener('change', event => {
    if (event.target.name !== 'role') return;
    $('#role-fields').innerHTML = event.target.value === 'guide' ? `<div class="form-stack"><label class="field">Cuéntanos sobre tu experiencia<textarea name="bio" required maxlength="2000"></textarea></label><label class="field">Referencia de tu acreditación<input name="credential_reference" required maxlength="200"><small>Esta referencia es privada. Administración revisará tu perfil antes de verificarlo.</small></label></div>` : event.target.value === 'organization' ? `<div class="form-stack"><label class="field">Nombre de la organización<input name="organization_name" required maxlength="150"></label><label class="field">Tipo<select name="organization_type"><option value="company">Empresa</option><option value="group">Grupo</option></select></label><label class="field">Descripción<textarea name="description" maxlength="2000"></textarea></label></div>` : '';
  });
  formTask('#auth-form', async body => {
    const session = await api(register ? '/auth/register' : '/auth/login', { method: 'POST', body });
    state.token = session.access_token;
    try { state.user = await api('/users/me'); } catch (error) { clearSession(); throw error; }
    $('#account-button').textContent = state.user.name.split(' ')[0] + ' ▾'; $('#admin-nav').hidden = state.user.role !== 'admin';
    clearTimeout(sessionTimer); sessionTimer = setTimeout(() => { clearSession(); toast('Tu sesión terminó. Vuelve a ingresar.'); }, session.expires_in * 1000);
    $('#modal').close(); toast('Ya estás dentro. Buen camino.'); if (state.view !== 'explore') showView(state.view);
  });
}
function showImport() {
  if (!state.demo && !requireUser()) return;
  modal('Comparte un nuevo camino.', `${state.demo ? '<div class="callout">Vista de diseño: puedes revisar el formulario y un archivo GPX. Para guardar la ruta necesitas ingresar con el backend conectado.</div>' : ''}<form id="import-form" class="form-stack"><label class="field">Tu archivo GPX<input type="file" name="gpx" id="gpx-file" accept=".gpx,application/gpx+xml,application/xml,text/xml" required><small>Hasta 5 MB. El trazado se importará como borrador antes de publicarse.</small></label><div id="gpx-preview" class="preview-strip" hidden></div><label class="field">Nombre de la ruta<input name="name" required maxlength="150" placeholder="Por ejemplo, Miradores de Palca"></label><label class="field">Descripción<textarea name="description" required maxlength="5000" placeholder="Describe el recorrido y lo que deberían saber otras personas."></textarea></label><div class="form-row"><label class="field">Dificultad<select name="difficulty"><option value="easy">Fácil</option><option value="moderate">Moderada</option><option value="hard">Exigente</option></select></label><label class="field">Estado del sendero<select name="trail_status"><option value="unknown">Sin confirmar</option><option value="open">Abierto</option><option value="caution">Precaución</option><option value="closed">Cerrado</option></select></label></div><label class="field">Advertencias<textarea name="warnings" maxlength="3000" placeholder="Accesos, obstáculos o condiciones que convenga conocer."></textarea></label>${errorMarkup}<button class="button primary" type="submit">Crear borrador</button><p class="form-help">Todas las rutas publicadas son públicas. No incluyas ubicaciones privadas o datos personales.</p></form>`, 'Tu experiencia ayuda a otras personas');
  $('#gpx-file').addEventListener('change', async () => {
    const file = $('#gpx-file').files[0], preview = $('#gpx-preview'); preview.hidden = !file; if (!file) return;
    if (file.size > 5 * 1024 * 1024) { preview.textContent = 'El archivo supera los 5 MB. Elige uno más pequeño.'; return; }
    const content = await file.text();
    if (/<!DOCTYPE|<!ENTITY/i.test(content)) { preview.textContent = 'El GPX contiene una declaración XML no admitida. Usa un archivo de trazado simple.'; return; }
    const xml = new DOMParser().parseFromString(content, 'application/xml');
    const points = xml.getElementsByTagNameNS('*', 'trkpt').length + xml.getElementsByTagNameNS('*', 'rtept').length;
    preview.textContent = xml.querySelector('parsererror') || !points ? 'El archivo no contiene un trazado GPX legible. Revisa el archivo.' : `${file.name} — ${points.toLocaleString('es-BO')} puntos. La distancia y el desnivel se calcularán al crear el borrador.`;
    const name = $('#import-form [name=name]'); if (!name.value) name.value = file.name.replace(/\.gpx$/i, '').replaceAll('_', ' ').slice(0, 150);
  });
  formTask('#import-form', async (values, form) => {
    const file = form.querySelector('[type=file]').files[0]; if (!file || file.size > 5 * 1024 * 1024) throw new Error('Selecciona un archivo GPX de hasta 5 MB.');
    delete values.gpx; values.gpx_content = await file.text();
    const route = await api('/routes/import-gpx', { method: 'POST', body: values });
    modal('Tu borrador está listo.', `<div class="detail-metrics"><div><strong>${distance(route.distance_m)}</strong><small>Distancia</small></div><div><strong>${duration(route.estimated_minutes)}</strong><small>Tiempo estimado</small></div><div><strong>${elevation(route.ascent_m)}</strong><small>Ascenso</small></div></div><p class="form-help">${esc(route.name)} todavía es visible solo para ti y administración. Revisa la información antes de compartirla.</p><div class="form-actions"><button class="button secondary" data-action="mine">Ver mis borradores</button><button class="button primary" data-publish="${esc(route.id)}">Publicar ruta</button></div>`, 'Una ruta nueva empieza aquí');
  });
}
async function publishRoute(id) {
  if (!requireUser()) return;
  try { await api(`/routes/${encodeURIComponent(id)}/publish`, { method: 'POST' }); $('#modal').close(); toast('Ruta publicada. Ya forma parte del camino compartido.'); if (state.view === 'mine') showView('mine'); else loadRoutes(); } catch (error) { toast(error.message, true); }
}
async function editRoute(id) {
  if (!requireUser()) return;
  try {
    const route = await api('/routes/' + encodeURIComponent(id));
    modal('Cada camino puede mejorar.', `<form id="edit-form" class="form-stack"><label class="field">Nombre<input name="name" value="${esc(route.name)}" required maxlength="150"></label><label class="field">Descripción<textarea name="description" required maxlength="5000">${esc(route.description)}</textarea></label><label class="field">Dificultad<select name="difficulty">${Object.entries(difficultyNames).map(([key, label]) => `<option value="${key}" ${key === route.difficulty ? 'selected' : ''}>${label}</option>`).join('')}</select></label><label class="field">Estado del sendero<select name="trail_status">${Object.entries(statusNames).map(([key, label]) => `<option value="${key}" ${key === route.trail_status ? 'selected' : ''}>${label}</option>`).join('')}</select></label><label class="field">Advertencias<textarea name="warnings" maxlength="3000">${esc(route.warnings)}</textarea></label>${route.popular ? '<div class="callout">Esta ruta supera las 200 visitas. Los cambios necesitan aprobación administrativa antes de publicarse.</div>' : ''}${errorMarkup}<button class="button primary" type="submit">${route.popular ? 'Enviar cambios a revisión' : 'Guardar cambios'}</button></form>`, route.name);
    formTask('#edit-form', async values => { const result = await api(`/routes/${route.id}`, { method: 'PATCH', body: { ...values, expected_version: route.version } }); $('#modal').close(); toast(result.state === 'pending' ? 'Cambios enviados a revisión.' : 'Cambios guardados.'); showView('mine'); });
  } catch (error) { toast(error.message, true); }
}
function completeRoute(id) {
  if (!requireUser()) return;
  modal('Un camino que ya es parte de ti.', `<form id="completion-form" class="form-stack"><p class="form-help">La finalización es una declaración manual. Cada cuenta se cuenta una sola vez por ruta, aunque repita el recorrido.</p><label class="field">¿Qué día completaste la ruta?<input type="date" name="completed_on" value="${today()}" max="${today()}" required></label>${errorMarkup}<button type="submit" class="button primary">Registrar finalización</button></form>`, 'Mi actividad');
  formTask('#completion-form', async values => { await api(`/routes/${encodeURIComponent(id)}/completion`, { method: 'POST', body: values }); $('#modal').close(); toast('Finalización registrada. Buen camino.'); if (state.view === 'activity') showView('activity'); });
}
function uploadPhoto(id) {
  if (!requireUser()) return;
  modal('Comparte lo que viste.', `<form id="photo-form" class="form-stack"><label class="field">Fotografía<input type="file" name="photo" accept="image/jpeg,image/png,image/webp" required><small>JPEG, PNG o WebP. Máximo 5 MB y 25 megapíxeles.</small></label><label class="field">Descripción<input name="caption" maxlength="300" required></label>${errorMarkup}<button class="button primary" type="submit">Publicar fotografía</button></form>`, 'Fotografías del camino');
  formTask('#photo-form', async (values, form) => {
    const file = form.querySelector('[type=file]').files[0]; if (!file || file.size > 5 * 1024 * 1024) throw new Error('Selecciona una fotografía de hasta 5 MB.');
    const encoded = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(',')[1]); reader.onerror = () => reject(new Error('No se pudo leer la fotografía.')); reader.readAsDataURL(file); });
    await api(`/routes/${encodeURIComponent(id)}/photos`, { method: 'POST', body: { image_base64: encoded, caption: values.caption } }); $('#modal').close(); toast('Fotografía publicada.');
  });
}
async function showProfile() {
  if (!requireUser()) return;
  try {
    state.user = await api('/users/me'); const u = state.user, p = u.profile || {};
    modal('Tu lugar en el camino.', `<div class="badge neutral">${esc(roleNames[u.role])}</div><p class="form-help" style="margin:10px 0 18px">${esc(u.email)}</p><form id="profile-form" class="form-stack"><label class="field">Nombre<input name="name" value="${esc(u.name)}" required maxlength="100"></label>${u.role === 'organization' ? `<label class="field">Nombre de la organización<input name="organization_name" value="${esc(p.organization_name)}" required maxlength="150"></label><label class="field">Tipo<select name="organization_type"><option value="company" ${p.organization_type === 'company' ? 'selected' : ''}>Empresa</option><option value="group" ${p.organization_type === 'group' ? 'selected' : ''}>Grupo</option></select></label><label class="field">Descripción<textarea name="description" maxlength="2000">${esc(p.description)}</textarea></label>` : u.role === 'guide' ? `<p class="badge ${p.status === 'verified' ? 'verified' : 'neutral'}">${esc({ verified: 'Guía verificado', pending: 'Verificación pendiente', rejected: 'Solicitud rechazada' }[p.status] || 'Sin verificar')}</p><label class="field">Biografía<textarea name="bio" required maxlength="2000">${esc(p.bio)}</textarea></label>` : ''}${errorMarkup}<button class="button primary" type="submit">Guardar perfil</button></form>${['tourist','guide'].includes(u.role) && p.status !== 'verified' ? '<div class="divider"></div><button class="button secondary full" data-action="guide-application">Solicitar verificación como guía</button>' : ''}<div class="divider"></div><button class="button secondary full" data-action="logout">Cerrar sesión</button>`, 'Mi cuenta');
    formTask('#profile-form', async values => {
      if (u.role === 'organization') {
        const { name, ...organization } = values; await api('/organizations/me', { method: 'PATCH', body: organization }); await api('/users/me', { method: 'PATCH', body: { name } });
      } else if (u.role === 'guide') {
        await api('/guides/me', { method: 'PATCH', body: { bio: values.bio } }); await api('/users/me', { method: 'PATCH', body: { name: values.name } });
      } else await api('/users/me', { method: 'PATCH', body: values });
      state.user = await api('/users/me'); $('#account-button').textContent = state.user.name.split(' ')[0] + ' ▾'; toast('Perfil actualizado.'); $('#modal').close();
    });
  } catch (error) { toast(error.message, true); }
}
function guideApplication() {
  if (!requireUser()) return;
  modal('Comparte tu experiencia.', `<form id="guide-form" class="form-stack"><label class="field">Biografía profesional<textarea name="bio" maxlength="2000" required>${esc(state.user.profile?.bio || '')}</textarea></label><label class="field">Referencia de acreditación<input name="credential_reference" maxlength="200" required value="${esc(state.user.profile?.credential_reference || '')}"><small>Solo tú y administración pueden consultar esta referencia.</small></label><p class="form-help">Tu cuenta pasará a guía pendiente. Una persona administradora revisará la solicitud antes de mostrarte como guía verificado.</p>${errorMarkup}<button class="button primary" type="submit">Enviar solicitud</button></form>`, 'Verificación de guías');
  formTask('#guide-form', async body => { await api('/guides/applications', { method: 'POST', body }); state.user = await api('/users/me'); $('#modal').close(); toast('Solicitud enviada a revisión.'); });
}
async function showView(view) {
  if (view !== 'explore' && !requireUser()) return;
  if (view === 'admin' && state.user?.role !== 'admin') return;
  state.view = view; $('#modal').close();
  document.querySelectorAll('[data-view]').forEach(b => b.classList.toggle('active', b.dataset.view === view));
  document.body.classList.toggle('workspace-mode', view !== 'explore');
  $('.sidebar').hidden = view !== 'explore'; $('.map-region').hidden = view !== 'explore'; $('#workspace').hidden = view === 'explore';
  if (view === 'explore') { map?.invalidateSize(); loadRoutes(); return; }
  const title = { mine: 'Los caminos que compartes.', activity: 'Cada camino cuenta.', admin: 'Cuidemos lo que compartimos.' }[view];
  $('#workspace').innerHTML = `<h1>${title}</h1><p class="muted">${{ mine: 'Tus borradores y rutas publicadas, en un solo lugar.', activity: 'Tus finalizaciones declaradas. Solo tú puedes consultar este registro.', admin: 'Revisa guías y propuestas de cambios en rutas populares.' }[view]}</p><div id="workspace-content"><p class="muted">Cargando…</p></div>`;
  try {
    if (view === 'mine') {
      const routes = await api('/my/routes'); state.routes = routes;
      $('#workspace-content').innerHTML = `<button class="button primary" data-action="import">Importar un GPX</button><div class="workspace-list">${routes.length ? routes.map(r => `<article class="workspace-item"><header><div><h3>${esc(r.name)}</h3><p>${badge(r)} <span class="badge neutral">${r.state === 'draft' ? 'Borrador' : 'Publicada'}</span>${r.popular ? ' <span class="badge neutral">Ruta popular</span>' : ''}</p></div><span class="badge neutral">Versión ${Number(r.version)}</span></header><div class="metrics">${metric(r)}</div><div class="actions"><button class="button secondary small" data-detail="${esc(r.id)}">Ver ficha</button><button class="button secondary small" data-edit="${esc(r.id)}">Editar</button>${r.state === 'draft' ? `<button class="button primary small" data-publish="${esc(r.id)}">Publicar</button>` : ''}</div></article>`).join('') : '<div class="empty"><h3>Tu primera ruta empieza con un GPX.</h3><p>Impórtalo, revisa el borrador y compártelo cuando esté listo.</p></div>'}</div>`;
    } else if (view === 'activity') {
      const activities = await api('/my/activities');
      const routes = await Promise.all(activities.map(a => api('/routes/' + a.route_id).catch(() => null)));
      $('#workspace-content').innerHTML = activities.length ? `<div class="workspace-list">${activities.map((a, i) => `<article class="workspace-item"><header><h3>${esc(routes[i]?.name || 'Ruta no disponible')}</h3><span class="badge neutral">Declaración manual</span></header><p class="activity-date">Completada el ${esc(a.completed_on.slice(0, 10))}</p>${routes[i] ? `<div class="metrics">${metric(routes[i])}</div>` : ''}<div class="actions"><button class="text-button" data-undo="${esc(a.route_id)}">Retirar esta declaración</button></div></article>`).join('')}</div>` : '<div class="empty"><h3>Todavía quedan muchos caminos.</h3><p>Abre una ruta y registra la fecha en que la completaste.</p><button class="button primary" data-action="explore">Explorar rutas</button></div>';
    } else {
      const [guides, revisions] = await Promise.all([api('/admin/guides'), api('/admin/revisions')]);
      $('#workspace-content').innerHTML = `<div class="workspace-tabs"><span class="badge neutral">${guides.length} solicitudes de guía</span><span class="badge neutral">${revisions.length} cambios de ruta</span><button class="text-button" data-action="create-admin">Crear administrador</button></div><div class="workspace-list">${guides.map(g => `<article class="workspace-item"><h3>${esc(g.name)}</h3><p>${esc(g.bio)}</p><p><strong>Referencia privada:</strong> ${esc(g.credential_reference)}</p><div class="actions"><button class="button primary small" data-review-guide="${esc(g.user_id)}" data-approve="true">Verificar guía</button><button class="button secondary small" data-review-guide="${esc(g.user_id)}" data-approve="false">Rechazar solicitud</button></div></article>`).join('')}${revisions.map(r => `<article class="workspace-item"><h3>Cambio propuesto para una ruta popular</h3><p>Ruta: ${esc(r.route_id)}. Versión base: ${Number(r.base_version)}.</p><details><summary>Ver cambios propuestos</summary><pre style="white-space:pre-wrap;font-size:11px">${esc(JSON.stringify(r.payload, null, 2))}</pre></details><div class="actions"><button class="button primary small" data-review-revision="${esc(r.id)}" data-approve="true">Aprobar cambios</button><button class="button secondary small" data-review-revision="${esc(r.id)}" data-approve="false">Rechazar cambios</button></div></article>`).join('')}${!guides.length && !revisions.length ? '<div class="empty"><h3>Todo al día.</h3><p>Las nuevas solicitudes aparecerán aquí.</p></div>' : ''}</div>`;
    }
  } catch (error) { $('#workspace-content').innerHTML = `<div class="form-error">${esc(error.message)}</div>`; }
}
function createAdmin() {
  if (state.user?.role !== 'admin') return;
  modal('Otra persona para cuidar el camino.', `<form id="admin-form" class="form-stack"><label class="field">Nombre<input name="name" maxlength="100" required autocomplete="off"></label><label class="field">Correo<input type="email" name="email" required maxlength="254" autocomplete="off"></label><label class="field">Contraseña inicial<input type="password" name="password" required minlength="12" maxlength="128" autocomplete="new-password"></label><p class="form-help">La cuenta tendrá permisos de administración. No se iniciará sesión automáticamente con ella.</p>${errorMarkup}<button class="button primary" type="submit">Crear administrador</button></form>`, 'Administración');
  formTask('#admin-form', async body => { await api('/admin/users', { method: 'POST', body: { ...body, role: 'admin' } }); $('#modal').close(); toast('Cuenta administradora creada.'); });
}
function reviewRevision(id, approve) {
  modal(approve ? 'Aprobar cambios de ruta' : 'Rechazar cambios de ruta', `<form id="revision-form" class="form-stack"><label class="field">Motivo de la decisión<textarea name="reason" required maxlength="500"></textarea></label><p class="form-help">La versión base debe seguir vigente. No puedes aprobar tus propios cambios.</p>${errorMarkup}<button class="button primary" type="submit">${approve ? 'Aprobar cambios' : 'Rechazar cambios'}</button></form>`, 'Administración');
  formTask('#revision-form', async body => { await api(`/admin/revisions/${encodeURIComponent(id)}/review`, { method: 'POST', body: { ...body, approve } }); $('#modal').close(); toast('Decisión guardada.'); showView('admin'); });
}
function credits() {
  modal('El paisaje también tiene autor.', `<ul class="credit-list"><li><a href="https://commons.wikimedia.org/wiki/File:Valle_de_la_Luna,_La_Paz.jpg" target="_blank" rel="noopener">Valle de la Luna, La Paz</a>, de EEJCC.</li><li><a href="https://commons.wikimedia.org/wiki/File:Huayna_Potosi_07.jpg" target="_blank" rel="noopener">Paisaje del Huayna Potosí</a>, de Das Morton.</li></ul><p class="form-help">Ambas fotografías se distribuyen bajo <a href="https://creativecommons.org/licenses/by-sa/4.0/" target="_blank" rel="noopener">CC BY-SA 4.0</a>. Se han redimensionado, convertido a WebP y recortado visualmente para esta interfaz. Son imágenes del paisaje, no pruebas de una ruta.</p><div class="divider"></div><p class="form-help">Mapa base: © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap contributors</a>. Visor: <a href="https://leafletjs.com/" target="_blank" rel="noopener">Leaflet</a>. Tipografías Manrope y Barlow Condensed, con licencia OFL.</p>`);
}
document.addEventListener('click', async event => {
  const target = event.target.closest('button,a[data-action]'); if (!target || target.disabled) return;
  if (target.dataset.action) {
    const action = target.dataset.action;
    if (action === 'close') $('#modal').close();
    else if (action === 'account') state.user ? showProfile() : showAuth();
    else if (action === 'login') showAuth();
    else if (action === 'register') showAuth(true);
    else if (action === 'import') showImport();
    else if (action === 'retry') loadRoutes();
    else if (action === 'reset') { state.difficulty = ''; state.query = ''; $('#search').value = ''; document.querySelectorAll('[data-difficulty]').forEach(b => b.classList.toggle('active', b.dataset.difficulty === '')); loadRoutes(); }
    else if (action === 'unselect') { $('#map-card').hidden = true; state.selected = null; }
    else if (action === 'credits') credits();
    else if (action === 'about-map') modal('Un mapa para encontrar tu camino.', '<p class="zoom-info">Explora la cartografía de OpenStreetMap y selecciona un trazado para ver su ficha. El círculo numerado indica el inicio y el cuadrado amarillo, la llegada. Usa el zoom o el botón de encuadre para orientarte.</p><div class="callout">Los mapas y las rutas compartidas pueden contener errores. Comprueba las condiciones del recorrido antes de salir. La versión actual necesita conexión.</div><p class="form-help"><a href="https://www.openstreetmap.org/fixthemap" target="_blank" rel="noopener">Informar de un problema en el mapa</a></p>');
    else if (action === 'guide-application') guideApplication();
    else if (action === 'create-admin') createAdmin();
    else if (action === 'mine') showView('mine');
    else if (action === 'explore') showView('explore');
    else if (action === 'logout') { clearSession(); $('#modal').close(); showView('explore'); toast('Sesión cerrada.'); }
  }
  if ('difficulty' in target.dataset) { state.difficulty = target.dataset.difficulty; document.querySelectorAll('[data-difficulty]').forEach(b => b.classList.toggle('active', b === target)); loadRoutes(); }
  if (target.dataset.route) selectRoute(target.dataset.route);
  if (target.dataset.detail) { const route = state.routes.find(r => r.id === target.dataset.detail); if (route) showDetail(route); }
  if (target.dataset.publish) { target.disabled = true; await publishRoute(target.dataset.publish); if (target.isConnected) target.disabled = false; }
  if (target.dataset.edit) editRoute(target.dataset.edit);
  if (target.dataset.complete) completeRoute(target.dataset.complete);
  if (target.dataset.photo) uploadPhoto(target.dataset.photo);
  if (target.dataset.view) showView(target.dataset.view);
  if (target.dataset.mobile) { document.body.classList.toggle('mobile-map', target.dataset.mobile === 'map'); document.querySelectorAll('[data-mobile]').forEach(b => b.classList.toggle('active', b === target)); map?.invalidateSize(); }
  if (target.dataset.undo) {
    if (!confirm('¿Retirar tu declaración de finalización de esta ruta?')) return;
    try { await api(`/routes/${encodeURIComponent(target.dataset.undo)}/completion`, { method: 'DELETE' }); toast('Declaración retirada.'); showView('activity'); } catch (error) { toast(error.message, true); }
  }
  if (target.dataset.reviewGuide) {
    const approve = target.dataset.approve === 'true';
    if (!confirm(approve ? '¿Verificar el perfil de esta persona como guía?' : '¿Rechazar esta solicitud de guía?')) return;
    try { await api(`/admin/guides/${encodeURIComponent(target.dataset.reviewGuide)}/review`, { method: 'POST', body: { approve } }); toast('Solicitud revisada.'); showView('admin'); } catch (error) { toast(error.message, true); }
  }
  if (target.dataset.reviewRevision) reviewRevision(target.dataset.reviewRevision, target.dataset.approve === 'true');
});
$('#modal').addEventListener('click', event => { if (event.target !== $('#modal')) return; const r = $('#modal').getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) $('#modal').close(); });
$('#search-form').addEventListener('submit', event => { event.preventDefault(); state.query = $('#search').value.trim(); loadRoutes(); });
$('#search').addEventListener('search', () => { if (!$('#search').value) { state.query = ''; loadRoutes(); } });
$('#sort').addEventListener('change', event => { state.sort = event.target.value; renderRoutes(); });
$('#load-more').addEventListener('click', () => { state.offset += 20; loadRoutes(true); });
$('#fit-map').addEventListener('click', fitMap);
$('#locate').addEventListener('click', () => {
  if (!navigator.geolocation) { toast('Este navegador no permite consultar tu ubicación.', true); return; }
  navigator.geolocation.getCurrentPosition(position => {
    if (!map) return; const latLng = [position.coords.latitude, position.coords.longitude]; locationMarker?.remove(); locationMarker = L.circleMarker(latLng, { radius: 8, color: '#ffffff', weight: 3, fillColor: '#306c9f', fillOpacity: 1 }).addTo(map); map.setView(latLng, 13); toast('Tu ubicación se muestra solo en este mapa.');
  }, () => toast('No se pudo consultar tu ubicación. Puedes explorar el mapa manualmente.', true), { enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 });
});
if (state.demo) { document.body.classList.add('demo-mode'); $('#design-banner').hidden = false; }
initMap();
await loadRoutes();
if (state.demo && state.routes.length && !matchMedia('(max-width:760px)').matches) { await selectRoute(state.routes[0].id); fitMap(); }
