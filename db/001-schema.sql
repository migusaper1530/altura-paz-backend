CREATE EXTENSION IF NOT EXISTS postgis;
CREATE SCHEMA identity;
CREATE SCHEMA trails;
CREATE SCHEMA ledger;

CREATE TABLE identity.users (
 id uuid PRIMARY KEY, email text UNIQUE NOT NULL, password_hash text NOT NULL,
 name text NOT NULL, role text NOT NULL DEFAULT 'hiker' CHECK(role IN ('hiker','guide','admin')),
 disabled boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE identity.guide_profiles (
 user_id uuid PRIMARY KEY REFERENCES identity.users(id), bio text NOT NULL,
 credential_reference text NOT NULL, status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','verified','rejected')),
 reviewed_by uuid REFERENCES identity.users(id), reviewed_at timestamptz,
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE trails.routes (
 id uuid PRIMARY KEY, author_id uuid NOT NULL, name text NOT NULL, description text NOT NULL,
 geometry geometry(MultiLineString,4326) NOT NULL,
 distance_m double precision NOT NULL CHECK(distance_m>=0), ascent_m double precision, descent_m double precision,
 estimated_minutes integer NOT NULL, difficulty text NOT NULL CHECK(difficulty IN ('easy','moderate','hard')),
 elevation_source text NOT NULL, trail_status text NOT NULL DEFAULT 'unknown' CHECK(trail_status IN ('unknown','open','caution','closed')),
 warnings text NOT NULL DEFAULT '', state text NOT NULL DEFAULT 'draft' CHECK(state IN ('draft','published')),
 version integer NOT NULL DEFAULT 1, views integer NOT NULL DEFAULT 0,
 popular boolean NOT NULL DEFAULT false, hidden boolean NOT NULL DEFAULT false,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX routes_geometry_gix ON trails.routes USING gist(geometry);
CREATE INDEX routes_public_idx ON trails.routes(created_at DESC) WHERE state='published' AND NOT hidden;
CREATE TABLE trails.route_visits (
 route_id uuid NOT NULL REFERENCES trails.routes(id), visitor_hash text NOT NULL, day date NOT NULL,
 PRIMARY KEY(route_id,visitor_hash,day)
);
CREATE TABLE trails.revisions (
 id uuid PRIMARY KEY, route_id uuid NOT NULL REFERENCES trails.routes(id), proposed_by uuid NOT NULL,
 base_version integer NOT NULL, payload jsonb NOT NULL,
 state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','approved','rejected')),
 reviewed_by uuid, reason text, created_at timestamptz NOT NULL DEFAULT now(), reviewed_at timestamptz
);
CREATE TABLE trails.activities (
 id uuid PRIMARY KEY, route_id uuid NOT NULL REFERENCES trails.routes(id), user_id uuid NOT NULL,
 completed_on date NOT NULL, verification text NOT NULL DEFAULT 'self_reported' CHECK(verification='self_reported'),
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(route_id,user_id)
);
CREATE TABLE trails.comments (
 id uuid PRIMARY KEY, route_id uuid NOT NULL REFERENCES trails.routes(id), user_id uuid NOT NULL,
 body text NOT NULL, location geometry(Point,4326), hidden boolean NOT NULL DEFAULT false,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE trails.reports (
 id uuid PRIMARY KEY, route_id uuid NOT NULL REFERENCES trails.routes(id), user_id uuid NOT NULL,
 category text NOT NULL CHECK(category IN ('obstacle','closure','hazard','content')),
 body text NOT NULL, location geometry(Point,4326) NOT NULL,
 status text NOT NULL DEFAULT 'unverified' CHECK(status IN ('unverified','confirmed','resolved','dismissed')),
 reviewed_by uuid, reason text, created_at timestamptz NOT NULL DEFAULT now(), reviewed_at timestamptz
);
CREATE TABLE trails.photos (
 id uuid PRIMARY KEY, route_id uuid NOT NULL REFERENCES trails.routes(id), user_id uuid NOT NULL,
 storage_key text UNIQUE NOT NULL, caption text NOT NULL, hidden boolean NOT NULL DEFAULT false,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE trails.outbox (
 id uuid PRIMARY KEY, route_id uuid NOT NULL, version integer NOT NULL, proof_id text UNIQUE NOT NULL,
 digest text NOT NULL, payload jsonb NOT NULL, sent_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(route_id,version)
);
CREATE TABLE ledger.proofs (
 event_id uuid PRIMARY KEY, route_id uuid NOT NULL, version integer NOT NULL, proof_id text UNIQUE NOT NULL,
 digest text NOT NULL, transaction_hash text NOT NULL, block_number bigint NOT NULL,
 chain_id bigint NOT NULL, contract_address text NOT NULL, anchored_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(route_id,version)
);
-- Credenciales por servicio, con mínimos privilegios. El usuario de inicialización es exclusivo de migraciones.
CREATE ROLE altura_identity LOGIN;
CREATE ROLE altura_trails LOGIN;
CREATE ROLE altura_ledger LOGIN;
GRANT USAGE ON SCHEMA identity TO altura_identity;
GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA identity TO altura_identity;
GRANT USAGE ON SCHEMA trails TO altura_trails;
GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA trails TO altura_trails;
GRANT USAGE ON SCHEMA ledger TO altura_ledger;
GRANT SELECT,INSERT ON ALL TABLES IN SCHEMA ledger TO altura_ledger;
-- El catálogo consulta solo pruebas, no escribe en el esquema del worker.
GRANT USAGE ON SCHEMA ledger TO altura_trails;
GRANT SELECT ON ledger.proofs TO altura_trails;
