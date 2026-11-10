import { INestApplication } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Pool } from "pg";
import { createApplication } from "../src/main";
import { passwordHash } from "../src/core";

const suite = process.env.TEST_DB_PASSWORD ? describe : describe.skip;
suite("cuatro tipos de cuenta y migración de usuarios existentes", () => {
  const database = "qa_users_" + randomUUID().replaceAll("-", "");
  const password = "User-types-test-12345";
  const oldHash = passwordHash(password);
  const ids = { tourist: randomUUID(), guide: randomUUID(), applicant: randomUUID(), admin: randomUUID(), disabled: randomUUID() };
  let root: Pool, sql: Pool, app: INestApplication, base: string, admin: string;
  let tourist: any, guide: any, company: any, group: any;
  const original = { url: process.env.DATABASE_URL, email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD };
  async function call(method: string, path: string, body?: unknown, token?: string) {
    const r = await fetch(base + path, {
      method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: r.status, body: await r.json() };
  }
  async function register(role?: string, profile: object = {}) {
    return call("POST", "/api/auth/register", {
      email: randomUUID() + "@example.test", name: "Cuenta de prueba", password,
      ...(role ? { role } : {}), ...profile,
    });
  }
  beforeAll(async () => {
    const host = process.env.TEST_DB_HOST || "db", pwd = process.env.TEST_DB_PASSWORD;
    root = new Pool({ connectionString: `postgres://altura_migrator:${pwd}@${host}:5432/altura` });
    await root.query(`CREATE DATABASE ${database}`);
    sql = new Pool({ connectionString: `postgres://altura_migrator:${pwd}@${host}:5432/${database}` });
    const baseline = (await readFile("db/001-schema.sql", "utf8")).split("CREATE ROLE altura_identity LOGIN;")[0];
    await sql.query(baseline);
    await sql.query("GRANT USAGE ON SCHEMA identity TO altura_identity; GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA identity TO altura_identity");
    for (const [kind, id] of Object.entries(ids)) {
      await sql.query("INSERT INTO identity.users(id,email,password_hash,name,role,disabled) VALUES($1,$2,$3,$4,$5,$6)",
        [id, `legacy-${kind}@example.test`, oldHash, `Anterior ${kind}`, kind === "admin" ? "admin" : kind === "guide" ? "guide" : "hiker", kind === "disabled"]);
    }
    for (const kind of ["guide", "applicant"] as const) {
      await sql.query("INSERT INTO identity.guide_profiles(user_id,bio,credential_reference,status,reviewed_by) VALUES($1,'Biografía anterior','CRED-PRIVADA',$2,$3)",
        [ids[kind], kind === "guide" ? "verified" : "pending", kind === "guide" ? ids.admin : null]);
    }
    const migration = await readFile("db/migrations/003-user-types.sql", "utf8");
    await sql.query(migration);
    await sql.query(migration);
    process.env.DATABASE_URL = `postgres://altura_identity:${pwd}@${host}:5432/${database}`;
    process.env.JWT_SECRET = "user-types-test-secret-with-more-than-32-characters";
    process.env.ADMIN_EMAIL = "legacy-admin@example.test";
    process.env.ADMIN_PASSWORD = password;
    app = await createApplication("identity");
    await app.listen(0, "127.0.0.1");
    base = "http://127.0.0.1:" + app.getHttpServer().address().port;
    const login = await call("POST", "/api/auth/login", { email: process.env.ADMIN_EMAIL, password });
    expect(login.status).toBe(201);
    admin = login.body.access_token;
  }, 60000);
  afterAll(async () => {
    await app?.close();
    await sql?.end();
    if (root) {
      await root.query(`DROP DATABASE IF EXISTS ${database} WITH (FORCE)`);
      await root.end();
    }
    for (const [key, value] of Object.entries({ DATABASE_URL: original.url, ADMIN_EMAIL: original.email, ADMIN_PASSWORD: original.password })) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  });
  test("migración repetible conserva identificadores, contraseña, deshabilitación y revisión", async () => {
    const users = (await sql.query("SELECT * FROM identity.users ORDER BY email")).rows;
    expect(users).toHaveLength(5);
    for (const user of users) expect(user.password_hash).toBe(oldHash);
    expect(users.find(u => u.id === ids.tourist).role).toBe("tourist");
    expect(users.find(u => u.id === ids.applicant).role).toBe("guide");
    expect(users.find(u => u.id === ids.disabled).disabled).toBe(true);
    expect((await sql.query("SELECT status,reviewed_by FROM identity.guide_profiles WHERE user_id=$1", [ids.guide])).rows[0])
      .toEqual({ status: "verified", reviewed_by: ids.admin });
    expect((await sql.query("SELECT user_id FROM identity.tourist_profiles")).rows.map(u => u.user_id).sort())
      .toEqual([ids.tourist, ids.disabled].sort());
    expect((await sql.query("SELECT user_id FROM identity.admin_profiles")).rows).toEqual([{ user_id: ids.admin }]);
    expect((await sql.query("SELECT * FROM identity.schema_migrations")).rows).toHaveLength(1);
    expect((await call("POST", "/api/auth/login", { email: "legacy-disabled@example.test", password })).status).toBe(401);
  });
  test("registro y sesión para turista, guía, empresa y grupo", async () => {
    tourist = await register();
    guide = await register("guide", { bio: "Guía de montaña", credential_reference: "CRED-NUEVA" });
    company = await register("organization", { organization_name: "Empresa QA", organization_type: "company" });
    group = await register("organization", { organization_name: "Grupo QA", organization_type: "group", description: "Club de senderismo" });
    for (const result of [tourist, guide, company, group]) {
      expect(result.status).toBe(201);
      const user = result.body.user;
      const login = await call("POST", "/api/auth/login", { email: user.email, password });
      const me = await call("GET", "/api/users/me", undefined, login.body.access_token);
      expect(me.body.role).toBe(user.role);
      expect(me.body).not.toHaveProperty("password_hash");
      const table = { tourist: "tourist", guide: "guide", organization: "organization" }[user.role as "tourist" | "guide" | "organization"];
      expect((await sql.query(`SELECT user_id FROM identity.${table}_profiles WHERE user_id=$1`, [user.id])).rows).toHaveLength(1);
    }
    expect((await call("GET", "/api/users/me", undefined, guide.body.access_token)).body.profile)
      .toMatchObject({ status: "pending", credential_reference: "CRED-NUEVA" });
    expect((await call("GET", "/api/users/" + guide.body.user.id)).body).not.toHaveProperty("credential_reference");
    expect((await call("GET", "/api/users/" + company.body.user.id)).body)
      .toMatchObject({ organization_name: "Empresa QA", organization_type: "company" });
  });
  test("solo administradores crean administradores; no se permite escalar privilegios", async () => {
    expect((await register("admin")).status).toBe(422);
    const body = { email: "new-admin@example.test", name: "Nueva administración", password, role: "admin" };
    expect((await call("POST", "/api/admin/users", body)).status).toBe(401);
    expect((await call("POST", "/api/admin/users", body, tourist.body.access_token)).status).toBe(403);
    const created = await call("POST", "/api/admin/users", body, admin);
    expect(created.status).toBe(201);
    expect(created.body).not.toHaveProperty("access_token");
    expect((await sql.query("SELECT user_id FROM identity.admin_profiles WHERE user_id=$1", [created.body.user.id])).rows).toHaveLength(1);
    const logged = await call("POST", "/api/auth/login", { email: body.email, password });
    expect((await call("GET", "/api/admin/guides", undefined, logged.body.access_token)).status).toBe(200);
    expect((await call("PATCH", "/api/users/me", { role: "admin" }, tourist.body.access_token)).status).toBe(422);
    expect((await call("POST", "/api/admin/users", body, admin)).status).toBe(409);
  });
  test("valida perfiles y restringe la edición de empresas y grupos", async () => {
    for (const [role, fields] of [
      ["guide", {}], ["organization", {}], ["organization", { organization_name: "QA", organization_type: "invalid" }],
      ["tourist", { organization_name: "QA" }], ["invalid", {}],
    ] as const) expect((await register(role, fields)).status).toBe(422);
    const changed = await call("PATCH", "/api/organizations/me", { description: "Actualizada", organization_name: "Empresa nueva" }, company.body.access_token);
    expect(changed.status).toBe(200);
    expect(changed.body).toMatchObject({ description: "Actualizada", organization_name: "Empresa nueva", organization_type: "company" });
    expect((await call("PATCH", "/api/organizations/me", {}, company.body.access_token)).status).toBe(422);
    expect((await call("PATCH", "/api/organizations/me", { description: "X" }, tourist.body.access_token)).status).toBe(403);
    expect((await call("GET", "/api/users/me", undefined, group.body.access_token)).body.profile.organization_name).toBe("Grupo QA");
    expect((await call("POST", "/api/guides/applications", { bio: "X", credential_reference: "X" }, company.body.access_token)).status).toBe(403);
  });
  test("turista pasa a guía pendiente, conserva la cuenta y puede ser rechazado y volver a solicitar", async () => {
    const token = tourist.body.access_token, id = tourist.body.user.id;
    expect((await call("POST", "/api/guides/applications", { bio: "Nuevo guía", credential_reference: "PRIVADA" }, token)).body.status).toBe("pending");
    expect((await sql.query("SELECT * FROM identity.tourist_profiles WHERE user_id=$1", [id])).rows).toHaveLength(0);
    expect((await call("GET", "/api/users/me", undefined, token)).body.role).toBe("guide");
    expect((await call("POST", `/api/admin/guides/${id}/review`, { approve: false }, admin)).body.status).toBe("rejected");
    expect((await call("POST", "/api/guides/applications", { bio: "Nueva solicitud", credential_reference: "ACTUALIZADA" }, token)).body.status).toBe("pending");
    expect((await call("POST", `/api/admin/guides/${id}/review`, { approve: true }, admin)).body.status).toBe("verified");
  });
  test("fallo al guardar un perfil revierte también la cuenta común", async () => {
    await sql.query(`CREATE FUNCTION identity.qa_fail_profile() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'qa profile rollback'; END $$;
      CREATE TRIGGER qa_fail_profile BEFORE INSERT ON identity.organization_profiles FOR EACH ROW EXECUTE FUNCTION identity.qa_fail_profile()`);
    const email = "rollback@example.test";
    const log = jest.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect((await register("organization", { email, organization_name: "Revertir", organization_type: "group" })).status).toBe(500);
      expect((await sql.query("SELECT id FROM identity.users WHERE email=$1", [email])).rows).toHaveLength(0);
    } finally {
      log.mockRestore();
      await sql.query("DROP TRIGGER qa_fail_profile ON identity.organization_profiles; DROP FUNCTION identity.qa_fail_profile()");
    }
  });
});
