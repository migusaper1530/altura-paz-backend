# Altura Paz · backend demostrable

Repositorio: [migusaper1530/altura-paz-backend](https://github.com/migusaper1530/altura-paz-backend). [Ejecuciones de CI](https://github.com/migusaper1530/altura-paz-backend/actions).

MVP académico para importar GPX y publicar rutas alrededor de La Paz. Incluye API, cuatro tipos de cuenta, PostGIS, procesamiento GPX en Spring Boot, aprobación de cambios populares, finalizaciones manuales únicas y pruebas de versiones en una EVM local.

El frontend permite explorar el mapa, gestionar la cuenta, importar/publicar GPX y registrar actividades. La vista de diseño utiliza datos de ejemplo identificados. El GPX incluido es **sintético y no sirve para navegar**. La ejecución local no equivale a haber desplegado el contrato en Sepolia ni a una defensa académica terminada.

## Empezar

Se necesitan Docker con Compose y Node.js 24. En el equipo donde se preparó la entrega ya están disponibles. Abre una terminal en esta carpeta y ejecuta:

```bash
bash iniciar.sh
```

El primer arranque descarga dependencias e imágenes. Después abre:

- Sitio web conectado a la API: <http://localhost:8088>
- Vista de diseño con rutas de ejemplo: <http://localhost:8088/?demo=1>
- API interactiva: <http://localhost:8088/docs>
- Contrato de API: <http://localhost:8088/openapi.json>

El script crea configuración local, arranca los servicios y ejecuta la demostración. Registra dos cuentas de ejemplo, importa/publica un GPX, comprueba el conteo único y contrasta la huella con el contrato local. Guarda resultados en `evidence/demo-result.json` sin guardar tokens ni contraseñas.

Para repetir solo la demostración:

```bash
npm run demo
```

Cada ejecución añade datos sintéticos nuevos. No borra rutas existentes. La contraseña de las cuentas sintéticas se define en el script; las credenciales de administración se generan por separado y están en `.env`. Ese archivo es privado, se conserva entre arranques y está excluido del ZIP y Git. La carpeta local entregada puede contener su configuración ya generada para continuar la demo existente. El ZIP es código para una instalación nueva; no reemplaces la configuración de una base persistente con secretos nuevos.

Para parar sin borrar la base ni fotografías:

```bash
docker compose down
```

## Frontend

El sitio se sirve desde el gateway, en el mismo origen que la API. Incluye búsqueda y filtros, mapa Leaflet/OpenStreetMap, fichas de rutas, registro/inicio de sesión, edición de perfiles, importación GPX a borrador, publicación/edición de rutas propias, finalizaciones manuales, comentarios y fotos. Administración tiene revisión de guías y cambios populares, además de alta de administradores. El diseño funciona en escritorio y móvil.

Para revisar **solo el diseño** sin arrancar Docker:

```bash
npm run frontend:preview
```

Abre <http://localhost:8090/?demo=1>. El modo de ejemplo solo permite explorar y revisar formularios: no crea usuarios ni guarda actividades. Para utilizar la API real, arranca el proyecto y abre <http://localhost:8088> sin `demo=1`. La vista previa estática termina con Ctrl+C.

Los JWT se conservan solo en memoria de la pestaña y caducan a los quince minutos. Recargar o cerrar la pestaña requiere ingresar de nuevo. La ubicación se solicita solo al pulsar su control, se muestra localmente y no se envía a la API. No hay descargas de teselas para uso sin conexión. Las fotografías de paisaje y las fuentes se incluyen localmente con sus créditos y licencias en `public/assets/`; la cartografía requiere conexión.

Código de interfaz: `public/index.html`, `public/app.css`, `public/app.mjs` y `public/ui.mjs`. No requiere una compilación frontend ni nuevas dependencias del backend. Decisiones visuales: `docs/frontend-diseno.md`.

## Tipos de usuario

Cada cuenta tiene un tipo y un perfil propio:

| Tipo | Valor de `role` | Tabla de perfil |
|---|---|---|
| Cliente o turista | `tourist` | `identity.tourist_profiles` |
| Guía | `guide` | `identity.guide_profiles` |
| Empresa o grupo | `organization` | `identity.organization_profiles` |
| Administrador | `admin` | `identity.admin_profiles` |

`identity.users` conserva el correo único, la contraseña y el nombre compartidos. En una empresa o grupo, `organization_type` distingue `company` y `group`. El registro público acepta turistas, guías y organizaciones. Los guías empiezan pendientes de verificación; esa condición es independiente del tipo de cuenta. Solo otro administrador puede crear administradores mediante `POST /api/admin/users`.

El servicio `migrate` aplica automáticamente `db/migrations/003-user-types.sql` antes de arrancar identidad. Conserva IDs, contraseñas, rutas y revisiones de las bases anteriores; convierte `hiker` en `tourist` y las solicitudes existentes en cuentas de guía con su estado anterior. Puede repetirse. Para actualizar una instalación basta ejecutar `docker compose up -d --build`; no elimines los volúmenes ni regeneres `.env`.

Ejemplos de registro para turista, guía, empresa y grupo, permisos y endpoints: [docs/tipos-de-usuario.md](docs/tipos-de-usuario.md). En `/docs`, el registro incluye un selector de ejemplos para turista, guía, empresa y grupo.

## Utilizar la API sin programar

1. Abre `/docs` y despliega `POST /api/auth/register`.
2. Pulsa **Try it out**, escribe correo de prueba, nombre y contraseña de al menos doce caracteres y ejecuta.
3. Copia `access_token` de la respuesta. En **Authorize**, pega el token, sin añadir la palabra Bearer.
4. Abre `POST /api/routes/import-gpx`: el ejemplo ya contiene un GPX completo sintético. Ejecuta y copia su `id`.
5. Usa ese UUID en `POST /api/routes/{routeId}/publish`.
6. Consulta `GET /api/routes/{routeId}` y declara la finalización con `POST .../completion` usando una fecha no futura.
7. Consulta `/audit`; cuando exista un recibo, copia `proof_id` a `GET /api/proofs/{proofId}` para comprobar la huella en la EVM local.

El token vence a los quince minutos. Para continuar utiliza `/api/auth/login` y autoriza el token nuevo. Para probar administración inicia sesión con el correo/contraseña de `.env`. No subas ese archivo a un repositorio.

También puedes importar `docs/postman_collection.json` en Postman; completa variables `email/password`, usa Login y el script de esa petición guardará el token. Los placeholders `{routeId}` y similares se completan con los UUID devueltos por la API.

## Qué hace cada servicio

| Servicio | Responsabilidad |
|---|---|
| gateway | API pública, estado de cuenta, límite de tráfico, caché de listados, timeout y circuit breaker |
| identity | Cuentas, JWT, perfil y verificación administrativa de guías |
| trails | Rutas, revisiones, visitas, actividades, comentarios, reportes, fotos y outbox |
| gis | Spring Boot/Java 17: XML GPX seguro, segmentos, distancia y elevación |
| ledger | Consumir eventos y registrar/comprobar huellas con ethers y Solidity |
| db / rabbit / chain | PostgreSQL/PostGIS, cola durable y EVM de prueba local |
| tls, opcional | Caddy con TLS 1.3 y CA local |

Solo el gateway publica un puerto de API en el equipo. Base, broker y RPC permanecen en la red Docker. El perfil de TLS publica además el puerto local 8443.

## Reglas que se deben mostrar en la presentación

- Todos los recorridos publicados son públicos; el borrador previo solo es visible para autor y administración.
- Cualquier cuenta activa publica. Solo el autor edita; desde 201 visitas sus cambios requieren revisión de otra persona administradora.
- Una visita es una cuenta/ruta/día en La Paz, excluye al autor y no incluye tráfico anónimo. No se incrementa al consultar un GET.
- Las finalizaciones cuentan cuentas distintas y son declaraciones manuales sin prueba GPS. La actividad individual es privada.
- Reportes y fotos se publican sin aprobación previa, con moderación posterior. El estado inicial de un reporte es no verificado.
- El listado público anónimo tiene caché interna de un segundo. Las escrituras exitosas invalidan esa caché en el gateway. El detalle, permisos y decisiones no se sirven de esa caché.
- El anclaje blockchain es asíncrono: publicar funciona aunque la prueba tarde en confirmarse.

## Ejecutar pruebas

Con los servicios arrancados:

```bash
docker compose run --rm qa npm run test:coverage
docker compose run --rm qa npm run contract:test
```

Las pruebas de integración utilizan PostgreSQL/PostGIS y GIS reales. Añaden datos con identificadores de prueba y no borran otras rutas. La cobertura de Node se escribe en `evidence/coverage-node/`. Los tests Java y su umbral JaCoCo se ejecutan al construir GIS:

```bash
docker compose build gis
```

Para ejecutar comprobación estática en el host se requiere instalar las dependencias con `npm ci` y ejecutar `npm run lint`. El código fija un umbral superior al 75% en Jest y JaCoCo. Consulta los resultados medidos incluidos en `evidence/resumen-verificacion.md`.

El escenario de carga está en `test/load.js`; `scripts/carga.sh` ejecuta la carga controlada con el límite por IP ampliado temporalmente, espera a que la API esté lista y restaura la configuración al terminar. La prueba modifica/recrea el gateway local brevemente; ejecútala fuera de una demostración interactiva.

```bash
bash scripts/carga.sh
```

El resultado corresponde a un listado público repetido, con caché, pocos datos y quince segundos de carga local. No acredita 1000 escrituras/segundo, ni 1000 importaciones GPX, ni disponibilidad cloud.

## TLS 1.3 local

```bash
docker compose --profile tls up -d tls
docker compose exec -T tls cat /data/caddy/pki/authorities/local/root.crt > local-ca.crt
curl --cacert local-ca.crt --tlsv1.3 --tls-max 1.3 https://localhost:8443/health
```

La CA es local; el navegador no la confiará automáticamente. No instales claves ni certificados sin entender su alcance. Para cloud se configura un dominio y una CA pública; esa configuración no se ha desplegado. No se incluye ninguna clave privada de Caddy en la entrega.

## Sepolia: preparado, pendiente de despliegue

`RouteRegistry.sol` sí compila y se prueba localmente. Para desplegarlo en Sepolia necesitas tu RPC, una wallet dedicada y ETH de prueba. Introduce secretos mediante variables de entorno de tu entorno de trabajo; no los escribas en el código, capturas ni Git.

Con `SEPOLIA_RPC_URL` y `SEPOLIA_PRIVATE_KEY` configurados, y tras `npm ci`:

```bash
npm run contract:deploy -- --sepolia
```

El script comprueba chain ID 11155111 y escribe `deployments/sepolia.json` con dirección y recibo públicos. Para que el worker use esa red hay que cambiar su RPC, manifiesto y firmante; no basta con desplegar el contrato. El Compose incluido sigue apuntando a la EVM local.

## Entregables y pendientes

- Perfil técnico con capítulos 1-4: `docs/propuesta-tecnica.md`.
- C4 1-4, clases y relaciones: `docs/arquitectura.md` y figuras.
- Contratos de API y colección Postman: `docs/`.
- DDL, credenciales por servicio y ejemplo de DML: `db/`, `examples/` y `scripts/demo.mjs`.
- Contrato inteligente, despliegue y pruebas: `contracts/`, `scripts/` y `test/`.
- Evidencia de demo, cobertura, carga, TLS y consulta GIS: `evidence/`.
- Guion de diez minutos: `docs/guion-demo.md`; el video aún no se ha grabado.
- Pipeline: `.github/workflows/ci.yml`; las ejecuciones remotas se consultan en GitHub Actions. El despliegue en nube requiere configurar staging y ejecutarlo de forma manual.

Quedan pendientes Sepolia, staging público, video, aprobación académica y GPX reales autorizados. La evidencia local y la propuesta conservan el estado de su fecha de elaboración; el estado actual de CI se consulta en GitHub Actions.
