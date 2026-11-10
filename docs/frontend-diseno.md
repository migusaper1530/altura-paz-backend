# Frontend Altura Paz

Dirección elegida: montaña, verde profundo, fondos claros y fotografías de paisajes.

## Plan visual

- Colores: bosque #173E32 (texto y acciones), sendero #2C6750 (recorridos), nieve #F7F9F6 (fondo), papel #FFFFFF, piedra #5A6960 (texto secundario), sol #E9C360 (punto de llegada).
- Tipografía: Barlow Condensed para títulos que recuerdan señalización de montaña; Manrope para controles y lectura. Fuentes locales con licencia OFL.
- Composición: navegación compacta, columna izquierda para buscar y comparar, mapa continuo a la derecha. Texto alineado a la izquierda. En móvil se alterna lista/mapa y los formularios se apilan.
- El elemento protagonista es el recorrido: línea verde con inicio circular y llegada marcada. Fotos de paisaje acompañan las fichas, sin presentarse como evidencia de un GPX.

```
[Altura Paz] [Explorar / Mis rutas / Actividad] [Importar GPX] [Cuenta]
[Presentación y búsqueda] | [Localización]           [Controles]
[Filtros y resultados]  |          mapa con trazados
[Imagen + ficha]        |      ficha de ruta seleccionada
[Imagen + ficha]        |                             [Atribución]
```

## Revisión antes de construir

Se descarta una portada comercial con estadísticas inventadas: la tarea es encontrar una ruta. El mapa permanece visible al buscar y comparar. Las fotos reales de Wikimedia ilustran el lugar y conservan sus créditos; no se asignan automáticamente a rutas publicadas. Los datos de ejemplo se activan explícitamente y se etiquetan. El sitio real lee la API del mismo origen.

## Alcance

Explorar y filtrar rutas, consultar trazados y fichas, iniciar sesión/registrarse, importar GPX a borrador y publicarlo, editar rutas propias, declarar finalizaciones, consultar actividad, comentar, subir fotografías y editar perfiles. Administración dispone de revisión de guías y cambios de rutas populares. Empresas y grupos comparten formulario y se distinguen por tipo. La cuenta administradora se crea desde administración.

El mapa base utiliza Leaflet 1.9.4 y OpenStreetMap, con atribución visible y peticiones normales del navegador. No se descargan teselas para uso sin conexión. No se presenta cartografía satelital porque el proyecto aún no tiene un proveedor configurado.

## Verificación

Revisión en navegador de filtros, registro por tipo y vistas a 1280, 960 y 390 píxeles de ancho. En móvil, el ancho del documento coincide con el viewport (390 px). Flujo real comprobado contra una base de datos aislada: alta de turista, selección de GPX sintético, creación de borrador, publicación, ficha, finalización y consulta de actividad. No se consultó la ubicación real del equipo.

Pruebas automatizadas: 40 tests Jest con integración PostgreSQL/PostGIS/GIS, más cuatro tests del frontend para escape de contenido, métricas ausentes, búsqueda y segmentos geográficos. Las pruebas del gateway comprueban MIME y rechazo de acceso fuera de `public`. Los servicios temporales se apagan al finalizar la revisión.

Fuentes consultadas: documentación oficial de Leaflet 1.9.4 en https://leafletjs.com/reference-1.9.4.html y política de teselas en https://operations.osmfoundation.org/policies/tiles/ . Licencias de fotografías y tipografías en `public/assets/CREDITS.md`.
