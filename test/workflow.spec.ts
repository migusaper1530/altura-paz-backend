import { createApplication } from "../src/main";
import { Database, canonical, proofId, sha256 } from "../src/core";
import { checkEvent, LedgerService, OutboxPublisher } from "../src/ledger";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import sharp from "sharp";
import { INestApplication } from "@nestjs/common";

const suite = process.env.TEST_DB_PASSWORD ? describe : describe.skip;
suite("flujos con PostgreSQL/PostGIS, GIS y HTTP reales", () => {
  const apps: INestApplication[] = [];
  let base: string,
    sql: Pool,
    author: any,
    visitor: any,
    other: any,
    admin: string,
    route: any;
  const password = "Test-passphrase-12345";
  const tag = randomUUID();
  async function call(
    method: string,
    path: string,
    body?: any,
    token?: string,
  ) {
    const r = await fetch(base + path, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: "Bearer " + token } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const ct = r.headers.get("content-type") || "";
    return {
      status: r.status,
      body: ct.includes("json") ? await r.json() : await r.text(),
      headers: r.headers,
    };
  }
  beforeAll(async () => {
    process.env.JWT_SECRET = "qa-secret-with-at-least-32-characters-long";
    process.env.VISIT_SECRET = "qa-visit-secret-with-at-least-32-characters";
    process.env.MEDIA_DIR = "/tmp/altura-qa-media";
    const host = process.env.TEST_DB_HOST || "db",
      pwd = process.env.TEST_DB_PASSWORD;
    sql = new Pool({
      connectionString: `postgres://altura_migrator:${pwd}@${host}:5432/altura`,
    });
    for (const mode of ["identity", "trails"]) {
      process.env.DATABASE_URL = `postgres://altura_${mode}:${pwd}@${host}:5432/altura`;
      const app = await createApplication(mode);
      await app.listen(0, "0.0.0.0");
      apps.push(app);
      process.env[mode.toUpperCase() + "_URL"] =
        "http://127.0.0.1:" + app.getHttpServer().address().port;
    }
    const gateway = await createApplication("gateway");
    await gateway.listen(0, "0.0.0.0");
    apps.push(gateway);
    base = "http://127.0.0.1:" + gateway.getHttpServer().address().port;
    const a = await call("POST", "/api/auth/register", {
      email: `a-${tag}@example.test`,
      password,
      name: "Autora QA",
    });
    expect(a.status).toBe(201);
    expect(a.body.user.role).toBe("tourist");
    author = { ...a.body.user, token: a.body.access_token };
    const b = await call("POST", "/api/auth/register", {
      email: `b-${tag}@example.test`,
      password,
      name: "Visitante QA",
    });
    visitor = { ...b.body.user, token: b.body.access_token };
    const c = await call("POST", "/api/auth/register", {
      email: `c-${tag}@example.test`,
      password,
      name: "Otra cuenta QA",
    });
    other = { ...c.body.user, token: c.body.access_token };
    const login = await call("POST", "/api/auth/login", {
      email: process.env.ADMIN_EMAIL,
      password: process.env.ADMIN_PASSWORD,
    });
    expect(login.status).toBe(201);
    admin = login.body.access_token;
  }, 60000);
  afterAll(async () => {
    for (const app of [...apps].reverse()) await app.close();
    await sql?.end();
  });
  test("registro estricto, sesión y privacidad de perfiles", async () => {
    expect(
      (
        await call("POST", "/api/auth/register", {
          email: `evil-${tag}@example.test`,
          password,
          name: "X",
          role: "admin",
        })
      ).status,
    ).toBe(422);
    expect(
      (
        await call("POST", "/api/auth/login", {
          email: author.email,
          password: "wrong",
        })
      ).status,
    ).toBe(401);
    expect((await call("GET", "/api/users/me")).status).toBe(401);
    expect(
      (await call("GET", "/api/users/me", undefined, author.token)).body.email,
    ).toBe(author.email);
    expect(
      (
        await call(
          "PATCH",
          "/api/users/me",
          { name: "Autora actualizada" },
          author.token,
        )
      ).status,
    ).toBe(200);
    const p = await call("GET", "/api/users/" + author.id);
    expect(p.body).not.toHaveProperty("email");
    expect(p.body.name).toBe("Autora actualizada");
    expect((await call("GET", "/api/users/" + randomUUID())).status).toBe(404);
  });
  test("perfil de empresa accesible a través del gateway", async () => {
    const org = await call("POST", "/api/auth/register", {
      email: `org-${tag}@example.test`, password, name: "Grupo de prueba",
      role: "organization", organization_name: "Grupo QA", organization_type: "group",
    });
    expect(org.status).toBe(201);
    expect((await call("PATCH", "/api/organizations/me", { description: "Descripción pública" }, org.body.access_token)).status).toBe(200);
    expect((await call("GET", "/api/users/" + org.body.user.id)).body.organization_description).toBe("Descripción pública");
    const imported = await call("POST", "/api/routes/import-gpx", {
      name: "Ruta de grupo", description: "Ruta sintética de organización", difficulty: "easy",
      gpx_content: await readFile("examples/palca-ilustrativo.gpx", "utf8"),
    }, org.body.access_token);
    expect(imported.status).toBe(201);
    expect((await call("POST", `/api/routes/${imported.body.id}/publish`, undefined, org.body.access_token)).status).toBe(201);
  });
  test("importación, borrador y publicación pública con outbox", async () => {
    const gpx = await readFile("examples/palca-ilustrativo.gpx", "utf8");
    expect(
      (
        await call(
          "POST",
          "/api/routes/import-gpx",
          {
            name: "test",
            description: "x",
            difficulty: "easy",
            gpx_content: "<gpx/>",
          },
          author.token,
        )
      ).status,
    ).toBe(400);
    const r = await call(
      "POST",
      "/api/routes/import-gpx",
      {
        name: "QA " + tag,
        description: "Datos sintéticos; no navegar",
        difficulty: "moderate",
        warnings: "Advertencia que debe conservarse",
        trail_status: "caution",
        gpx_content: gpx,
      },
      author.token,
    );
    expect(r.status).toBe(201);
    route = r.body;
    expect(route.state).toBe("draft");
    expect(route.geometry.type).toBe("MultiLineString");
    expect(route.ascent_m).toBe(240);
    expect(route.distance_m).toBeGreaterThan(2000);
    expect((await call("GET", "/api/routes/" + route.id)).status).toBe(404);
    expect(
      (await call("GET", "/api/routes/" + route.id, undefined, visitor.token))
        .status,
    ).toBe(404);
    expect(
      (await call("GET", "/api/routes/" + route.id, undefined, author.token))
        .status,
    ).toBe(200);
    expect(
      (
        await call(
          "POST",
          `/api/routes/${route.id}/publish`,
          undefined,
          visitor.token,
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await call(
          "POST",
          `/api/routes/${route.id}/publish`,
          undefined,
          author.token,
        )
      ).status,
    ).toBe(201);
    expect(
      (
        await call(
          "POST",
          `/api/routes/${route.id}/publish`,
          undefined,
          author.token,
        )
      ).status,
    ).toBe(201);
    const outbox = await sql.query(
      "SELECT * FROM trails.outbox WHERE route_id=$1",
      [route.id],
    );
    expect(outbox.rows).toHaveLength(1);
    expect(checkEvent(outbox.rows[0]).digest).toMatch(/^0x/);
    const list = await call(
      "GET",
      `/api/routes?q=${encodeURIComponent(tag)}&difficulty=moderate&bbox=-68.3,-16.8,-67.7,-16.2`,
    );
    expect(list.body.items.map((r: any) => r.id)).toContain(route.id);
    expect((await call("GET", "/api/routes?bbox=1,0,-1,0")).status).toBe(400);
    expect(
      (await call("GET", "/api/my/routes", undefined, author.token)).body.some(
        (r: any) => r.id === route.id,
      ),
    ).toBe(true);
  });
  test("visitas, frontera 200/201 y aprobación sin sobrescrituras", async () => {
    expect(
      (
        await call(
          "POST",
          `/api/routes/${route.id}/visits`,
          undefined,
          author.token,
        )
      ).body.counted,
    ).toBe(false);
    const first = await call(
      "POST",
      `/api/routes/${route.id}/visits`,
      undefined,
      visitor.token,
    );
    expect(first.body).toMatchObject({
      counted: true,
      views: 1,
      popular: false,
    });
    expect(
      (
        await call(
          "POST",
          `/api/routes/${route.id}/visits`,
          undefined,
          visitor.token,
        )
      ).body.counted,
    ).toBe(false);
    // Fixture de frontera: visitas sintéticas, nunca tráfico presentado como real.
    await sql.query(
      `INSERT INTO trails.route_visits(route_id,visitor_hash,day) SELECT $1,'qa-fixture-'||n,(now() AT TIME ZONE 'America/La_Paz')::date FROM generate_series(1,199) n`,
      [route.id],
    );
    await sql.query("UPDATE trails.routes SET views=200 WHERE id=$1", [
      route.id,
    ]);
    let r = await call(
      "PATCH",
      "/api/routes/" + route.id,
      { name: "QA editada " + tag, expected_version: 1 },
      author.token,
    );
    expect(r.body.version).toBe(2);
    expect(r.body.warnings).toBe("Advertencia que debe conservarse");
    expect(r.body.trail_status).toBe("caution");
    expect(
      (
        await call(
          "POST",
          `/api/routes/${route.id}/visits`,
          undefined,
          other.token,
        )
      ).body,
    ).toMatchObject({ views: 201, popular: true });
    expect(
      (
        await call(
          "PATCH",
          "/api/routes/" + route.id,
          { name: "No permitido", expected_version: 2 },
          visitor.token,
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await call(
          "PATCH",
          "/api/routes/" + route.id,
          { name: "Obsoleto", expected_version: 1 },
          author.token,
        )
      ).status,
    ).toBe(409);
    r = await call(
      "PATCH",
      "/api/routes/" + route.id,
      { name: "QA aprobada " + tag, expected_version: 2 },
      author.token,
    );
    expect(r.body.state).toBe("pending");
    const revision = r.body.revision_id;
    expect((await call("GET", "/api/routes/" + route.id)).body.version).toBe(2);
    expect(
      (await call("GET", "/api/admin/revisions", undefined, author.token))
        .status,
    ).toBe(403);
    expect(
      (await call("GET", "/api/admin/revisions", undefined, admin)).body.some(
        (r: any) => r.id === revision,
      ),
    ).toBe(true);
    expect(
      (
        await call(
          "POST",
          `/api/admin/revisions/${revision}/review`,
          { approve: true, reason: "Revisión QA" },
          admin,
        )
      ).body.state,
    ).toBe("approved");
    expect((await call("GET", "/api/routes/" + route.id)).body.version).toBe(3);
    expect(
      (
        await call(
          "POST",
          `/api/admin/revisions/${revision}/review`,
          { approve: true, reason: "Otra revisión" },
          admin,
        )
      ).status,
    ).toBe(404);
    const p1 = await call(
      "PATCH",
      "/api/routes/" + route.id,
      { description: "Propuesta uno", expected_version: 3 },
      author.token,
    );
    const p2 = await call(
      "PATCH",
      "/api/routes/" + route.id,
      { description: "Propuesta dos", expected_version: 3 },
      author.token,
    );
    expect(
      (
        await call(
          "POST",
          `/api/admin/revisions/${p1.body.revision_id}/review`,
          { approve: true, reason: "Primera propuesta" },
          admin,
        )
      ).status,
    ).toBe(201);
    expect(
      (
        await call(
          "POST",
          `/api/admin/revisions/${p2.body.revision_id}/review`,
          { approve: true, reason: "Propuesta desactualizada" },
          admin,
        )
      ).status,
    ).toBe(409);
    expect(
      (
        await call(
          "POST",
          `/api/admin/revisions/${p2.body.revision_id}/review`,
          { approve: false, reason: "Solicitar nueva base" },
          admin,
        )
      ).body.state,
    ).toBe("rejected");
  });
  test("finalización manual única, concurrencia y actividad privada", async () => {
    const today = new Date(Date.now() - 4 * 3600000).toISOString().slice(0, 10);
    const path = `/api/routes/${route.id}/completion`;
    const results = await Promise.all(
      Array.from({ length: 4 }, () =>
        call("POST", path, { completed_on: today }, visitor.token),
      ),
    );
    expect(results.every((r) => r.status === 201)).toBe(true);
    expect(
      (await call("GET", "/api/routes/" + route.id)).body.completed_people,
    ).toBe(1);
    const activities = await call(
      "GET",
      "/api/my/activities",
      undefined,
      visitor.token,
    );
    expect(
      activities.body.find((a: any) => a.route_id === route.id).verification,
    ).toBe("self_reported");
    expect((await call("GET", "/api/my/activities")).status).toBe(401);
    expect(
      (await call("POST", path, { completed_on: "2099-01-01" }, visitor.token))
        .status,
    ).toBe(400);
    expect(
      (await call("DELETE", path, undefined, visitor.token)).body.completed,
    ).toBe(false);
    expect(
      (await call("GET", "/api/routes/" + route.id)).body.completed_people,
    ).toBe(0);
  });
  test("comentarios y reportes geolocalizados, moderación posterior", async () => {
    const path = `/api/routes/${route.id}`;
    expect(
      (
        await call(
          "POST",
          path + "/reports",
          { category: "hazard", body: "Muy lejos", location: [0, 0] },
          visitor.token,
        )
      ).status,
    ).toBe(400);
    const c = await call(
      "POST",
      path + "/comments",
      { body: "Comentario QA", location: [-67.956, -16.557] },
      visitor.token,
    );
    expect(c.status).toBe(201);
    expect(
      (await call("GET", path + "/comments")).body.some(
        (v: any) => v.id === c.body.id,
      ),
    ).toBe(true);
    await call(
      "PATCH",
      `/api/admin/content/comments/${c.body.id}`,
      { hidden: true },
      admin,
    );
    expect(
      (await call("GET", path + "/comments")).body.some(
        (v: any) => v.id === c.body.id,
      ),
    ).toBe(false);
    const r = await call(
      "POST",
      path + "/reports",
      {
        category: "obstacle",
        body: "Piedras sueltas, ejemplo",
        location: [-67.956, -16.557],
      },
      visitor.token,
    );
    expect(r.body.status).toBe("unverified");
    expect(
      (await call("GET", "/api/admin/reports", undefined, admin)).body.some(
        (v: any) => v.id === r.body.id,
      ),
    ).toBe(true);
    expect(
      (await call("GET", path + "/reports")).body.some(
        (v: any) => v.id === r.body.id,
      ),
    ).toBe(true);
    await call(
      "POST",
      `/api/admin/reports/${r.body.id}/review`,
      { status: "confirmed", reason: "Prueba de revisión" },
      admin,
    );
    expect(
      (await call("GET", path + "/reports")).body.find(
        (v: any) => v.id === r.body.id,
      ).status,
    ).toBe("confirmed");
    await call(
      "POST",
      `/api/admin/reports/${r.body.id}/review`,
      { status: "dismissed", reason: "Dato sintético" },
      admin,
    );
    expect(
      (await call("GET", path + "/reports")).body.some(
        (v: any) => v.id === r.body.id,
      ),
    ).toBe(false);
    expect(
      (
        await call(
          "POST",
          `/api/admin/reports/${randomUUID()}/review`,
          { status: "resolved", reason: "No existe" },
          admin,
        )
      ).status,
    ).toBe(404);
  });
  test("fotografías validadas, EXIF eliminado y ocultación efectiva", async () => {
    const image = await sharp({
      create: { width: 20, height: 20, channels: 3, background: "#126c8a" },
    })
      .jpeg()
      .withMetadata({ exif: { IFD0: { Artist: "dato privado" } } })
      .toBuffer();
    const p = await call(
      "POST",
      `/api/routes/${route.id}/photos`,
      { caption: "Imagen QA", image_base64: image.toString("base64") },
      visitor.token,
    );
    expect(p.status).toBe(201);
    const imageResult = await fetch(base + p.body.url);
    expect(imageResult.status).toBe(200);
    const meta = await sharp(
      Buffer.from(await imageResult.arrayBuffer()),
    ).metadata();
    expect(meta.exif).toBeUndefined();
    expect(
      (await call("GET", `/api/routes/${route.id}/photos`)).body.some(
        (r: any) => r.id === p.body.id,
      ),
    ).toBe(true);
    expect(
      (
        await call(
          "POST",
          `/api/routes/${route.id}/photos`,
          {
            caption: "inválida",
            image_base64: Buffer.from("not a photo").toString("base64"),
          },
          visitor.token,
        )
      ).status,
    ).toBe(400);
    await call(
      "PATCH",
      `/api/admin/content/photos/${p.body.id}`,
      { hidden: true },
      admin,
    );
    expect((await fetch(base + p.body.url)).status).toBe(404);
  });
  test("guías verificados y deshabilitación de cuenta", async () => {
    expect(
      (
        await call(
          "POST",
          "/api/guides/applications",
          { bio: "Guía de prueba", credential_reference: "DEMO-NO-REAL" },
          visitor.token,
        )
      ).body.status,
    ).toBe("pending");
    expect(
      (await call("GET", "/api/admin/guides", undefined, admin)).body.some(
        (r: any) => r.user_id === visitor.id,
      ),
    ).toBe(true);
    expect(
      (
        await call(
          "POST",
          `/api/admin/guides/${visitor.id}/review`,
          { approve: true },
          author.token,
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await call(
          "POST",
          `/api/admin/guides/${visitor.id}/review`,
          { approve: true },
          admin,
        )
      ).body.status,
    ).toBe("verified");
    expect(
      (
        await call(
          "PATCH",
          "/api/guides/me",
          { bio: "Biografía profesional actualizada" },
          visitor.token,
        )
      ).body,
    ).toMatchObject({
      bio: "Biografía profesional actualizada",
      status: "verified",
    });
    expect(
      (
        await call(
          "PATCH",
          "/api/guides/me",
          { bio: "Sin solicitud" },
          author.token,
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await call(
          "POST",
          "/api/guides/applications",
          { bio: "Otro perfil", credential_reference: "DEMO" },
          visitor.token,
        )
      ).status,
    ).toBe(400);
    expect(
      (await call("GET", "/api/users/" + visitor.id)).body,
    ).not.toHaveProperty("credential_reference");
    expect(
      (
        await call(
          "POST",
          `/api/admin/guides/${randomUUID()}/review`,
          { approve: true },
          admin,
        )
      ).status,
    ).toBe(404);
    await call(
      "PATCH",
      `/api/admin/users/${other.id}`,
      { disabled: true },
      admin,
    );
    expect(
      (await call("GET", "/api/my/activities", undefined, other.token)).status,
    ).toBe(401);
    await call(
      "PATCH",
      `/api/admin/users/${other.id}`,
      { disabled: false },
      admin,
    );
  });
  test("consulta de huellas, vistas documentales y ocultación de ruta", async () => {
    const r = await call("GET", `/api/routes/${route.id}/audit`);
    expect(["pending", "matches_recorded_proof"]).toContain(
      r.body.anchor_status,
    );
    for (const path of [
      "/",
      "/docs",
      "/openapi.json",
      "/concepto.svg",
      "/health",
    ])
      expect((await call("GET", path)).status).toBe(200);
    expect(
      (
        await call(
          "PATCH",
          `/api/admin/content/routes/${route.id}`,
          { hidden: true },
          admin,
        )
      ).status,
    ).toBe(200);
    expect((await call("GET", "/api/routes/" + route.id)).status).toBe(404);
    expect(
      (await call("GET", "/api/routes/" + route.id, undefined, author.token))
        .status,
    ).toBe(200);
    await call(
      "PATCH",
      `/api/admin/content/routes/${route.id}`,
      { hidden: false },
      admin,
    );
  });
});
