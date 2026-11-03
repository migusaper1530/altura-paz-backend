-- SOLO DEMOSTRACIÓN: psql -v route_id='UUID_DE_UNA_RUTA_SINTETICA' -f examples/seed-boundary.sql
-- Inserta visitas ficticias para demostrar la frontera. Nunca presentarlas como tráfico real.
BEGIN;
INSERT INTO trails.route_visits(route_id,visitor_hash,day)
SELECT id, 'fixture-manual-' || n, (now() AT TIME ZONE 'America/La_Paz')::date
FROM trails.routes CROSS JOIN generate_series(1,201) AS n
WHERE id=:'route_id'::uuid AND description ILIKE '%sintético%'
ON CONFLICT DO NOTHING;
UPDATE trails.routes SET views=(SELECT count(*) FROM trails.route_visits WHERE route_id=routes.id),
popular=(popular OR (SELECT count(*) FROM trails.route_visits WHERE route_id=routes.id)>200)
WHERE id=:'route_id'::uuid AND description ILIKE '%sintético%';
COMMIT;
