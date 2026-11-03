import { Queryable } from "./core";
import {
  Body,
  Controller,
  Get,
  Headers,
  Injectable,
  NotFoundException,
  Param,
  Patch,
  Post,
  UnauthorizedException,
  BadRequestException,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  auth,
  Database,
  id,
  passwordHash,
  passwordMatches,
  schema,
  sign,
  text,
} from "./core";
const registration = z
  .object({
    email: z
      .email()
      .max(254)
      .transform((v) => v.toLowerCase()),
    password: z.string().min(12).max(128),
    name: text(100),
  })
  .strict();
const login = z
  .object({
    email: z.email().transform((v) => v.toLowerCase()),
    password: z.string().min(1).max(128),
  })
  .strict();
export abstract class IdentityPort {
  abstract execute(
    command: string,
    params?: any[],
    c?: Queryable,
    kind?: string,
  ): Promise<any>;
  abstract transaction<T>(fn: (c: Queryable) => Promise<T>): Promise<T>;
}
const IDENTITY_SQL: Record<string, (kind?: string) => string> = {
  register_1: (kind?: string) =>
    "INSERT INTO identity.users(id,email,password_hash,name) VALUES($1,$2,$3,$4)",
  login_1: (kind?: string) => "SELECT * FROM identity.users WHERE email=$1",
  me_1: (kind?: string) =>
    "SELECT id,email,name,role,disabled,created_at FROM identity.users WHERE id=$1",
  profile_1: (kind?: string) =>
    "UPDATE identity.users SET name=$1 WHERE id=$2 RETURNING id,name,role",
  publicProfile_1: (kind?: string) =>
    `SELECT u.id,u.name,u.role,g.bio,g.status AS guide_status FROM identity.users u LEFT JOIN identity.guide_profiles g ON g.user_id=u.id WHERE u.id=$1 AND NOT u.disabled`,
  guide_1: (kind?: string) =>
    "SELECT status FROM identity.guide_profiles WHERE user_id=$1 FOR UPDATE",
  guide_2: (kind?: string) =>
    `INSERT INTO identity.guide_profiles(user_id,bio,credential_reference) VALUES($1,$2,$3) ON CONFLICT(user_id) DO UPDATE SET bio=$2,credential_reference=$3,status='pending',reviewed_at=NULL,updated_at=now() RETURNING *`,
  guideQueue_1: (kind?: string) =>
    `SELECT g.*,u.name FROM identity.guide_profiles g JOIN identity.users u ON u.id=g.user_id WHERE g.status='pending' ORDER BY g.updated_at LIMIT 100`,
  review_1: (kind?: string) =>
    `UPDATE identity.guide_profiles SET status=$1,reviewed_by=$2,reviewed_at=now() WHERE user_id=$3 AND status='pending' RETURNING *`,
  review_2: (kind?: string) =>
    `UPDATE identity.users SET role='guide' WHERE id=$1 AND role='hiker'`,
  disable_1: (kind?: string) =>
    "UPDATE identity.users SET disabled=$1 WHERE id=$2 RETURNING id,disabled",
  guideProfile_1: () =>
    "UPDATE identity.guide_profiles SET bio=$1,updated_at=now() WHERE user_id=$2 RETURNING user_id,bio,status,updated_at",
};
@Injectable()
export class IdentityRepository extends IdentityPort {
  constructor(readonly db: Database) {
    super();
  }
  async onModuleInit() {
    if (process.env.ADMIN_EMAIL && process.env.ADMIN_PASSWORD) {
      if (process.env.ADMIN_PASSWORD.length < 12)
        throw new Error("ADMIN_PASSWORD debe tener al menos 12 caracteres");
      await this.db.pool.query(
        `INSERT INTO identity.users(id,email,password_hash,name,role) VALUES($1,$2,$3,'Administrador demo','admin') ON CONFLICT(email) DO NOTHING`,
        [
          randomUUID(),
          process.env.ADMIN_EMAIL.toLowerCase(),
          passwordHash(process.env.ADMIN_PASSWORD),
        ],
      );
    }
  }

