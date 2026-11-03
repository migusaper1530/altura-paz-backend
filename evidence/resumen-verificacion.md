# Resultados medidos

Ejecución local del 3 de noviembre de 2026. Hora de cierre en La Paz: 10:48:50. Datos de prueba sintéticos. La ejecución remota de GitHub Actions y la red Sepolia no se realizaron.

## Pruebas y cobertura

| Componente | Resultado | Alcance |
|---|---|---|
| Node / NestJS | 31 pruebas aprobadas; cinco suites | Unitarias, errores, caché, mensajería con dobles e integración HTTP con PostgreSQL/PostGIS y GIS reales |
| Cobertura Node | 96.31% sentencias; 84.12% ramas; 96.25% funciones; 96.78% líneas | Incluye todo src; no excluye archivos para elevar el resultado |
| Java / Spring Boot | 11 pruebas aprobadas; 97.37% líneas (74/76) | Parser GPX, segmentos, datos faltantes, XML malicioso y errores geográficos |
| Solidity | 5 pruebas aprobadas | Compilación y EVM real local; recibos, propietario, duplicados y cambio de propietario |
| Demo integrada | Diez pasos completados y prueba consultada en cadena | Importar, publicar, declarar dos veces sin duplicar y comprobar SHA-256 |
| TLS | TLS 1.3 negociado con certificado validado; TLS 1.2 rechazado | Caddy y CA local; no certificado público de cloud |

Jest y JaCoCo contienen puertas de cobertura de al menos 76%, superior al mínimo de la guía. Una cobertura alta no demuestra ausencia de defectos ni sustituye revisión de código o pruebas de campo.

## Carga: comparación antes y después

| Medida | Sin caché | Con caché de un segundo |
|---|---|---|
| Oferta | 1000 solicitudes/s, 15 s | 1000 solicitudes/s, 15 s |
| Respuestas completadas | 14499 | 15001 |
| Tasa observada | 962.82/s | 999.99/s |
| Percentil 95 | 228.884 ms | 0.757 ms |
| Solicitudes descartadas por el generador | 502 | 0 |
| Fracción de errores HTTP | 0.0000 | 0.0000 |
| Umbrales del escenario | No aprobados | Aprobados |

La prueba final cumplió los umbrales definidos: p95 menor a 200 ms, menos del 1% de errores y cero iteraciones descartadas, con oferta de 1000 solicitudes/segundo. Se repitió el mismo listado público anónimo en la red Docker local, con pocos datos y caché. No acredita esa capacidad para consultas variadas, escrituras, GPX grandes, carga sostenida o despliegue cloud. Se amplió temporalmente el límite por IP a 1000000/min para medir el servidor y después se restauró el valor normal de 600/min.

El primer intento de carga baja tras recrear el gateway tuvo errores durante su arranque; se conserva `k6-demo.json`. El script reproducible espera disponibilidad antes de generar tráfico. Los resultados sin caché y con caché se conservan por separado; no se sustituyó el fracaso inicial por una afirmación de éxito general.

## Recibo de la demostración

- Ruta sintética: `fdb229e8-b843-4106-a34f-8abecef4efee`.
- Versión: 1.
- Red: EVM local, chain ID 31337; no Sepolia.
- Contrato: `0xe78A0F7E598Cc8b0Bb87894B0F60dD2a88d6a8Ab`.
- Transacción: `0x61e2626fc4bea5cf495228cc14de0919d30e5d14f59d90b2380acabf1d7b962f`.
- SHA-256: `0xa625ce8396b1f32bd44489cd37e68f68e6b54894bc3fa01940d647a16893503a`.
- Distancia calculada: 3026.6 m; ascenso: 240 m; estimación: 70 minutos.
- Personas declaradas: una, aunque se enviaron dos solicitudes de finalización.

`demo-result.json` y `demo-transcript.txt` registran la ejecución sin tokens ni contraseñas. La dirección y el recibo pertenecen a una cadena local persistida en Docker; no tienen un explorador público ni valor probatorio independiente si se elimina esa red.

## Verificación GIS y límites

Las fuentes se contrastaron con documentación oficial, enlaces y licencias indicadas en la propuesta. Una consulta acotada real a Overpass recibió HTTP 502 por capacidad. No se afirma que se haya comprobado la cobertura completa de senderos de La Paz ni se descargaron datos masivos. La demo importa un GPX sintético y no requiere ninguna fuente GIS externa.

## Estado de entrega académica

Código, API, DDL, C4 1-4, contrato local, Postman, pruebas y costos están preparados. Quedan pendientes la prueba real en Sepolia, publicación de repositorio, CI/CD remoto, staging público, video de diez minutos, diagnóstico con guías y aprobaciones académicas. El guion y la configuración no se presentan como evidencia de ejecución de esos puntos.
