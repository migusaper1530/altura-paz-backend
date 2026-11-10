# Altura Paz
## Perfil inicial y propuesta técnica para SIS-215

Versión 0.1 · 3 de noviembre de 2026 · La Paz, Bolivia.

**Estado:** prototipo local ejecutable y propuesta de evolución. Esta entrega prepara una presentación inicial. No constituye una certificación de cumplimiento total de la defensa final: Sepolia, repositorio remoto, ejecución de CI/CD en GitHub, despliegue cloud, video e informes de suficiencia requieren actuaciones adicionales.

Documento de referencia: `perfil_proyecto_guia_backend_blockchain-sis215.pdf`, seis páginas facilitadas por el usuario. Se conserva su estructura de capítulos y se adapta el ejemplo de catálogo/pedidos al dominio de rutas/actividades. No se atribuye al prototipo ninguna mejora de rendimiento o descentralización que no haya sido medida.

# Capítulo 1. Marco referencial

## 1.1 Introducción y contexto

Se propone desarrollar un backend para que senderistas y guías compartan rutas de una selección de lugares alrededor de La Paz. El recorrido se importa desde un GPX y se publica con una ficha, fotografías, advertencias y reportes asociados a puntos del trazado. Los senderistas pueden declarar manualmente que completaron la ruta.

El problema operativo que se abordará es distinguir la versión vigente de una ruta, conservar la trazabilidad de sus cambios y evitar que las declaraciones repetidas inflen el número de personas que la completaron. Cuando una ruta supera 200 visitas contabilizadas, los cambios del autor requieren aprobación administrativa. Una huella criptográfica de cada versión pública permite contrastar el contenido con un registro externo a la base de datos de la aplicación.

No se ha estudiado una organización concreta ni se ha demostrado que las soluciones actuales sean vulnerables o lentas. Esas afirmaciones del ejemplo metodológico no se trasladan como hechos al proyecto. El diagnóstico inicial procede de los requisitos del usuario y deberá contrastarse con senderistas y guías locales.

## 1.2 Antecedentes y comparativa

