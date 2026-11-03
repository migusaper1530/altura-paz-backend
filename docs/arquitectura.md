# Diagramas de arquitectura de Altura Paz

Los diagramas describen el prototipo local. Las integraciones externas GIS se investigaron y no forman parte del camino crítico de la demo. La vista de frontend es conceptual.

## C4 nivel 1: contexto

```mermaid
flowchart LR
  H["Senderista"] -->|Explorar, importar GPX y declarar actividad| S["Altura Paz · sistema web GIS"]
  G["Guía"] -->|Gestionar rutas propias y perfil| S
  A["Administrador"] -->|Verificar guías, aprobar cambios populares y moderar| S
  S -->|Registrar huellas; EVM local en demo| E["Registro Ethereum · Sepolia pendiente"]
  S -.->|Cartografía, imágenes y elevación · futura interfaz| GIS["Proveedores GIS externos"]
```

## C4 nivel 2: contenedores

```mermaid
flowchart TB
  API["Cliente de demostración · OpenAPI / Postman / script"] --> GW
  VIEW["Vista conceptual · no frontend completo"] -.-> GW
  subgraph LOCAL["Altura Paz · Docker Compose"]
    TLS["Caddy opcional · TLS 1.3"] --> GW["API Gateway · NestJS"]
    GW -->|HTTP y JWT| ID["Identidad · NestJS"]
    GW -->|HTTP y JWT| RT["Rutas y comunidad · NestJS"]
    GW -->|Consulta de huellas| AU["Auditoría · NestJS + ethers"]
    RT -->|XML GPX / JSON| GP["Procesamiento GIS · Spring Boot / Java 17"]
    ID --> IDDB[("PostgreSQL · esquema identity")]
    RT --> RTDB[("PostGIS · esquema trails")]
    RT --> MEDIA[("Volumen de fotos · JPEG sin EXIF")]
    RTDB -->|Outbox transaccional| PUB["Publicador outbox · proceso de Rutas"]
    PUB -->|AMQP · confirmación| MQ["RabbitMQ · cola durable + cola de fallos"]
    MQ --> AU
    AU --> AUD[("PostgreSQL · esquema ledger")]
    RT -.->|Solo lectura de recibos| AUD
    AU -->|JSON-RPC| EVM["EVM local · Ganache · chain 31337"]
  end
  EVM -.->|Migración con credenciales propias| SEP["Sepolia · chain 11155111"]
```

Los tres esquemas comparten una instancia física de PostgreSQL con credenciales distintas. No hay alta disponibilidad ni aislamiento físico entre bases en este MVP. El catálogo tiene permiso de lectura sobre los recibos del ledger; una futura API o proyección de eventos eliminará ese acoplamiento. Docker DNS resuelve nombres de servicio y cumple el descubrimiento básico; no se instala Eureka.

## C4 nivel 3: componentes del catálogo

```mermaid
flowchart LR
  C["TrailsController · HTTP"] --> U["TrailsUseCases · reglas y validación"]
  U --> P["TrailsPort · contrato abstracto"]
  R["TrailsRepository · SQL y PostGIS"] -.->|Implementa| P
  R --> D["Database · pool y transacciones"]
  R --> H["ResilientHttp · timeout y circuit breaker"]
  D --> PG[("PostGIS")]
  H --> GIS["GpxController → GpxService · Spring"]
  U --> POL["Políticas de autoría, estado, versión y conteo"]
  R --> OB["Outbox dentro de la transacción"]
  OB --> PUB["OutboxPublisher → RabbitMQ"]
```

Los controllers delegan en casos de uso. Las sentencias SQL están en los adaptadores de persistencia. Se aplica inversión de dependencias mediante puertos abstractos. Los puertos de esta primera versión son pequeños y genéricos; conviene sustituir los comandos con nombre por métodos tipados de dominio al crecer el equipo.

## C4 nivel 4: clases y contrato

```mermaid
classDiagram
  class TrailsController { +import(body, token) +publish(routeId, token) +edit(routeId, body, token) }
  class TrailsUseCases { +import() +publish() +edit() +complete() +revisionReview() }
  class TrailsPort { <<abstract>> +execute() +transaction() +route() +parse() +anchor() }
  class TrailsRepository { +execute() +route() +apply() +anchor() }
  class Database { +pool +tx() }
  class LedgerService { +connect() +anchor(event) +live(proofId) }
  class RouteRegistry { +owner() +proofs(bytes32) +register(bytes32,bytes32) }
  class GpxController { +parse(xml) }
  class GpxService { +parse(xml) }
  TrailsController --> TrailsUseCases
  TrailsUseCases --> TrailsPort
  TrailsRepository --|> TrailsPort
  TrailsRepository --> Database
  GpxController --> GpxService
  TrailsRepository ..> GpxController : HTTP
  LedgerService ..> RouteRegistry : JSON-RPC
```

## Modelo de persistencia

```mermaid
erDiagram
  USERS ||--o| GUIDE_PROFILES : solicita
  USERS ||..o{ ROUTES : autor_logico
  ROUTES ||--o{ REVISIONS : cambia
  ROUTES ||--o{ ROUTE_VISITS : recibe
  ROUTES ||--o{ ACTIVITIES : completada
  ROUTES ||--o{ COMMENTS : contiene
  ROUTES ||--o{ REPORTS : recibe
  ROUTES ||--o{ PHOTOS : ilustra
  ROUTES ||--o{ OUTBOX : publica_version
  OUTBOX ||..o| PROOFS : genera_recibo
```

Las líneas lógicas entre contextos no son claves foráneas entre esquemas. Dentro de cada contexto sí se utilizan claves y restricciones SQL. El DDL exacto está en `db/001-schema.sql`.
