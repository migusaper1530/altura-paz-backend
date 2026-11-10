# Integración GIS web implementada

El backend obtiene datos públicos de OpenStreetMap y devuelve los trazados como GeoJSON. La pantalla principal muestra esta capa automáticamente, junto con un selector de zona. Las rutas de usuarios se mantienen en la pestaña Comunidad.

## Fuente y proceso

1. `GET /api/gis/routes?area=mallasa` valida una de cuatro zonas fijas.
2. El gateway consulta relaciones `type=route` con `route=hiking|foot` y vías `highway=path|footway` mediante Overpass.
3. Si Overpass no responde o entrega un resultado parcial, consulta el endpoint oficial `https://api.openstreetmap.org/api/0.6/map.json?bbox=...` para el mismo recuadro pequeño. Esta API es un respaldo acotado, no un mecanismo de extracción masiva. Para ampliar cobertura debe utilizarse un proveedor Overpass propio o extractos regionales.
4. Convierte coordenadas WGS84 a GeoJSON `MultiLineString`; conserva vías desconectadas, respeta `backward`, omite relaciones incompletas, vías privadas/prohibidas y pasos de peatones/aceras. Evita duplicar una vía ya representada por una relación completa.
5. Calcula la longitud de cada geometría mediante Haversine, sin unir los huecos. No fabrica dificultad turística, elevaciones, duraciones, finalizaciones ni fotografías.
6. El frontend dibuja esas coordenadas con Leaflet; cada elemento enlaza a su vía/relación original. Los puntos pequeños ubican los objetos GIS y no indican un inicio de excursión.

## Ámbito y límites

| Zona | bbox oeste, sur, este, norte |
|---|---|
| Mallasa / Valle de la Luna | -68.10, -16.57, -68.08, -16.55 |
| Palca | -67.96, -16.57, -67.94, -16.55 |
| Zona sur | -68.05, -16.61, -68.03, -16.59 |
| Cordillera / sector Chacaltaya | -68.14, -16.36, -68.12, -16.34 |

Cada zona es un recuadro acotado de aproximadamente 2×2 km, sin pretensión de representar un límite administrativo ni todos los senderos de La Paz. Máximo 150 objetos mostrados. Una vía puede ser solo un tramo de pocos metros; tener el mismo nombre no permite considerarlas automáticamente una excursión completa. La disponibilidad y calidad dependen de la cartografía comunitaria.

La capa externa es de lectura. No se modifica OpenStreetMap ni se registra una finalización interna sobre identificadores OSM. Las actividades, comentarios y publicación de GPX continúan usando las entidades y permisos propios.

## Disponibilidad y conexión

Caché de seis horas en el volumen Docker `gis-cache`, consultas simultáneas agrupadas y reintento mínimo de un minuto ante fallos. Puede mostrarse la última respuesta válida hasta siete días, marcada como antigua y con la fecha original. Si no existe una respuesta válida se devuelve 503; nunca se sustituyen datos web por el conjunto de diseño.

Límites: espera Overpass 10 s / respaldo 15 s, respuesta máxima de 12 MB y máximo 100000 elementos de entrada. Solo se permiten las cuatro zonas; el cliente no envía URLs, consultas ni bbox libres. No se conservan autores de ediciones ni sus identificadores.

El servidor del puerto 8090 ahora reenvía `/api/*` al backend local 8088, manteniendo el mismo origen para el navegador. Conserva método, cuerpo, autorización y códigos HTTP. La vista de diseño sigue disponible explícitamente en `?demo=1`; seleccionar Senderos GIS desde ella abre el sitio real.

## Evidencia y fuentes

Consulta real del 10 de noviembre de 2026: Mallasa devolvió 52 tramos válidos mediante el respaldo oficial, incluidos Sendero Del Águila y Recorrido Largo/Corto. Overpass presentó errores/tiempos de espera. El conteo corresponde a esa consulta y puede cambiar. La API publicada entrega fecha, fuente, transporte, licencia y estado de caché para auditar cada respuesta.

Se incluyen tres vías reales con sus nodos en `test/fixtures/osm-mallasa.json` como prueba reproducible. Se probaron la conversión, geometrías incompletas, privacidad de acceso, reintentos, respaldo, persistencia de caché, prioridad del endpoint y proxy de desarrollo.

- Overpass, servicio y formato: https://wiki.openstreetmap.org/wiki/Overpass_API
- API oficial OSM, JSON y consulta por bbox: https://wiki.openstreetmap.org/wiki/API_v0.6
- Rutas de senderismo: https://wiki.openstreetmap.org/wiki/Tag:route%3Dhiking
- Licencia ODbL y atribución: https://www.openstreetmap.org/copyright

© OpenStreetMap contributors. Los datos obtenidos y la muestra derivada se distribuyen bajo ODbL 1.0.