  async execute(
    command: string,
    params: any[] = [],
    c: Queryable = this.db.pool,
    kind?: string,
  ) {
    if (kind && !["routes", "comments", "photos"].includes(kind))
      throw new Error("Tipo de contenido inválido");
    return c.query(IDENTITY_SQL[command](kind), params);
  }
  transaction<T>(fn: (c: Queryable) => Promise<T>): Promise<T> {
    return this.db.tx(fn);
  }
}
@Injectable()
export class IdentityUseCases {
  constructor(readonly service: IdentityPort) {}
  async guideProfile(header: string, body: unknown) {
    const u = auth(header);
    const b = schema(z.object({ bio: text(2000) }).strict(), body);
    const r = await this.service.execute("guideProfile_1", [b.bio, u.sub]);
    if (!r.rows[0])
      throw new NotFoundException("Primero solicita la verificación de guía");
    return r.rows[0];
  }
  async register(body: unknown) {
    const b = schema(registration, body);
    const user = {
      id: randomUUID(),
      email: b.email,
      name: b.name,
      role: "hiker",
    };
    await this.service.execute(
      "register_1",
      [user.id, user.email, passwordHash(b.password), user.name],
      undefined,
    );
    return {
      user,
      access_token: sign({ sub: user.id, role: "hiker" }),
      token_type: "Bearer",
      expires_in: 900,
    };
  }
  async login(body: unknown) {
    const b = schema(login, body);
    const r = await this.service.execute("login_1", [b.email], undefined);
    const u = r.rows[0];
    if (!u || u.disabled || !passwordMatches(b.password, u.password_hash))
      throw new UnauthorizedException("Credenciales inválidas");
    return {
      access_token: sign({ sub: u.id, role: u.role }),
      token_type: "Bearer",
      expires_in: 900,
    };
  }
  async me(header: string) {
    const u = auth(header);
    const r = await this.service.execute("me_1", [u.sub], undefined);
    if (!r.rows[0] || r.rows[0].disabled)
      throw new UnauthorizedException("Cuenta deshabilitada");
    return r.rows[0];
  }
  async profile(header: string, body: unknown) {
    const u = auth(header);
    const b = schema(z.object({ name: text(100) }).strict(), body);
    const r = await this.service.execute(
      "profile_1",
      [b.name, u.sub],
      undefined,
    );
    return r.rows[0];
  }
  async publicProfile(userId: string) {
    const r = await this.service.execute(
      "publicProfile_1",
      [id(userId)],
      undefined,
    );
    if (!r.rows[0]) throw new NotFoundException();
    return r.rows[0];
  }
  async guide(header: string, body: unknown) {
    const u = auth(header);
    const b = schema(
      z.object({ bio: text(2000), credential_reference: text(200) }).strict(),
      body,
    );
    return this.service.transaction(async (c) => {
      const existing = await this.service.execute("guide_1", [u.sub], c);
      if (existing.rows[0]?.status === "verified")
        throw new BadRequestException("El perfil ya está verificado");
      const r = await this.service.execute(
        "guide_2",
        [u.sub, b.bio, b.credential_reference],
        c,
      );
      return r.rows[0];
    });
  }
  async guideQueue(header: string) {
    auth(header, "admin");
    return (await this.service.execute("guideQueue_1", [], undefined)).rows;
  }
  async review(header: string, userId: string, body: unknown) {
    const u = auth(header, "admin");
    const target = id(userId);
    const b = schema(z.object({ approve: z.boolean() }).strict(), body);
    if (target === u.sub)
      throw new BadRequestException(
        "Un administrador no puede verificarse a sí mismo",
      );
    return this.service.transaction(async (c) => {
      const r = await this.service.execute(
        "review_1",
        [b.approve ? "verified" : "rejected", u.sub, target],
        c,
      );
      if (!r.rows[0])
        throw new NotFoundException("Solicitud pendiente no encontrada");
      if (b.approve) await this.service.execute("review_2", [target], c);
      return r.rows[0];
    });
  }
  async disable(header: string, userId: string, body: unknown) {
    const u = auth(header, "admin");
    const target = id(userId);
    const b = schema(z.object({ disabled: z.boolean() }).strict(), body);
    if (target === u.sub)
      throw new BadRequestException("No puedes deshabilitar tu propia cuenta");
    const r = await this.service.execute(
      "disable_1",
      [b.disabled, target],
      undefined,
    );
    if (!r.rows[0]) throw new NotFoundException();
    return r.rows[0];
  }
}
@Controller("api")
export class IdentityController {
  constructor(readonly usecases: IdentityUseCases) {}
  @Patch("guides/me")
  async guideProfile(
    @Headers("authorization") header: string,
    @Body() body: unknown,
  ) {
    return this.usecases.guideProfile(header, body);
  }
  @Post("auth/register")
  async register(
    @Body()
    body: unknown,
  ) {
    return this.usecases.register(body);
  }
  @Post("auth/login")
  async login(
    @Body()
    body: unknown,
  ) {
    return this.usecases.login(body);
  }
  @Get("users/me")
  async me(
    @Headers("authorization")
    header: string,
  ) {
    return this.usecases.me(header);
  }
  @Patch("users/me")
  async profile(
    @Headers("authorization")
    header: string,
    @Body()
    body: unknown,
  ) {
    return this.usecases.profile(header, body);
  }
  @Get("users/:userId")
  async publicProfile(
    @Param("userId")
    userId: string,
  ) {
    return this.usecases.publicProfile(userId);
  }
  @Post("guides/applications")
  async guide(
    @Headers("authorization")
    header: string,
    @Body()
    body: unknown,
  ) {
    return this.usecases.guide(header, body);
  }
  @Get("admin/guides")
  async guideQueue(
    @Headers("authorization")
    header: string,
  ) {
    return this.usecases.guideQueue(header);
  }
  @Post("admin/guides/:userId/review")
  async review(
    @Headers("authorization")
    header: string,
    @Param("userId")
    userId: string,
    @Body()
    body: unknown,
  ) {
    return this.usecases.review(header, userId, body);
  }
  @Patch("admin/users/:userId")
  async disable(
    @Headers("authorization")
    header: string,
    @Param("userId")
    userId: string,
    @Body()
    body: unknown,
  ) {
    return this.usecases.disable(header, userId, body);
  }
}
