import {
  ArgumentsHost,
  BadRequestException,
  Catch,
  ExceptionFilter,
  ForbiddenException,
  HttpException,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { Pool, PoolClient } from "pg";
import {
  randomBytes,
  scryptSync,
  timingSafeEqual,
  createHash,
} from "node:crypto";
import jwt from "jsonwebtoken";
import { z } from "zod";

export type User = { sub: string; role: "hiker" | "guide" | "admin" };
export type Queryable = Pick<PoolClient, "query">;
export const uuid = z.string().uuid();
export const id = (value: string) => uuid.parse(value);
export const text = (max: number) => z.string().trim().min(1).max(max);
export const point = z.tuple([
  z.number().min(-180).max(180),
  z.number().min(-90).max(90),
]);
export const schema = <T>(validator: z.ZodType<T>, value: unknown): T =>
  validator.parse(value);

export function auth(header?: string, role?: User["role"]): User {
  try {
    if (!header?.startsWith("Bearer ")) throw new Error();
    const user = jwt.verify(header.slice(7), process.env.JWT_SECRET!, {
      algorithms: ["HS256"],
      issuer: "altura-paz",
      audience: "altura-api",
    }) as User;
    uuid.parse(user.sub);
    if (!["hiker", "guide", "admin"].includes(user.role)) throw new Error();
    if (role && user.role !== role)
      throw new ForbiddenException("Permiso insuficiente");
    return user;
  } catch (error) {
    if (error instanceof ForbiddenException) throw error;
    throw new UnauthorizedException("Inicia sesión con un token vigente");
  }
}
export function sign(user: User): string {
  return jwt.sign(user, process.env.JWT_SECRET!, {
    algorithm: "HS256",
    expiresIn: "15m",
    issuer: "altura-paz",
    audience: "altura-api",
  });
}
export function passwordHash(password: string): string {
  const salt = randomBytes(16).toString("hex");
  return `${salt}:${scryptSync(password, salt, 64).toString("hex")}`;
}
export function passwordMatches(password: string, encoded: string): boolean {
  const [salt, digest] = encoded.split(":");
  const actual = scryptSync(password, salt, 64);
  const expected = Buffer.from(digest, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
export function canonical(value: any): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  return (
    "{" +
    Object.keys(value)
      .sort()
      .map((k) => JSON.stringify(k) + ":" + canonical(value[k]))
      .join(",") +
    "}"
  );
}
export function sha256(value: string): string {
  return "0x" + createHash("sha256").update(value).digest("hex");
}
export function proofId(routeId: string, version: number): string {
  return sha256(`${routeId}:${version}`);
}

@Injectable()
export class Database {
  readonly pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 10,
    connectionTimeoutMillis: 3000,
  });
  async tx<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
    const c = await this.pool.connect();
    try {
      await c.query("BEGIN");
      const result = await fn(c);
      await c.query("COMMIT");
      return result;
    } catch (error) {
      await c.query("ROLLBACK");
      throw error;
    } finally {
      c.release();
    }
  }
  async onModuleDestroy() {
    await this.pool.end();
  }
}

@Catch()
export class ApiErrorFilter implements ExceptionFilter {
  catch(error: any, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse();
    let status = 500,
      message: any = "Error interno";
    if (error instanceof z.ZodError) {
      status = 422;
      message = error.issues.map((i) => ({
        path: i.path.join("."),
        message: i.message,
      }));
    } else if (error instanceof HttpException) {
      status = error.getStatus();
      message = error.getResponse();
    } else if (error.code === "23505") {
      status = 409;
      message = "El registro ya existe";
    } else if (error.code === "22P02") {
      status = 422;
      message = "Formato inválido";
    } else if (error.type === "entity.too.large") {
      status = 413;
      message = "Archivo demasiado grande";
    }
    if (status === 500) console.error(error?.message);
    response
      .status(status)
      .json({
        error: message,
        status,
        request_id: response.getHeader("X-Request-Id"),
      });
  }
}
export function assertOwner(user: User, author: string) {
  if (user.sub !== author)
    throw new ForbiddenException("Solo el autor puede proponer cambios");
}
export function assertPublic(route: any) {
  if (route.state !== "published" || route.hidden)
    throw new BadRequestException("La ruta no está publicada");
}
