-- Se aplica tanto a instalaciones nuevas como a bases existentes, sin borrar cuentas.
BEGIN;
SELECT pg_advisory_xact_lock(215003);
CREATE TABLE IF NOT EXISTS identity.schema_migrations (
 version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now()
);
DO $migration$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM identity.schema_migrations WHERE version='003-user-types') THEN
  ALTER TABLE identity.users DROP CONSTRAINT users_role_check;
  UPDATE identity.users SET role='tourist' WHERE role='hiker';
  -- Una solicitud existente sigue conservando su estado y sus credenciales.
  UPDATE identity.users u SET role='guide'
   WHERE u.role='tourist' AND EXISTS (SELECT 1 FROM identity.guide_profiles g WHERE g.user_id=u.id);
  ALTER TABLE identity.users ALTER COLUMN role SET DEFAULT 'tourist';
  ALTER TABLE identity.users ADD CONSTRAINT users_role_check
   CHECK(role IN ('tourist','guide','organization','admin'));

  CREATE TABLE identity.tourist_profiles (
   user_id uuid PRIMARY KEY REFERENCES identity.users(id)
  );
  CREATE TABLE identity.organization_profiles (
   user_id uuid PRIMARY KEY REFERENCES identity.users(id),
   organization_name text NOT NULL CHECK(length(btrim(organization_name)) BETWEEN 1 AND 150),
   organization_type text NOT NULL CHECK(organization_type IN ('company','group')),
   description text NOT NULL DEFAULT '' CHECK(length(description)<=2000),
   updated_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE TABLE identity.admin_profiles (
   user_id uuid PRIMARY KEY REFERENCES identity.users(id)
  );
  INSERT INTO identity.tourist_profiles(user_id) SELECT id FROM identity.users WHERE role='tourist';
  INSERT INTO identity.admin_profiles(user_id) SELECT id FROM identity.users WHERE role='admin';
  GRANT SELECT,INSERT,UPDATE,DELETE ON identity.tourist_profiles,
   identity.organization_profiles,identity.admin_profiles TO altura_identity;
  INSERT INTO identity.schema_migrations(version) VALUES('003-user-types');
 END IF;
END
$migration$;
COMMIT;
