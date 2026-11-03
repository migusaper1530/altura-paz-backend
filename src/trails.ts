import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  Headers,
  Injectable,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  Res,
} from "@nestjs/common";
import { createHmac, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";
import { z } from "zod";
import { Response } from "express";
import {
  assertOwner,
  assertPublic,
  auth,
  canonical,
  Database,
  id,
  point,
  proofId,
  Queryable,
  schema,
  sha256,
  text,
  User,
} from "./core";
import { ResilientHttp } from "./transport";
const fields = z.object({
  name: text(150),
  description: text(5000),
  difficulty: z.enum(["easy", "moderate", "hard"]),
  trail_status: z
    .enum(["unknown", "open", "caution", "closed"])
    .default("unknown"),
  warnings: z.string().max(3000).default(""),
});
const changes = fields
  .omit({ trail_status: true, warnings: true })
  .partial()
  .extend({
    trail_status: z.enum(["unknown", "open", "caution", "closed"]).optional(),
    warnings: z.string().max(3000).optional(),
    gpx_content: z
      .string()
      .min(1)
      .max(5 * 1024 * 1024)
      .optional(),
    expected_version: z.number().int().positive(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 1, "Incluye al menos un cambio");
const selection = `r.*,ST_AsGeoJSON(r.geometry,9)::json AS geometry,(SELECT count(*)::int FROM trails.activities a WHERE a.route_id=r.id) AS completed_people`;
export function snapshot(r: any) {
  return {
    schema_version: 1,
    route_id: r.id,
    version: r.version,
    name: r.name,
    description: r.description,
    geometry: r.geometry,
    distance_m: r.distance_m,
    ascent_m: r.ascent_m,
    descent_m: r.descent_m,
    estimated_minutes: r.estimated_minutes,
    difficulty: r.difficulty,
    elevation_source: r.elevation_source,
    trail_status: r.trail_status,
    warnings: r.warnings,
  };
}
export abstract class TrailsPort {
  abstract execute(
    command: string,
    params?: any[],
    c?: Queryable,
    kind?: string,
  ): Promise<any>;
  abstract transaction<T>(fn: (c: Queryable) => Promise<T>): Promise<T>;
  abstract route(routeId: string, c?: Queryable, lock?: boolean): Promise<any>;
  abstract visible(routeId: string, user?: User, c?: Queryable): Promise<any>;
  abstract parse(xml: string): Promise<any>;
  abstract anchor(c: Queryable, routeId: string): Promise<void>;
  abstract apply(c: Queryable, route: any, payload: any): Promise<any>;
  abstract near(
    routeId: string,
    coordinates: number[],
    c?: Queryable,
  ): Promise<void>;
}
const TRAILS_SQL: Record<string, (kind?: string) => string> = {
  import_1: (kind?: string) =>
    `INSERT INTO trails.routes(id,author_id,name,description,geometry,distance_m,ascent_m,descent_m,estimated_minutes,difficulty,elevation_source,trail_status,warnings) VALUES($1,$2,$3,$4,ST_SetSRID(ST_GeomFromGeoJSON($5),4326),$6,$7,$8,$9,$10,$11,$12,$13)`,
  list_1: (kind?: string) =>
    `SELECT ${selection} FROM trails.routes r WHERE r.state='published' AND NOT r.hidden AND ($1::text IS NULL OR r.name ILIKE '%'||$1||'%') AND ($2::text IS NULL OR r.difficulty=$2) AND ($3::double precision[] IS NULL OR ST_Intersects(r.geometry,ST_MakeEnvelope(($3::double precision[])[1],($3::double precision[])[2],($3::double precision[])[3],($3::double precision[])[4],4326))) ORDER BY r.created_at DESC,r.id LIMIT $4 OFFSET $5`,
  mine_1: (kind?: string) =>
    `SELECT ${selection} FROM trails.routes r WHERE r.author_id=$1 ORDER BY r.created_at DESC LIMIT 100`,
  publish_1: (kind?: string) =>
    `UPDATE trails.routes SET state='published',updated_at=now() WHERE id=$1`,
  edit_1: (kind?: string) =>
    "INSERT INTO trails.revisions(id,route_id,proposed_by,base_version,payload) VALUES($1,$2,$3,$4,$5)",
  visit_1: (kind?: string) =>
    `INSERT INTO trails.route_visits(route_id,visitor_hash,day) VALUES($1,$2,(now() AT TIME ZONE 'America/La_Paz')::date) ON CONFLICT DO NOTHING RETURNING route_id`,
  visit_2: (kind?: string) =>
    "UPDATE trails.routes SET views=views+1,popular=(popular OR views+1>200) WHERE id=$1 RETURNING views,popular",
  complete_1: (kind?: string) =>
    `INSERT INTO trails.activities(id,route_id,user_id,completed_on) VALUES($1,$2,$3,$4) ON CONFLICT(route_id,user_id) DO NOTHING`,
  undo_1: (kind?: string) =>
    "DELETE FROM trails.activities WHERE route_id=$1 AND user_id=$2",
  activities_1: (kind?: string) =>
    "SELECT * FROM trails.activities WHERE user_id=$1 ORDER BY completed_on DESC LIMIT 100",
  comment_1: (kind?: string) =>
    "INSERT INTO trails.comments(id,route_id,user_id,body,location) VALUES($1,$2,$3,$4,CASE WHEN $5::double precision IS NULL THEN NULL ELSE ST_SetSRID(ST_MakePoint($5,$6),4326) END) RETURNING id,body,created_at",
  comments_1: (kind?: string) =>
    `SELECT id,user_id,body,created_at,ST_AsGeoJSON(location)::json AS location FROM trails.comments WHERE route_id=$1 AND NOT hidden ORDER BY created_at DESC LIMIT 100`,
  report_1: (kind?: string) =>
    `INSERT INTO trails.reports(id,route_id,user_id,category,body,location) VALUES($1,$2,$3,$4,$5,ST_SetSRID(ST_MakePoint($6,$7),4326)) RETURNING id,category,body,status,created_at`,
  reports_1: (kind?: string) =>
    `SELECT id,category,body,status,created_at,reviewed_at,ST_AsGeoJSON(location)::json AS location FROM trails.reports WHERE route_id=$1 AND status<>'dismissed' ORDER BY created_at DESC LIMIT 100`,
  revisions_1: (kind?: string) =>
    `SELECT * FROM trails.revisions WHERE state='pending' ORDER BY created_at LIMIT 100`,
  revisionReview_1: (kind?: string) =>
    `SELECT * FROM trails.revisions WHERE id=$1 FOR UPDATE`,
  revisionReview_2: (kind?: string) =>
    "UPDATE trails.revisions SET state=$2,reviewed_by=$3,reason=$4,reviewed_at=now() WHERE id=$1 RETURNING *",
  reportQueue_1: (kind?: string) =>
    `SELECT id,route_id,category,body,status,created_at FROM trails.reports WHERE status IN ('unverified','confirmed') ORDER BY created_at LIMIT 100`,
  reportReview_1: (kind?: string) =>
    "UPDATE trails.reports SET status=$2,reason=$3,reviewed_by=$4,reviewed_at=now() WHERE id=$1 RETURNING id,status,reason",
  moderate_1: (kind?: string) =>
    `UPDATE trails.${kind} SET hidden=$2 WHERE id=$1 RETURNING id,hidden`,
  upload_1: (kind?: string) =>
    "INSERT INTO trails.photos(id,route_id,user_id,storage_key,caption) VALUES($1,$2,$3,$4,$5)",
  photos_1: (kind?: string) =>
    `SELECT id,caption,created_at FROM trails.photos WHERE route_id=$1 AND NOT hidden ORDER BY created_at LIMIT 100`,
  photo_1: (kind?: string) =>
    `SELECT p.storage_key FROM trails.photos p JOIN trails.routes r ON r.id=p.route_id WHERE p.id=$1 AND NOT p.hidden AND NOT r.hidden AND r.state='published'`,
  audit_1: (kind?: string) =>
    "SELECT * FROM ledger.proofs WHERE route_id=$1 ORDER BY version DESC",
};
@Injectable()
export class TrailsRepository extends TrailsPort {
  constructor(
    readonly db: Database,
    readonly http: ResilientHttp,
  ) {
    super();
  }
  async route(routeId: string, c: Queryable = this.db.pool, lock = false) {
    const r = await c.query(
      `SELECT ${selection} FROM trails.routes r WHERE r.id=$1 ${lock ? "FOR UPDATE OF r" : ""}`,
      [id(routeId)],
    );
    if (!r.rows[0]) throw new NotFoundException("Ruta no encontrada");
    return r.rows[0];
  }
  async visible(routeId: string, user?: User, c: Queryable = this.db.pool) {
    const r = await this.route(routeId, c);
    if (
      (r.hidden || r.state !== "published") &&
      r.author_id !== user?.sub &&
      user?.role !== "admin"
    )
      throw new NotFoundException("Ruta no encontrada");
    return r;
  }
  async parse(xml: string) {
    const response = await this.http.request(
      "gis",
      `${process.env.GIS_URL}/gpx/parse`,
      {
        method: "POST",
        headers: { "Content-Type": "application/gpx+xml" },
        body: xml,
      },
      15000,
    );
    const b: any = await response.json();
    if (!response.ok)
      throw new BadRequestException(b.error || "No se pudo leer el GPX");
    return b;
  }
  async anchor(c: Queryable, routeId: string) {
    const r = await this.route(routeId, c);
    const payload = snapshot(r);
    const digest = sha256(canonical(payload));
    await c.query(
      "INSERT INTO trails.outbox(id,route_id,version,proof_id,digest,payload) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(route_id,version) DO NOTHING",
      [
        randomUUID(),
        r.id,
        r.version,
        proofId(r.id, r.version),
        digest,
        payload,
      ],
    );
  }
  async apply(c: Queryable, route: any, payload: any) {
    const merged = { ...route, ...payload };
    await c.query(
      `UPDATE trails.routes SET name=$2,description=$3,difficulty=$4,trail_status=$5,warnings=$6,geometry=ST_SetSRID(ST_GeomFromGeoJSON($7),4326),distance_m=$8,ascent_m=$9,descent_m=$10,estimated_minutes=$11,elevation_source=$12,version=version+1,updated_at=now() WHERE id=$1`,
      [
        route.id,
        merged.name,
        merged.description,
        merged.difficulty,
        merged.trail_status,
        merged.warnings,
        JSON.stringify(merged.geometry),
        merged.distance_m,
        merged.ascent_m,
        merged.descent_m,
        merged.estimated_minutes,
        merged.elevation_source,
      ],
    );
    if (route.state === "published") await this.anchor(c, route.id);
    return this.route(route.id, c);
  }
  async near(
    routeId: string,
    coordinates: number[],
    c: Queryable = this.db.pool,
  ) {
    const result = await c.query(
      "SELECT ST_DWithin(geometry::geography,ST_SetSRID(ST_MakePoint($2,$3),4326)::geography,250) AS near FROM trails.routes WHERE id=$1",
      [routeId, ...coordinates],
    );
    if (!result.rows[0]?.near)
      throw new BadRequestException(
        "Ubica el punto a menos de 250 m del trazado",
      );
  }

  async execute(
    command: string,
    params: any[] = [],
    c: Queryable = this.db.pool,
    kind?: string,
  ) {
    if (kind && !["routes", "comments", "photos"].includes(kind))
      throw new Error("Tipo de contenido inválido");
    return c.query(TRAILS_SQL[command](kind), params);
  }
  transaction<T>(fn: (c: Queryable) => Promise<T>): Promise<T> {
    return this.db.tx(fn);
  }
}
@Injectable()
export class TrailsUseCases {
  constructor(readonly service: TrailsPort) {}
  async import(header: string, body: unknown) {
    const u = auth(header);
    const b = schema(
      fields
        .extend({
          gpx_content: z
            .string()
            .min(1)
            .max(5 * 1024 * 1024),
        })
        .strict(),
      body,
    );
    const g = await this.service.parse(b.gpx_content);
    const routeId = randomUUID();
    await this.service.execute(
      "import_1",
      [
        routeId,
        u.sub,
        b.name,
        b.description,
        JSON.stringify(g.geometry),
        g.distance_m,
        g.ascent_m,
        g.descent_m,
        g.estimated_minutes,
        b.difficulty,
        g.elevation_source,
        b.trail_status,
        b.warnings,
      ],
      undefined,
    );
    return this.service.route(routeId);
  }
  async list(query: unknown) {
    const b = schema(
      z
        .object({
          q: z.string().max(100).optional(),
          difficulty: z.enum(["easy", "moderate", "hard"]).optional(),
          bbox: z.string().optional(),
          limit: z.coerce.number().int().min(1).max(100).default(20),
          offset: z.coerce.number().int().min(0).max(100000).default(0),
        })
        .strict(),
      query,
    );
    let bbox: number[] | null = null;
    if (b.bbox) {
      bbox = z
        .array(z.coerce.number().finite())
        .length(4)
        .parse(b.bbox.split(","));
      if (
        bbox[0] >= bbox[2] ||
        bbox[1] >= bbox[3] ||
        bbox[0] < -180 ||
        bbox[2] > 180 ||
        bbox[1] < -90 ||
        bbox[3] > 90
      )
        throw new BadRequestException("bbox debe ser oeste,sur,este,norte");
    }
    const r = await this.service.execute(
      "list_1",
      [b.q || null, b.difficulty || null, bbox, b.limit, b.offset],
      undefined,
    );
    return { items: r.rows, limit: b.limit, offset: b.offset };
  }
  async mine(header: string) {
    const u = auth(header);
    return (await this.service.execute("mine_1", [u.sub], undefined)).rows;
  }
  async get(routeId: string, header?: string) {
    return this.service.visible(routeId, header ? auth(header) : undefined);
  }
  async publish(header: string, routeId: string) {
    const u = auth(header);
    return this.service.transaction(async (c) => {
      const r = await this.service.route(routeId, c, true);
      assertOwner(u, r.author_id);
      if (r.state === "published") return r;
      await this.service.execute("publish_1", [r.id], c);
      await this.service.anchor(c, r.id);
      return this.service.route(r.id, c);
    });
  }
  async edit(header: string, routeId: string, body: unknown) {
    const u = auth(header);
    const b = schema(changes, body);
    const payload: any = { ...b };
    delete payload.expected_version;
    delete payload.gpx_content;
    if (b.gpx_content) {
      const g = await this.service.parse(b.gpx_content);
      for (const key of [
        "geometry",
        "distance_m",
        "ascent_m",
        "descent_m",
        "estimated_minutes",
        "elevation_source",
      ])
        payload[key] = g[key];
    }
    return this.service.transaction(async (c) => {
      const r = await this.service.route(routeId, c, true);
      assertOwner(u, r.author_id);
      if (r.version !== b.expected_version)
        throw new ConflictException("La ruta cambió; vuelve a cargarla");
      if (r.popular) {
        const revision = randomUUID();
        await this.service.execute(
          "edit_1",
          [revision, r.id, u.sub, r.version, payload],
          c,
        );
        return {
          state: "pending",
          revision_id: revision,
          route_version: r.version,
        };
      }
      return this.service.apply(c, r, payload);
    });
  }
  async visit(header: string, routeId: string) {
    const u = auth(header);
    return this.service.transaction(async (c) => {
      const r = await this.service.route(routeId, c, true);
      assertPublic(r);
      if (r.author_id === u.sub)
        return { counted: false, views: r.views, popular: r.popular };
      const hash = createHmac("sha256", process.env.VISIT_SECRET!)
        .update(`${u.sub}:${r.id}`)
        .digest("hex");
      const v = await this.service.execute("visit_1", [r.id, hash], c);
      if (v.rowCount) {
        const result = await this.service.execute("visit_2", [r.id], c);
        return { counted: true, ...result.rows[0] };
      }
      return { counted: false, views: r.views, popular: r.popular };
    });
  }
  async complete(header: string, routeId: string, body: unknown) {
    const u = auth(header);
    const b = schema(z.object({ completed_on: z.iso.date() }).strict(), body);
    const r = await this.service.visible(routeId, u);
    assertPublic(r);
    const today = new Date(Date.now() - 4 * 3600000).toISOString().slice(0, 10);
    if (b.completed_on > today)
      throw new BadRequestException("La fecha no puede estar en el futuro");
    await this.service.execute(
      "complete_1",
      [randomUUID(), r.id, u.sub, b.completed_on],
      undefined,
    );
    return {
      completed: true,
      verification: "self_reported",
      completed_people: (await this.service.route(r.id)).completed_people,
    };
  }
  async undo(header: string, routeId: string) {
    const u = auth(header);
    await this.service.execute("undo_1", [id(routeId), u.sub], undefined);
    return { completed: false };
  }
  async activities(header: string) {
    const u = auth(header);
    return (await this.service.execute("activities_1", [u.sub], undefined))
      .rows;
  }
  async comment(header: string, routeId: string, body: unknown) {
    const u = auth(header);
    const b = schema(
      z.object({ body: text(2000), location: point.optional() }).strict(),
      body,
    );
    const r = await this.service.visible(routeId, u);
    assertPublic(r);
    if (b.location) await this.service.near(r.id, b.location);
    const result = await this.service.execute(
      "comment_1",
      [
        randomUUID(),
        r.id,
        u.sub,
        b.body,
        b.location?.[0] ?? null,
        b.location?.[1] ?? null,
      ],
      undefined,
    );
    return result.rows[0];
  }
  async comments(routeId: string) {
    await this.service.visible(routeId);
    return (await this.service.execute("comments_1", [routeId], undefined))
      .rows;
  }
  async report(header: string, routeId: string, body: unknown) {
    const u = auth(header);
    const b = schema(
      z
        .object({
          category: z.enum(["obstacle", "closure", "hazard", "content"]),
          body: text(3000),
          location: point,
        })
        .strict(),
      body,
    );
    const r = await this.service.visible(routeId, u);
    assertPublic(r);
    await this.service.near(r.id, b.location);
    const result = await this.service.execute(
      "report_1",
      [randomUUID(), r.id, u.sub, b.category, b.body, ...b.location],
      undefined,
    );
    return result.rows[0];
  }
  async reports(routeId: string) {
    await this.service.visible(routeId);
    return (await this.service.execute("reports_1", [routeId], undefined)).rows;
  }
  async revisions(header: string) {
    auth(header, "admin");
    return (await this.service.execute("revisions_1", [], undefined)).rows;
  }
  async revisionReview(header: string, revisionId: string, body: unknown) {
    const u = auth(header, "admin");
    const b = schema(
      z.object({ approve: z.boolean(), reason: text(500) }).strict(),
      body,
    );
    return this.service.transaction(async (c) => {
      const result = await this.service.execute(
        "revisionReview_1",
        [id(revisionId)],
        c,
      );
      const revision = result.rows[0];
      if (!revision || revision.state !== "pending")
        throw new NotFoundException("Revisión pendiente no encontrada");
      if (revision.proposed_by === u.sub)
        throw new BadRequestException(
          "Otra persona administradora debe aprobar tus cambios",
        );
      const r = await this.service.route(revision.route_id, c, true);
      if (b.approve && r.version !== revision.base_version)
        throw new ConflictException(
          "La propuesta parte de una versión anterior",
        );
      if (b.approve) await this.service.apply(c, r, revision.payload);
      const updated = await this.service.execute(
        "revisionReview_2",
        [revision.id, b.approve ? "approved" : "rejected", u.sub, b.reason],
        c,
      );
      return updated.rows[0];
    });
  }
  async reportQueue(header: string) {
    auth(header, "admin");
    return (await this.service.execute("reportQueue_1", [], undefined)).rows;
  }
  async reportReview(header: string, reportId: string, body: unknown) {
    const u = auth(header, "admin");
    const b = schema(
      z
        .object({
          status: z.enum(["confirmed", "resolved", "dismissed"]),
          reason: text(500),
        })
        .strict(),
      body,
    );
    const r = await this.service.execute(
      "reportReview_1",
      [id(reportId), b.status, b.reason, u.sub],
      undefined,
    );
    if (!r.rows[0]) throw new NotFoundException();
    return r.rows[0];
  }
  async moderate(
    header: string,
    kind: string,
    contentId: string,
    body: unknown,
  ) {
    auth(header, "admin");
    const k = schema(z.enum(["routes", "comments", "photos"]), kind);
    const b = schema(z.object({ hidden: z.boolean() }).strict(), body);
    const r = await this.service.execute(
      "moderate_1",
      [id(contentId), b.hidden],
      undefined,
      k,
    );
    if (!r.rows[0]) throw new NotFoundException();
    return r.rows[0];
  }
  async upload(header: string, routeId: string, body: unknown) {
    const u = auth(header);
    const b = schema(
      z
        .object({
          image_base64: z
            .string()
            .min(4)
            .max(7 * 1024 * 1024)
            .regex(/^[A-Za-z0-9+/]+={0,2}$/),
          caption: text(300),
        })
        .strict(),
      body,
    );
    const r = await this.service.visible(routeId, u);
    assertPublic(r);
    const original = Buffer.from(b.image_base64, "base64");
    if (original.length > 5 * 1024 * 1024)
      throw new BadRequestException("Máximo 5 MB por foto");
    let image: Buffer;
    try {
      const decoder = sharp(original, { limitInputPixels: 25000000 });
      const info = await decoder.metadata();
      if (!["jpeg", "png", "webp"].includes(info.format || ""))
        throw new Error();
      image = await decoder
        .rotate()
        .resize({
          width: 2000,
          height: 2000,
          fit: "inside",
          withoutEnlargement: true,
        })
        .jpeg({ quality: 82 })
        .toBuffer();
    } catch {
      throw new BadRequestException(
        "Usa una imagen JPEG, PNG o WebP válida de hasta 25 megapíxeles",
      );
    }
    const photoId = randomUUID(),
      key = photoId + ".jpg";
    const folder = process.env.MEDIA_DIR || "/app/media";
    await mkdir(folder, { recursive: true });
    await writeFile(join(folder, key), image, { flag: "wx" });
    await this.service.execute(
      "upload_1",
      [photoId, r.id, u.sub, key, b.caption],
      undefined,
    );
    return {
      id: photoId,
      url: `/api/photos/${photoId}/file`,
      caption: b.caption,
    };
  }
  async photos(routeId: string) {
    await this.service.visible(routeId);
    return (
      await this.service.execute("photos_1", [routeId], undefined)
    ).rows.map((p: any) => ({ ...p, url: `/api/photos/${p.id}/file` }));
  }
  async photo(photoId: string, res: Response) {
    const r = await this.service.execute("photo_1", [id(photoId)], undefined);
    if (!r.rows[0]) throw new NotFoundException();
    const data = await readFile(
      join(process.env.MEDIA_DIR || "/app/media", r.rows[0].storage_key),
    );
    res.setHeader("Content-Type", "image/jpeg");
    res.setHeader("Cache-Control", "no-store");
    res.send(data);
  }
  async audit(routeId: string) {
    const route = await this.service.visible(routeId);
    const result = await this.service.execute("audit_1", [route.id], undefined);
    const latest = result.rows.find((p: any) => p.version === route.version);
    const current = sha256(canonical(snapshot(route)));
    return {
      route_id: route.id,
      current_version: route.version,
      current_digest: current,
      anchor_status: latest
        ? latest.digest === current
          ? "matches_recorded_proof"
          : "mismatch"
        : "pending",
      proofs: result.rows,
    };
  }
}
@Controller("api")
export class TrailsController {
  constructor(readonly usecases: TrailsUseCases) {}
  @Post("routes/import-gpx")
  async import(
    @Headers("authorization")
    header: string,
    @Body()
    body: unknown,
  ) {
    return this.usecases.import(header, body);
  }
  @Get("routes")
  async list(
    @Query()
    query: unknown,
  ) {
    return this.usecases.list(query);
  }
  @Get("my/routes")
  async mine(
    @Headers("authorization")
    header: string,
  ) {
    return this.usecases.mine(header);
  }
  @Get("routes/:routeId")
  async get(
    @Param("routeId")
    routeId: string,
    @Headers("authorization")
    header?: string,
  ) {
    return this.usecases.get(routeId, header);
  }
  @Post("routes/:routeId/publish")
  async publish(
    @Headers("authorization")
    header: string,
    @Param("routeId")
    routeId: string,
  ) {
    return this.usecases.publish(header, routeId);
  }
  @Patch("routes/:routeId")
  async edit(
    @Headers("authorization")
    header: string,
    @Param("routeId")
    routeId: string,
    @Body()
    body: unknown,
  ) {
    return this.usecases.edit(header, routeId, body);
  }
  @Post("routes/:routeId/visits")
  async visit(
    @Headers("authorization")
    header: string,
    @Param("routeId")
    routeId: string,
  ) {
    return this.usecases.visit(header, routeId);
  }
  @Post("routes/:routeId/completion")
  async complete(
    @Headers("authorization")
    header: string,
    @Param("routeId")
    routeId: string,
    @Body()
    body: unknown,
  ) {
    return this.usecases.complete(header, routeId, body);
  }
  @Delete("routes/:routeId/completion")
  async undo(
    @Headers("authorization")
    header: string,
    @Param("routeId")
    routeId: string,
  ) {
    return this.usecases.undo(header, routeId);
  }
  @Get("my/activities")
  async activities(
    @Headers("authorization")
    header: string,
  ) {
    return this.usecases.activities(header);
  }
  @Post("routes/:routeId/comments")
  async comment(
    @Headers("authorization")
    header: string,
    @Param("routeId")
    routeId: string,
    @Body()
    body: unknown,
  ) {
    return this.usecases.comment(header, routeId, body);
  }
  @Get("routes/:routeId/comments")
  async comments(
    @Param("routeId")
    routeId: string,
  ) {
    return this.usecases.comments(routeId);
  }
  @Post("routes/:routeId/reports")
  async report(
    @Headers("authorization")
    header: string,
    @Param("routeId")
    routeId: string,
    @Body()
    body: unknown,
  ) {
    return this.usecases.report(header, routeId, body);
  }
  @Get("routes/:routeId/reports")
  async reports(
    @Param("routeId")
    routeId: string,
  ) {
    return this.usecases.reports(routeId);
  }
  @Get("admin/revisions")
  async revisions(
    @Headers("authorization")
    header: string,
  ) {
    return this.usecases.revisions(header);
  }
  @Post("admin/revisions/:revisionId/review")
  async revisionReview(
    @Headers("authorization")
    header: string,
    @Param("revisionId")
    revisionId: string,
    @Body()
    body: unknown,
  ) {
    return this.usecases.revisionReview(header, revisionId, body);
  }
  @Get("admin/reports")
  async reportQueue(
    @Headers("authorization")
    header: string,
  ) {
    return this.usecases.reportQueue(header);
  }
  @Post("admin/reports/:reportId/review")
  async reportReview(
    @Headers("authorization")
    header: string,
    @Param("reportId")
    reportId: string,
    @Body()
    body: unknown,
  ) {
    return this.usecases.reportReview(header, reportId, body);
  }
  @Patch("admin/content/:kind/:contentId")
  async moderate(
    @Headers("authorization")
    header: string,
    @Param("kind")
    kind: string,
    @Param("contentId")
    contentId: string,
    @Body()
    body: unknown,
  ) {
    return this.usecases.moderate(header, kind, contentId, body);
  }
  @Post("routes/:routeId/photos")
  async upload(
    @Headers("authorization")
    header: string,
    @Param("routeId")
    routeId: string,
    @Body()
    body: unknown,
  ) {
    return this.usecases.upload(header, routeId, body);
  }
  @Get("routes/:routeId/photos")
  async photos(
    @Param("routeId")
    routeId: string,
  ) {
    return this.usecases.photos(routeId);
  }
  @Get("photos/:photoId/file")
  async photo(
    @Param("photoId")
    photoId: string,
    @Res()
    res: Response,
  ) {
    return this.usecases.photo(photoId, res);
  }
  @Get("routes/:routeId/audit")
  async audit(
    @Param("routeId")
    routeId: string,
  ) {
    return this.usecases.audit(routeId);
  }
}