El portal de Turismo del Gobierno Autónomo Municipal de La Paz describe experiencias de trekking en la Cordillera Real y caminatas en valles, además de la diversidad territorial del municipio. Es un antecedente de contexto, no una prueba de demanda comercial ni una fuente de trazados GPX autorizados. [Turismo GAMLP](https://lapaz.bo/turismo/pisos-ecologicos/).

| Solución | Función documentada relevante | Arquitectura interna verificable | Decisión para esta propuesta |
|---|---|---|---|
| Wikiloc | Carga de archivos GPX y ficha con dificultad y fotografías | No determinada en las fuentes consultadas | Adoptar importación y ficha; no copiar contenidos ni calcular métricas comerciales ajenas |
| AllTrails | Importación diferenciada para actividades y rutas personalizadas | No determinada | Separar ruta de actividad realizada |
| Gaia GPS | Importación web de tracks, rutas y waypoints; selección antes de guardar | No determinada | Conservar estructura geográfica y permitir revisión antes de publicar |
| Altura Paz | GPX, rutas públicas, conteo manual único, aprobación desde 201 visitas y huellas de versiones | Código propio: NestJS, Spring Boot, PostGIS, RabbitMQ y Solidity | Enfoque local y reglas de trazabilidad explícitas |

Fuentes oficiales de las funciones comparadas: [Wikiloc](https://help.wikiloc.com/article/610-how-to-upload-a-trail-from-a-trail-file-gpx), [AllTrails](https://support.alltrails.com/hc/en-us/articles/37228498475028-Uploading-files-to-AllTrails), [Gaia GPS](https://help.gaiagps.com/hc/en-us/articles/360052763513-Import-GPX-KML-KMZ-GeoJSON-or-FIT-Files-on-gaiagps-com). No se afirma que esos productos carezcan de auditoría o que utilicen una pila específica.

Como antecedente nacional de información espacial, la IDE-EPB identifica instituciones responsables de cartografía, caminos y áreas protegidas. Esa existencia no concede automáticamente permiso de redistribución ni garantiza una API operativa; cada conjunto deberá comprobarse antes de incorporarlo. [IDE-EPB, capas fundamentales](https://ideepb.geo.gob.bo/wp-content/uploads/2024/10/resolucion_1_anexo.pdf).

## 1.3 Problema y causas

| Categoría | Riesgo o necesidad por validar | Respuesta de ingeniería |
|---|---|---|
| Información | Cambios del trazado sin una versión pública identificable | UUID, versión y registro SHA-256 por publicación |
| Método | Editar una ruta muy consultada puede afectar decisiones de otros usuarios | Propuesta pendiente, revisión y control de concurrencia |
| Medición | Repetir una declaración o recargar la página puede inflar contadores | Restricciones únicas y visitas autenticadas deduplicadas |
| Infraestructura | Una dependencia GIS o blockchain puede fallar | GPX local, timeout, circuit breaker y outbox durable |
| Privacidad | El GPX o una foto puede revelar información personal innecesaria | Descartar timestamps/metadatos GPX, eliminar EXIF y mantener actividades privadas |

Efecto central: dificultad para identificar qué información fue publicada, quién tiene permiso para modificarla y qué confianza merecen sus indicadores. No se presentan porcentajes de incidencia sin un estudio de campo.

## 1.4 Formulación del problema

¿Cómo gestionar la publicación, actualización y consulta de rutas de senderismo de los alrededores de La Paz de forma que sus versiones sean trazables y las contribuciones comunitarias conserven reglas explícitas de integridad, acceso y privacidad?

## 1.5 Objetivos

**Objetivo general:** desarrollar y evaluar un backend de microservicios para gestionar rutas de senderismo y contribuciones comunitarias, con verificación criptográfica de versiones publicadas mediante un contrato inteligente.

Objetivos específicos:

1. **Analizar** los requisitos, actores y reglas de publicación mediante historias de usuario y criterios de aceptación.
2. **Diseñar** la arquitectura C4, los contextos de dominio, la persistencia espacial y los contratos de API y Solidity.
3. **Desarrollar** servicios de identidad, rutas, procesamiento GPX y auditoría con NestJS, Spring Boot y PostgreSQL/PostGIS.
4. **Implementar** pruebas automatizadas, contenedores y un pipeline de integración y despliegue a staging, con una prueba pública en Sepolia.
5. **Validar** integridad, permisos, concurrencia, resiliencia y rendimiento con evidencia reproducible y un informe de costos.

El objetivo 4 incluye configuración preparada y trabajo externo pendiente; no se declara alcanzado íntegramente en la demostración local.

## 1.6 Justificación, alcance y límites

La justificación técnica es identificar versiones de rutas y desacoplar la publicación de la confirmación blockchain. La económica consiste en demostrar el flujo sin contratar inicialmente servicios GIS ni cloud. No se presume que los microservicios sean más baratos que un monolito: aquí responden al perfil académico y añaden costo operativo. La utilidad social propuesta es facilitar información local cuya procedencia y nivel de verificación puedan consultarse.

**MVP funcional:** API web con conexión, registro y JWT, cuatro tipos de cuenta, importación GPX, borrador y publicación, rutas públicas, consultas espaciales por bbox, edición con control de versión, aprobación desde la visita 201, finalización manual única, comentarios y reportes geolocalizados, fotografías, verificación administrativa de guías y anclaje de versiones en una EVM local.

**Conceptual en esta fase:** mapa 2D, alternancia de mapa y satélite, herramientas para dibujar/editar y puntos de interés. No se ha construido el frontend completo ni una cartografía navegable. La vista usa relieve y datos ilustrativos explícitamente rotulados.

**Futuro de producto:** mapa real, editor de trazado, GPX con waypoints importados como POI, recorte de extremos, cálculo sobre una red de senderos, DEM, offline, aplicación móvil, actividad GPS verificada, salidas guiadas con fechas/cupos, reservas y modelo comercial. No hay prueba gratuita ni monetización definida.

**Entrega académica final adicional:** contrato en Sepolia con dirección/recibo, repositorio remoto, CI/CD ejecutado, staging, evidencia de carga objetivo, video de diez minutos e informes aprobados por tutor/panelista/relator.

## 1.7 Metodología y cronograma

Se propone un backlog por historias, una demostración por incremento y Git Flow con `main`, `develop` y ramas `feature/*`. Para una persona y pocas horas se usa un tablero y revisión por criterios de aceptación; no se inventan ceremonias Scrum ni un equipo que no existe.

| Etapa | Resultado | Dependencia |
|---|---|---|
| Entrega inmediata | Perfil inicial, C4 1-4, esquema, API y demo local reproducible | Equipo con Docker y conexión para descargar imágenes |
| Cierre académico técnico | Sepolia, repositorio y CI/CD ejecutado, staging y video | Cuenta GitHub, proveedor cloud, RPC y wallet de prueba |
| Piloto territorial | Selección de 5-10 GPX reales con permiso y revisión de guías | Contacto con guías y evaluación de cobertura GIS |
| Segunda fase del producto | Frontend real, mapa, POI y editor manual | Validación del piloto, presupuesto y priorización |
| Evolución | Offline, móvil, navegación y actividades GPS | Nuevos requisitos, licencias y pruebas de campo |

La guía menciona hitos de octubre y noviembre de 2026. A 3 de noviembre se documenta el trabajo disponible; no se atribuyen retrospectivamente entregas de octubre. El calendario oficial debe confirmarse con la asignatura.

# Capítulo 2. Marco teórico y decisiones

## 2.1 Diseño y fronteras de dominio

**DDD:** identidad y verificación profesional; catálogo de rutas y contribuciones; procesamiento geográfico; y auditoría criptográfica son contextos distintos. Las actividades representan declaraciones de personas, no versiones del catálogo. Los perfiles de guía no conceden permisos administrativos.

**SOLID y arquitectura limpia:** los controllers reciben HTTP y delegan en casos de uso. Estos dependen de puertos abstractos, implementados por repositorios con SQL parametrizado. El procesamiento XML y Web3 quedan en adaptadores específicos. La separación es suficiente para el prototipo; los puertos genéricos de comandos deberán convertirse en contratos tipados al crecer el sistema. Los módulos comparten repositorio e imagen Node, pero se ejecutan como procesos y contenedores independientes.

**Consistencia:** una publicación y su evento outbox se escriben en la misma transacción. RabbitMQ usa mensajes persistentes y confirmación del publicador. El consumidor es idempotente y confirma después de persistir el recibo. Un fallo tras la transacción blockchain puede recuperarse consultando el evento del contrato. Esto es entrega al menos una vez con efectos idempotentes, no una garantía universal de entrega exactamente una vez.

## 2.2 Pila seleccionada

| Componente | Elección y motivo | Costo de complejidad |
|---|---|---|
| Gateway, identidad, rutas, auditoría | NestJS 11.2.8 / TypeScript, módulos y DI | Varias unidades de ejecución; mantenerlas pequeñas |
| Servicio GIS | Spring Boot 4.1.2 / Java 17, parser XML seguro y métricas GPX | Añade JVM para ajustarse a la guía académica |
| Persistencia | PostgreSQL 17 + PostGIS, geometry EPSG:4326 e índice GiST | Una sola instancia local no ofrece alta disponibilidad |
| Mensajería | RabbitMQ, por colas durables y consumidores simples | Kafka se reserva para un volumen o ecosistema que lo justifique |
| Ledger | Solidity 0.8.38, OpenZeppelin Ownable2Step y ethers | Gestión de claves, confirmaciones y dependencia RPC |
| Infraestructura | Docker Compose, descubrimiento por DNS | No equivale a orquestación o escalado automático |
| Calidad | Jest, JUnit 5, JaCoCo, k6 y GitHub Actions | La configuración debe acompañarse de resultados ejecutados |

Las versiones efectivas de Node están fijadas en `package-lock.json`; las imágenes usan tags de familia y deberían fijarse a digest al establecer staging. Nest documenta TypeScript y separación modular; Spring mantiene soporte de Java 17 en las ramas utilizadas. [NestJS](https://docs.nestjs.com/first-steps), [Spring Boot](https://docs.spring.io/spring-boot/4.0/maven-plugin/using.html). La versión concreta de Spring se verificó además en Maven Central durante la compilación.

No se añade MongoDB porque el modelo relacional y PostGIS cubren el MVP. La guía lo incluye en un ejemplo de contenedores; si el docente lo exige de forma literal, debe confirmarse y justificar un contexto documental real. No se crea un microservicio de pedidos ajeno al producto.

## 2.3 Institución y beneficiarios

Se toma SIS-215 como marco académico, no como organización cliente con requisitos firmados. Los beneficiarios propuestos son senderistas y guías de la región. Están pendientes el responsable de moderación, el protocolo para acreditar guías, los contactos de campo y la entidad que autoriza el piloto.

# Capítulo 3. Ingeniería y modelado

## 3.1 Historias y criterios de aceptación

| Historia | Criterio en formato Dado / Cuando / Entonces |
|---|---|
| HU-01 Importar GPX | Dada una cuenta activa, cuando importa un GPX válido, entonces se crea un borrador con UUID, segmentos y métricas |
| HU-02 Publicar | Dado un borrador propio, cuando su autor lo publica, entonces aparece en búsquedas públicas y se genera un evento de auditoría |
| HU-03 Proteger rutas populares | Dada una ruta con 201 visitas, cuando su autor cambia la ficha, entonces se crea una propuesta y la versión pública no cambia hasta aprobarla |
| HU-04 Evitar duplicados | Dada una declaración existente, cuando la persona repite la solicitud incluso simultáneamente, entonces el contador sigue siendo uno |
| HU-05 Reportar | Dada una ruta pública, cuando se reporta un obstáculo cercano al trazado, entonces se publica como no verificado y entra en la cola administrativa |
| HU-06 Verificar guía | Dada una solicitud, cuando otra persona administradora la aprueba, entonces el perfil pasa a verificado |
| HU-07 Confirmar integridad | Dada una versión publicada, cuando se calcula su SHA-256 y se consulta el contrato, entonces se pueden comparar las dos huellas |
| HU-08 Proteger ubicaciones | Dada una fotografía, cuando se almacena, entonces se recodifica sin EXIF; las actividades ajenas no tienen un listado público |

Requisitos no funcionales: percentil 95 menor a 200 ms para lectura de listado a 1000 solicitudes/segundo; TLS 1.3 en el perímetro; cobertura mayor al 75%; aislamiento de permisos; timeout y circuit breaker; recuperación de mensajes pendientes. El objetivo de latencia se limita al endpoint y escenario de carga descritos, no a una importación de 5 MB ni a la inclusión de una transacción en Ethereum. El informe de evidencia indica cuáles se verificaron.

## 3.2 Arquitectura recomendada

Los diagramas C4 1-4, el esquema de relaciones y sus límites están en `docs/arquitectura.md`. El gateway es el único acceso público. Identidad, rutas y auditoría se ejecutan como servicios NestJS; el servicio Spring procesa GPX; PostgreSQL separa esquemas y usuarios; RabbitMQ desacopla el anclaje. El listado anónimo público usa una caché interna de un segundo y agrupa consultas iguales en curso; las escrituras exitosas invalidan el contenido en el gateway. Los detalles y las comprobaciones de permisos permanecen sin esa caché. La API lee recibos del ledger con permisos de solo lectura para evitar otra llamada síncrona en el detalle de ruta.

Cada servicio valida o preserva la autenticación apropiada: identidad emite JWT HS256 de quince minutos; las escrituras del catálogo vuelven a verificar el token; el gateway consulta el estado de la cuenta en identidad para aplicar la deshabilitación. Un cambio de rol se refleja al iniciar sesión de nuevo. En producción se recomienda migrar a claves asimétricas/JWKS para que los servicios verificadores no puedan emitir tokens, y disponer de revocación y recuperación de cuenta.

No se crean microservicios por tabla. Comentarios, reportes, fotos y actividades permanecen en el contexto del catálogo para mantener simple la consistencia del MVP.

## 3.3 Modelo de datos

Actualizado el 10 de noviembre de 2026: cuatro perfiles y credenciales comunes. Véase `docs/tipos-de-usuario.md` para contratos y migración; el PDF original conserva la versión de la entrega inicial.

| Entidad | Datos y restricciones principales |
|---|---|
| `identity.users` | UUID, correo único, nombre, contraseña scrypt, rol, deshabilitado y creación. El registro público permite turistas, guías pendientes y empresas/grupos; administración se crea por otra cuenta administradora |
| `identity.tourist_profiles` | Perfil de cliente/turista, vinculado a su cuenta |
| `identity.organization_profiles` | Empresa/grupo, nombre, tipo `company`/`group`, descripción y fecha de actualización |
| `identity.admin_profiles` | Perfil de administración, vinculado a su cuenta |
| `identity.guide_profiles` | Usuario, biografía, referencia de credencial privada, estado pendiente/verificado/rechazado y revisor |
| `trails.routes` | UUID independiente, autor lógico, ficha, MultiLineString, métricas, estado del sendero, advertencias, borrador/publicada, versión y contadores |
| `trails.route_visits` | Ruta, hash HMAC de cuenta/ruta y día local. Clave única de los tres campos |
| `trails.revisions` | Ruta, autor de propuesta, versión base, cambios JSON, decisión y razón. La versión obsoleta no se aprueba |
| `trails.activities` | Ruta, usuario, fecha declarada y `self_reported`. Restricción única usuario/ruta |
| `trails.comments` | Texto, autor, ubicación opcional y ocultación |
| `trails.reports` | Tipo, texto, Point obligatorio, estado y revisión administrativa |
| `trails.photos` | Archivo JPEG, autor, ruta, pie y ocultación; sin metadatos EXIF |
| `trails.outbox` | Evento UUID, ruta/versión únicas, payload público canónico y SHA-256 |
| `ledger.proofs` | Huella, proofId, transacción, bloque, red y dirección del contrato |

Inicio y llegada se derivan del primer y último punto ordenados del MultiLineString; no se almacenan copias que puedan divergir. La distancia es una suma horizontal de Haversine dentro de cada segmento; no une huecos. La altura procede solo del GPX y no se valida contra un DEM. Si falta elevación en un punto, ascenso y descenso quedan en `null`. El tiempo se estima como distancia/4 km/h más ascenso/600 m/h, redondeado hacia arriba; es orientativo y no modela aclimatación ni riesgos del terreno. La dificultad la declara el autor.

El importador admite tracks y routes GPX 1.0/1.1, hasta 5 MB y 100000 puntos. Descarta tiempos, datos de dispositivo y metadatos de personas; no conserva el GPX original. Los waypoints/POI y el perfil de alturas por punto quedan para una extensión. El área provisional es el rectángulo WGS84 `[-68.8,-17.3,-67.4,-15.6]`, no un límite administrativo ni una selección turística validada. Hay que acordar los lugares exactos y parametrizar el filtro antes del piloto.

### Ruta planificada, publicada y actividad

Un borrador es una preparación del autor, visible solo para él y administración. Una ruta publicada es la ficha pública reutilizable que otras personas consultan. Una actividad es la declaración de una cuenta de que completó esa ruta en una fecha: no se publica su fecha ni se transforma el GPX en un seguimiento personal. Todas las rutas publicadas son públicas; no se implementan rutas privadas ni compartición selectiva.

`completed_people` cuenta filas únicas de actividad por ruta. Repetir la llamada no suma otra persona; retirar la declaración elimina esa fila. Se identifica una cuenta, no se demuestra una persona física: varias cuentas pueden falsear la cifra y no hay prueba GPS. La interfaz debe decir «personas que declaran haberla completado» y mostrar «sin verificación GPS».

### Popularidad y revisión

El MVP cuenta una visita por cuenta/ruta/día en `America/La_Paz`, excluye al autor y no cuenta lecturas anónimas ni peticiones GET. Esta definición es un supuesto de implementación porque el usuario fijó el umbral pero no cómo medir visitas. Desde 201 visitas contabilizadas la ruta queda protegida de forma permanente. No equivale a 201 personas únicas acumuladas.

Solo el autor edita una ruta. Las rutas no populares se actualizan de inmediato. En una popular se crea una revisión pendiente; administración aprueba o rechaza con razón. Una aprobación exige que la versión base siga siendo vigente y no puede aprobarla la misma persona que propuso el cambio. Reportar peligros sigue siendo inmediato y no espera esa revisión. La verificación de guías y la modificación de rutas populares son las únicas aprobaciones previas previstas.

### Matriz de permisos

| Acción | Visitante | Turista | Guía | Empresa/grupo | Administración |
|---|---|---|---|---|---|
| Consultar rutas publicadas, fotos y reportes | Sí | Sí | Sí | Sí | Sí |
| Importar, preparar y publicar ruta propia | No | Sí | Sí | Sí | Sí |
| Editar ruta propia con hasta 200 visitas | No | Directo | Directo | Directo | Directo |
| Cambiar ruta propia con más de 200 visitas | No | Proponer | Proponer | Proponer | Otra persona aprueba |
| Editar rutas ajenas | No | No | No | No | Solo moderar visibilidad |
| Declarar finalización y consultar actividad propia | No | Sí | Sí | Sí | Sí |
| Añadir fotos, comentarios y reportes | No | Sí | Sí | Sí | Sí |
| Solicitar verificación profesional | No | Pasa a guía pendiente | Si pendiente/rechazado | No | No |
| Aprobar verificación y cambios populares | No | No | No | No | Sí, sin autoaprobación |
| Crear otra cuenta administradora | No | No | No | No | Sí |
| Editar perfil de empresa/grupo | No | No | No | Solo propio | No |

No hay aprobación previa de rutas nuevas, fotos, comentarios o advertencias. La moderación posterior puede ocultar contenido y cambiar un reporte de no verificado a confirmado, resuelto o descartado.

## 3.4 Contratos de API

Contrato ejecutable: `docs/openapi.json`; interfaz interactiva: `/docs`; colección: `docs/postman_collection.json`. Las rutas siguientes pertenecen a nuestra API; no se atribuyen a un proveedor GIS.

| Área | Operaciones principales |
|---|---|
| Autenticación | `POST /api/auth/register`, `POST /api/auth/login`, `GET/PATCH /api/users/me` |
| Perfiles | `GET /api/users/{id}`, `POST /api/guides/applications`, `PATCH /api/guides/me`, revisión administrativa |
| Rutas | `POST /api/routes/import-gpx`, `GET /api/routes`, `GET/PATCH /api/routes/{id}`, `POST .../publish` |
| Visitas | `POST /api/routes/{id}/visits`, con deduplicación |
| Actividades | `POST/DELETE /api/routes/{id}/completion`, `GET /api/my/activities` |
| Comunidad | `GET/POST .../comments`, `.../reports`, `.../photos`, `GET /api/photos/{id}/file` |
| Administración | Colas de guías, cambios y reportes; decisiones; ocultación y deshabilitación |
| Auditoría | `GET /api/routes/{id}/audit`, `GET /api/proofs/{proofId}` |

Ejemplo de importación, con JWT en `Authorization: Bearer TOKEN`:

```json
{
  "name": "Palca · ejemplo sintético",
  "description": "Solo demostración; no navegar",
  "difficulty": "moderate",
  "gpx_content": "<gpx>...contenido del archivo...</gpx>"
}
```

El ejemplo completo válido está en OpenAPI y `examples/palca-ilustrativo.gpx`. La API recibe el contenido UTF-8 del archivo en JSON para simplificar el cliente de demostración. El frontend futuro podrá ofrecer un selector de archivos que lea ese contenido.

La respuesta de importación contiene un `id`, `state: "draft"`, `version: 1`, `geometry.type: "MultiLineString"` y las métricas. Una declaración se envía como `{"completed_on":"2026-11-03"}`. La edición usa `{"name":"Nuevo nombre","expected_version":1}`; una ruta popular devuelve `{"state":"pending","revision_id":"UUID","route_version":1}`. Una revisión aprobada genera otra versión y otra huella.

Los GET no alteran contadores. POST devuelve 201 incluso en operaciones idempotentes y PATCH/DELETE devuelven 200 en este MVP. Los errores diferencian 401, 403, 404, 409, 422, 429 y 503; el parser GPX devuelve 400 a través del catálogo para un archivo no aceptado. Se devuelve `request_id` sin revelar errores internos SQL. Los listados de rutas usan `limit/offset`; las colecciones secundarias tienen límite de cien elementos y necesitarán paginación completa al crecer.

## 3.5 Fuentes GIS verificadas

**Mapa base** es la representación legible de calles, lugares y terreno. **Imagen satelital** muestra observación visual; no contiene por sí sola un grafo transitable. **Elevación/DEM** es una superficie numérica de alturas. **Red de caminos** son líneas y atributos que un motor puede convertir en un grafo. Importar un GPX solo carga un trazado: no comprueba que sea un sendero real ni calcula automáticamente otro recorrido.

### A. OpenStreetMap: mapa base

Cobertura global con datos comunitarios en Bolivia; calidad y actualización variables por zona. Datos ODbL, con atribución visible «© OpenStreetMap contributors» enlazada a la licencia. Las teselas públicas son un servicio limitado, sin SLA, sin descargas masivas y con caché y Referer adecuados. URL oficial: `https://tile.openstreetmap.org/{z}/{x}/{y}.png`. Sirve para dibujar/importar encima del mapa, pero las imágenes de teselas no permiten calcular rutas. Costo de datos: libre; alojamiento comercial o propio se presupuesta aparte. Para el piloto se debe comprobar cada sendero. Si se redistribuye una base derivada, se deben observar las obligaciones de compartir bajo ODbL; se mantendrá separado el origen de los datos OSM del contenido aportado por usuarios. [Licencia OSM](https://www.openstreetmap.org/copyright). Fuentes: [atribución OSM](https://osmfoundation.org/wiki/Attribution_Guidelines), [política de teselas](https://operations.osmfoundation.org/policies/tiles/).

### B. Red de caminos OSM: Overpass y Geofabrik

Overpass ofrece consulta de elementos y etiquetas como `highway=path`, `footway`, `track`, `access` y dificultad cuando existen. Endpoint documentado: `https://overpass-api.de/api/interpreter`, mediante POST de consultas Overpass QL. No es un motor de routing. El 3/11/2026 la consulta acotada de investigación devolvió HTTP 502 por capacidad: evidencia guardada en `evidence/overpass-probe.txt`. No se afirma haber validado la integridad local de la red. Uso público gratuito limitado y sin SLA; atribución y ODbL se heredan de OSM. [Overpass](https://wiki.openstreetmap.org/wiki/Overpass_API).

Geofabrik publica un extracto específico para Bolivia, con timestamp de datos y descarga PBF, además de diffs. Es una alternativa para preparar un grafo propio fuera del camino de lectura de la aplicación; costo de datos libre y costo de cómputo/almacenamiento propio. Ni Overpass ni un PBF calculan rutas automáticamente: necesitan un motor y validación de accesos, conexiones y cobertura de senderos. [Extracto Bolivia](https://download.geofabrik.de/south-america/bolivia.html).

### C. Esri ArcGIS Basemap Styles: satélite de visualización

Servicio mundial con estilo `arcgis/imagery`, sujeto a disponibilidad y detalle efectivo por lugar; no se promete una resolución ni fecha uniforme en La Paz. Requiere cuenta y token de ArcGIS. Base oficial: `https://basemapstyles-api.arcgis.com/arcgis/rest/services/styles/v2`; petición documentada: `/styles/arcgis/imagery`. Licencia de uso de Esri y atribución de Esri/proveedores según la capa, sin asumir permiso de redistribución u offline. La tarifa consultada de ArcGIS Location Platform incluye dos millones de teselas mensuales y luego USD 0,15 por mil; hay modalidad de sesiones distinta. Confirmar plan antes de activar. Actualización: mosaicos con fechas distintas; revisar metadatos del área. Sirve como fondo para trazado manual o GPX; no entrega una red de senderos. [Servicio, precios y atribución](https://developers.arcgis.com/rest/basemap-styles/).

### D. Copernicus Sentinel-2: imágenes científicas

Cobertura de superficies terrestres, incluida la región de La Paz, con bandas de hasta 10 m. Permite estudiar cambios y contexto territorial; esa resolución no garantiza distinguir un sendero estrecho. La fecha útil depende de adquisiciones, nubes y catálogo; no es imagen en tiempo real. Los datos Sentinel son de acceso libre y abierto conforme al aviso legal, con reconocimiento del origen y del procesamiento. Los servicios de procesamiento requieren cuenta/OAuth y tienen cuotas; la tabla consultada de CDSE indica 10000 solicitudes y 10000 unidades de procesamiento mensuales para usuarios generales de Sentinel Hub. Excedentes y procesamiento propio se evalúan aparte. No se implementa en el MVP ni calcula recorridos. Fuentes: [Sentinel-2](https://dataspace.copernicus.eu/explore-data/data-collections/sentinel-data/sentinel-2), [términos](https://dataspace.copernicus.eu/terms-and-conditions), [cuotas](https://documentation.dataspace.copernicus.eu/Quotas.html), [aviso de atribución](https://sentinels.copernicus.eu/documents/247904/690755/Sentinel_Data_Legal_Notice).

### E. SRTM 1 Arc-Second Global: elevación

Datos de la misión de febrero de 2000, con resolución aproximada de 30 m, WGS84 horizontal y alturas EGM96. La cobertura documentada incluye la latitud de La Paz, aunque deben comprobarse las celdas concretas, huecos y artefactos. Es un DEM histórico, no una medición de cambios actuales. Distribución abierta sin costo por EarthExplorer/NASA; se debe citar misión y producto y conservar condiciones del distribuidor. El muestreo, almacenamiento y procesamiento propios tienen costo. Aporta alturas y pendientes aproximadas, no imágenes de satélite ni conectividad transitable; no permite routing por sí solo. No está integrado: el MVP informa alturas del GPX o `null`. [Producto USGS](https://www.usgs.gov/centers/eros/science/usgs-eros-archive-digital-elevation-shuttle-radar-topography-mission-srtm-1/), [guía NASA de cobertura](https://www.earthdata.nasa.gov/s3fs-public/2025-05/SRTM_Quick_Guide.pdf).

### F. openrouteservice / HeiGIT: cálculo futuro

Es un motor basado en OSM y ofrece perfiles peatonales como `foot-hiking`; su utilidad en La Paz depende de la red realmente mapeada. El servicio público requiere clave y tiene plan estándar gratuito con límites que deben consultarse en la cuenta; también puede autoalojarse con costo de infraestructura. El dato de red conserva atribución OSM y se añaden las condiciones de HeiGIT; la licencia del software no sustituye las condiciones de la API. El esquema documenta `POST /v2/directions/{profile}/geojson`. La documentación actual identifica la base pública `https://api.heigit.org/openrouteservice`. Una comunicación de HeiGIT del 22/10/2026 anuncia el retiro de la URL anterior en noviembre: no se propone el endpoint antiguo. Actualización del grafo depende de sus importaciones, no de cada edición OSM inmediata. [API HeiGIT](https://api.heigit.org/), [cambio de URL](https://heigit.org/changes-in-the-openrouteservice-universe/), [contrato Directions](https://giscience.github.io/openrouteservice/v9.10.0/api-reference/endpoints/directions/requests-and-return-types).

### Decisión de integración

La demostración funcional depende únicamente de GPX, PostGIS y la red blockchain local. Las fuentes anteriores están investigadas y se proponen como adaptadores futuros, no como integraciones ejecutadas. Para la segunda fase: mapa OSM con proveedor adecuado, satélite Esri opcional, elevación DEM local y routing HeiGIT solo tras una prueba de cobertura. Dibujar manualmente será una herramienta del frontend que guarde GeoJSON; calcular sobre senderos requerirá el grafo/motor. Son funciones distintas y pueden coexistir.

Antes de habilitar una fuente se registrará proveedor, licencia, texto de atribución, fecha de datos, área, caché permitida, presupuesto y evidencia de prueba del área. No se copian rutas, fotografías ni reseñas de Wikiloc/AllTrails/Gaia.

## 3.6 Blockchain, privacidad y alcance de la prueba

El snapshot canónico incluye identificador de ruta, versión, ficha, geometría y métricas públicas. Las claves se ordenan recursivamente y los números se serializan con JSON; el algoritmo queda versionado como `schema_version:1`. La huella se calcula con SHA-256. `proofId` es SHA-256 de `routeId:version` y es independiente de la huella del contenido.

`RouteRegistry.sol` guarda `bytes32 digest`, timestamp de bloque, cuenta publicadora y un indicador `exists`. Solo su propietario puede registrar; la propiedad se transfiere con aceptación en dos pasos de OpenZeppelin. Una prueba no se sobrescribe. El ejemplo Solidity del PDF accede a `.exists` sin declararlo en su estructura; el contrato del proyecto sí declara ese campo y fue compilado y probado. [Control de acceso OpenZeppelin](https://docs.openzeppelin.com/contracts/5.x/access-control).

La transacción local usa chain ID 31337. El script `contract:deploy -- --sepolia` exige RPC y clave por variables de entorno, comprueba chain ID 11155111 y escribe manifiesto con dirección/recibo. Sepolia es la red recomendada para probar aplicaciones; el ETH de prueba no equivale a un pago de gas en dinero real. [Redes Ethereum](https://ethereum.org/developers/docs/networks).

No se guarda en la cadena el GPX original, correos, fotos, usuarios de actividades ni sus fechas. Un hash puede seguir vinculado a contenido público; no constituye anonimización perfecta. El backend, la publicación y la clave del registrador siguen bajo administración centralizada. La cadena aporta evidencia externa de integridad después de la confirmación, no verdad del reporte, seguridad física, autoría legal ni descentralización de toda la aplicación. Una modificación de un administrador de base puede detectarse contra la cadena, pero este MVP no elimina la posibilidad de modificar o ocultar datos fuera de cadena.

`/audit` compara con un recibo almacenado; `/proofs/{proofId}` consulta el contrato directamente. Para verificación independiente se necesita RPC/cliente ajeno al servidor y dirección/red publicadas. La EVM local es desechable y puede reiniciarse: no reemplaza la prueba pública requerida para la defensa.

## 3.7 Seguridad, privacidad y fotografías

Las contraseñas se almacenan con scrypt y sal aleatoria. El registro no acepta elegir rol. JWT expira a los quince minutos, las consultas SQL son parametrizadas y el gateway limita tráfico por IP. Los servicios internos, base, broker y RPC no publican puertos al host. La API local se liga a `127.0.0.1:8088`; el perfil opcional Caddy sirve TLS 1.3 con CA local en 8443. La confianza del certificado local requiere usar su CA; producción requiere un dominio y certificados adecuados.

Las actividades solo se consultan por su propietario. No hay seguimiento en vivo. Las coordenadas completas de las rutas publicadas son públicas: antes de subir un GPX real hay que revisar los extremos para no revelar un domicilio. El recorte automático queda pendiente y no se promete en esta fase. Los hashes de visitas son seudónimos, no anonimización absoluta; una política propuesta es conservarlos 90 días, manteniendo contadores agregados, pero la tarea de purga todavía no está implementada.

Las fotos admiten JPEG/PNG/WebP de hasta 5 MB y 25 megapíxeles; el servidor las decodifica, redimensiona y vuelve a codificar como JPEG sin EXIF, con identificadores generados. Se almacenan en un volumen local persistente y solo se sirven si la foto y la ruta siguen visibles. En staging se recomiendan almacenamiento de objetos, backups y credenciales de mínimo privilegio. La purga de archivos huérfanos, retirada por solicitud y límites de cuota por usuario se deberán cerrar antes de abrir un piloto público.

Los reportes aparecen como no verificados y admiten revisión posterior. La localización de comentarios/reportes se valida a menos de 250 m del trazado; esa proximidad no demuestra veracidad. Las credenciales de guías solo las ve administración y la propia cuenta. Deben definirse requisitos de acreditación y conservación documental antes de verificar personas reales.

## 3.8 Calidad, resiliencia y CI/CD

Las pruebas de integración ejecutan la API con PostgreSQL/PostGIS y el servicio GIS reales. Comprueban frontera 200/201, concurrencia de declaraciones, rechazo de edición ajena, revisiones obsoletas, visibilidad de borradores, localización de reportes y eliminación de EXIF. Los tests de Solidity ejecutan una EVM local y verifican recibos, autorización, duplicados y transferencia de propietario. Los tests de mensajería usan dobles para simular fallos y el script de demo verifica la cadena real local.

El gateway aplica timeout y circuit breaker por dependencia: abre tras cinco fallas de red/5xx y vuelve a probar después de quince segundos. Las lecturas del catálogo no dependen de imágenes ni de anclaje inmediato. Si falla RabbitMQ o el RPC, los eventos permanecen pendientes o vuelven a la cola; los mensajes con huella o identidad inválida van a una cola de fallos. El worker usa una cuenta publicadora y una sola secuencia de consumo; el escalado de firmantes/nonce es trabajo futuro.

La configuración GitHub Actions ejecuta comprobación estática, pruebas, construcción multietapa, integración instrumentada, demostración y publicación de evidencia. El job opcional de staging requiere secretos SSH, host y ruta con `.env` ya provisionado; no se ejecutó en una cuenta GitHub. El linter de esta entrega es la comprobación estricta TypeScript, no una auditoría de estilo o seguridad. El objetivo de producción requiere además análisis de dependencias, observabilidad, backups y restauración probada.

Los resultados exactos, versiones, alcance de carga y limitaciones están en `evidence/resumen-verificacion.md`. Ninguna cifra de ejemplo del PDF se presenta como medición de este proyecto.

## 3.9 Costos

| Rubro | Escenario y estimación | Estado |
|---|---|---|
| Demo local | USD 0 de contratación de servicios; utiliza equipo, conexión y energía existentes | Ejecutada sin contratar cloud |
| Desarrollo del MVP | Modelo presupuestario: 24-40 h × USD 8-15/h = USD 192-600 | Estimación, no factura ni tiempo real registrado |
| Cierre académico y despliegue | 16-32 h adicionales × USD 8-15/h = USD 128-480 | Depende de requisitos del docente y acceso a servicios |
| Host de staging | Reserva de USD 15-35/mes para una VM con memoria suficiente | Sin proveedor ni cotización elegidos |
| Backups y fotos | Reserva de USD 3-10/mes para bajo volumen | Depende de tamaño, retención y tráfico |
| Dominio | Reserva de USD 10-20/año | Opcional para la demo local |
| GIS | GPX propio sin tarifa; imágenes o mapas alojados según proveedor/consumo | No activados en el MVP |
| Sepolia y RPC | ETH de faucet sin valor comercial; reserva USD 0-10/mes para RPC si su plan gratuito resulta insuficiente | No desplegado |
| CI/CD | Dentro del plan aplicable o consumo adicional de la cuenta | No se asume disponibilidad ilimitada |

Las reservas no son precios vigentes de un proveedor ni una garantía de costo. No se copian los USD 85/mes ni el cargo de gas del ejemplo metodológico. Los microservicios académicos consumen más memoria que un monolito pequeño; antes de contratar se debe medir el conjunto y obtener una cotización concreta.

# Capítulo 4. Conclusiones y recomendaciones

## 4.1 Conclusiones vinculadas a objetivos

1. **Análisis:** se definieron actores, publicación pública, importación GPX, finalización manual única y el umbral de aprobación. La selección de rutas reales y la validación con guías continúan pendientes.
2. **Diseño:** se modelaron contextos, C4 1-4, persistencia espacial, permisos y API. El sistema conserva una instancia física de base y no se declara de alta disponibilidad.
3. **Desarrollo:** se construyó un prototipo con NestJS, Spring Boot, PostGIS, mensajería y un contrato probado en una EVM local. El frontend completo permanece fuera de alcance.
4. **Integración y despliegue:** se prepararon Docker y un pipeline; el despliegue público en Sepolia, la ejecución remota de CI/CD y staging no se han realizado. El objetivo todavía no está completo.
5. **Validación:** se obtuvieron resultados locales reproducibles sobre reglas críticas, cobertura y recibos. Las metas de producción se limitan a las evidencias disponibles; la carga y el costo se informan sin extrapolarlos a una infraestructura distinta.

## 4.2 Recomendaciones

Para el proyecto actual: cerrar pendientes de entrega académica, elegir y autorizar GPX reales, acordar el criterio de visitas, definir cómo verificar guías, fijar versiones de despliegue, comprobar restauración y completar privacidad antes del piloto. Mantener explícitas las etiquetas de datos declarados y no verificados.

Para trabajo futuro: mapa y editor reales, DEM, POI, validación de cobertura de caminos y routing, OAuth/OIDC, almacenamiento de objetos y separación física de bases cuando la carga lo justifique. Evaluar una red de segunda capa solo si hay una necesidad real de costo o volumen; no añadirla para la presentación inicial.

## Decisiones pendientes y supuestos

- Establecer la licencia y consentimiento del contenido aportado por usuarios: que una ruta sea pública no concede por sí solo derecho de redistribuir sus fotos o datos.
- Nombre provisional Altura Paz; no se verificó marca ni dominio.
- Selección territorial y GPX reales pendientes. El archivo incluido es sintético.
- Se interpreta «cualquiera publica» como cualquier cuenta activa; solo su autor puede editar.
- Se propone una visita autenticada por cuenta/ruta/día, excluyendo autor. Si se quieren visitas anónimas hará falta otra política.
- La protección popular es permanente desde 201 visitas; depurar visitas no la revierte.
- Los borradores son preparación privada; todas las rutas publicadas son públicas.
- Las actividades personales permanecen privadas y el total público cuenta cuentas, sin prueba GPS.
- La validación institucional de guías y la persona encargada de moderar no están definidas.
- El uso literal de MongoDB, Spring Cloud/Eureka o Kafka debe contrastarse con el docente si se exige además de los objetivos de arquitectura; no se añaden sin una función concreta.
- Sepolia, GitHub, staging, video e informes requieren evidencia adicional y no están completados por el prototipo local.

## Matriz de cumplimiento del perfil

| Requisito | Evidencia o ubicación | Situación |
|---|---|---|
| Cap. 1: contexto, antecedentes, problema, objetivos y límites | Este documento, secciones 1.1-1.7 | Preparado; diagnóstico de campo pendiente |
| Comparativa de al menos 2-3 alternativas | Wikiloc, AllTrails y Gaia GPS con fuentes oficiales | Preparada |
| Marco teórico con justificación de tecnologías | Capítulo 2 | Preparado para revisión académica |
| Historias Gherkin y RNF | Sección 3.1 | Preparados |
| C4 obligatorio | `docs/arquitectura.md`, niveles 1-4 | Preparado |
| Modelo de datos y DDL/DML | `db/`, `examples/`, script demo | Ejecutable |
| Microservicios, JWT, Gateway y descubrimiento | NestJS/Spring, HTTP/JWT y DNS Docker | Local ejecutado |
| Mensajería desacoplada y circuit breaker | Outbox, RabbitMQ y `ResilientHttp` | Local ejecutado/probado |
| SHA-256 y Smart Contract | `RouteRegistry.sol`, ABI, tests y recibo EVM local | Local ejecutado |
| Contrato en Sepolia | Script y variables documentadas | Pendiente de despliegue real |
| Cobertura mayor al 75% | Jest y JaCoCo, con umbral en configuración | Véase evidencia medida |
| Menos de 200 ms y 1000 req/s | Escenario k6 reproducible | Véase evidencia; no asumir meta cumplida |
| TLS 1.3 | Perfil Caddy local opcional | Validación local documentada; dominio público pendiente |
| Docker y CI/CD cloud | Dockerfiles multietapa y workflow | Build local; ejecución remota pendiente |
| Colección Postman | `docs/postman_collection.json` | Preparada |
| Código en GitHub | Código y archivos de repositorio | Publicación remota pendiente |
| Video de diez minutos | `docs/guion-demo.md` | Guion preparado; grabación pendiente |
| Informe de costos | Sección 3.9 | Escenarios estimados, sin contratación |
| Informes de suficiencia y aprobación del perfil | Tutor, panelista y relator | Trámite académico pendiente |

Las instrucciones del PDF se usan como criterios de evaluación del proyecto, no como evidencia de hechos ni como autorización para publicar en servicios externos sin acceso y configuración. La matriz distingue implementación, configuración y resultado medido.
