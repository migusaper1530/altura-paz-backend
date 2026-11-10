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
  ForbiddenException,
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
const account = z
  .object({
    email: z
      .email()
      .max(254)
      .transform((v) => v.toLowerCase()),
    password: z.string().min(12).max(128),
    name: text(100),
  })
  .strict();
const registration = z.preprocess(
  (value) => value && typeof value === "object" && !("role" in value)
    ? { ...value, role: "tourist" } : value,
  z.discriminatedUnion("role", [
    account.extend({ role: z.literal("tourist") }),
    account.extend({ role: z.literal("guide"), bio: text(2000), credential_reference: text(200) }),
    account.extend({
      role: z.literal("organization"), organization_name: text(150),
      organization_type: z.enum(["company", "group"]),
      description: z.string().trim().max(2000).default(""),
    }),
  ]),
);
const adminRegistration = account.extend({ role: z.literal("admin") });
const organizationProfile = z.object({
  organization_name: text(150).optional(),
  organization_type: z.enum(["company", "group"]).optional(),
  description: z.string().trim().max(2000).optional(),
}).strict().refine((value) => Object.keys(value).length > 0, "Indica al menos un campo");
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
    "INSERT INTO identity.users(id,email,password_hash,name,role) VALUES($1,$2,$3,$4,$5)",
  register_tourist: () => "INSERT INTO identity.tourist_profiles(user_id) VALUES($1)",
  register_guide: () => "INSERT INTO identity.guide_profiles(user_id,bio,credential_reference) VALUES($1,$2,$3)",
  register_organization: () => "INSERT INTO identity.organization_profiles(user_id,organization_name,organization_type,description) VALUES($1,$2,$3,$4)",
  register_admin: () => "INSERT INTO identity.admin_profiles(user_id) VALUES($1)",
  login_1: (kind?: string) => "SELECT * FROM identity.users WHERE email=$1",
  me_1: (kind?: string) =>
    `SELECT u.id,u.email,u.name,u.role,u.disabled,u.created_at,
     CASE u.role WHEN 'guide' THEN to_jsonb(g)-'user_id'
      WHEN 'organization' THEN to_jsonb(o)-'user_id' ELSE '{}'::jsonb END AS profile
     FROM identity.users u LEFT JOIN identity.guide_profiles g ON g.user_id=u.id
     LEFT JOIN identity.organization_profiles o ON o.user_id=u.id WHERE u.id=$1`,
  profile_1: (kind?: string) =>
    "UPDATE identity.users SET name=$1 WHERE id=$2 RETURNING id,name,role",
  publicProfile_1: (kind?: string) =>
    `SELECT u.id,u.name,u.role,g.bio,g.status AS guide_status,
     o.organization_name,o.organization_type,o.description AS organization_description
     FROM identity.users u LEFT JOIN identity.guide_profiles g ON g.user_id=u.id
     LEFT JOIN identity.organization_profiles o ON o.user_id=u.id WHERE u.id=$1 AND NOT u.disabled`,
  account_1: () => "SELECT role,disabled FROM identity.users WHERE id=$1 FOR UPDATE",
  organizationProfile_1: () =>
    `UPDATE identity.organization_profiles SET organization_name=COALESCE($1,organization_name),
     organization_type=COALESCE($2,organization_type),description=COALESCE($3,description),updated_at=now()
     WHERE user_id=$4 RETURNING *`,
  guide_1: (kind?: string) =>
    "SELECT status FROM identity.guide_profiles WHERE user_id=$1 FOR UPDATE",
  guide_2: (kind?: string) =>
    `INSERT INTO identity.guide_profiles(user_id,bio,credential_reference) VALUES($1,$2,$3) ON CONFLICT(user_id) DO UPDATE SET bio=$2,credential_reference=$3,status='pending',reviewed_at=NULL,updated_at=now() RETURNING *`,
  guideQueue_1: (kind?: string) =>
    `SELECT g.*,u.name FROM identity.guide_profiles g JOIN identity.users u ON u.id=g.user_id WHERE g.status='pending' ORDER BY g.updated_at LIMIT 100`,
  review_1: (kind?: string) =>
    `UPDATE identity.guide_profiles SET status=$1,reviewed_by=$2,reviewed_at=now() WHERE user_id=$3 AND status='pending' RETURNING *`,
  promote_1: () => "DELETE FROM identity.tourist_profiles WHERE user_id=$1",
  promote_2: () => "UPDATE identity.users SET role='guide' WHERE id=$1",
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
    const email = process.env.ADMIN_EMAIL;
    const password = process.env.ADMIN_PASSWORD;
    if (email && password) {
      if (password.length < 12)
        throw new Error("ADMIN_PASSWORD debe tener al menos 12 caracteres");
      await this.db.tx(async (c) => {
        const inserted = await c.query(
          `INSERT INTO identity.users(id,email,password_hash,name,role) VALUES($1,$2,$3,'Administrador demo','admin') ON CONFLICT(email) DO NOTHING RETURNING id`,
          [randomUUID(), email.toLowerCase(), passwordHash(password)],
        );
        if (inserted.rows[0])
          await c.query("INSERT INTO identity.admin_profiles(user_id) VALUES($1)", [inserted.rows[0].id]);
      });
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
    const user = await this.createUser(b);
    return {
      user,
      access_token: sign({ sub: user.id, role: user.role }),
      token_type: "Bearer",
      expires_in: 900,
    };
  }
  private async createUser(b: z.infer<typeof registration> | z.infer<typeof adminRegistration>) {
    const user = {
      id: randomUUID(),
      email: b.email,
      name: b.name,
      role: b.role,
    };
    await this.service.transaction(async (c) => {
      await this.service.execute(
        "register_1",
        [user.id, user.email, passwordHash(b.password), user.name, user.role], c,
      );
      const params = b.role === "guide" ? [user.id, b.bio, b.credential_reference]
        : b.role === "organization" ? [user.id, b.organization_name, b.organization_type, b.description]
        : [user.id];
      await this.service.execute(`register_${b.role}`, params, c);
    });
    return user;
  }
  async createAdmin(header: string, body: unknown) {
    auth(header, "admin");
    return { user: await this.createUser(schema(adminRegistration, body)) };
  }
  async organization(header: string, body: unknown) {
    const u = auth(header);
    const b = schema(organizationProfile, body);
    const result = await this.service.execute("organizationProfile_1", [
      b.organization_name, b.organization_type, b.description, u.sub,
    ]);
    if (!result.rows[0]) throw new ForbiddenException("Se requiere una cuenta de empresa o grupo");
    return result.rows[0];
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
      const account = (await this.service.execute("account_1", [u.sub], c)).rows[0];
      if (!account || account.disabled) throw new UnauthorizedException("Cuenta deshabilitada");
      if (!["tourist", "guide"].includes(account.role))
        throw new ForbiddenException("Solo turistas o guías pueden solicitar esta verificación");
      const existing = await this.service.execute("guide_1", [u.sub], c);
      if (existing.rows[0]?.status === "verified")
        throw new BadRequestException("El perfil ya está verificado");
      const r = await this.service.execute(
        "guide_2",
        [u.sub, b.bio, b.credential_reference],
        c,
      );
      if (account.role === "tourist") {
        await this.service.execute("promote_1", [u.sub], c);
        await this.service.execute("promote_2", [u.sub], c);
      }
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
  @Post("admin/users")
  async createAdmin(@Headers("authorization") header: string, @Body() body: unknown) {
    return this.usecases.createAdmin(header, body);
  }
  @Patch("organizations/me")
  async organization(@Headers("authorization") header: string, @Body() body: unknown) {
    return this.usecases.organization(header, body);
  }
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
