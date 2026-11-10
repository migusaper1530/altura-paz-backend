import {
  All,
  Controller,
  Get,
  HttpException,
  Req,
  Res,
  UnauthorizedException,
} from "@nestjs/common";
import { Request, Response } from "express";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ResilientHttp } from "./transport";
import { PublicListCache } from "./cache";
@Controller()
export class GatewayController {
  constructor(
    readonly http: ResilientHttp,
    readonly cache: PublicListCache,
  ) {}
  @Get() index(@Res() res: Response) {
    res
      .type("html")
      .send(
        `<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Altura Paz · demostración</title><style>body{font:18px Lato,Arial,sans-serif;color:#183f4c;background:#eef3f5;max-width:1100px;margin:48px auto;padding:0 24px}a{color:#176383}p{max-width:75ch;line-height:1.6}img{width:100%;border:1px solid #c9d7dd;border-radius:8px}nav{display:flex;gap:24px;margin:28px 0}</style><h1>Altura Paz</h1><p>Backend para explorar y compartir rutas en los alrededores de La Paz. Importa un GPX, publica la ruta y registra una finalización manual desde la API.</p><nav><a href="/docs">Abrir API interactiva</a><a href="/openapi.json">Contrato OpenAPI</a><a href="/health">Estado del gateway</a></nav><p>Esta pantalla es conceptual. El trazado y sus cifras son ilustrativos y no sirven para navegar. El backend se demuestra con la API y el guion incluido.</p><img src="/concepto.svg" alt="Vista conceptual: mapa, trazado y ficha de una ruta"></html>`,
      );
  }
  @Get("concepto.svg") async concept(@Res() res: Response) {
    res
      .type("svg")
      .send(await readFile(join(process.cwd(), "public", "concepto.svg")));
  }
  @Get("openapi.json") async api(@Res() res: Response) {
    res
      .type("json")
      .send(await readFile(join(process.cwd(), "docs", "openapi.json")));
  }
  @Get("docs") docs(@Res() res: Response) {
    res
      .type("html")
      .send(
        `<!DOCTYPE html><html lang="es"><meta charset="utf-8"><title>Altura Paz API</title><link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css"><div id="swagger-ui"></div><script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"></script><script>SwaggerUIBundle({url:'/openapi.json',dom_id:'#swagger-ui',persistAuthorization:false,tryItOutEnabled:true})</script></html>`,
      );
  }
  @All("api/*path") async proxy(@Req() req: Request, @Res() res: Response) {
    const path = req.path;
    const identity =
      /^\/api\/(auth|users|guides|organizations)(\/|$)/.test(path) ||
      /^\/api\/admin\/(guides|users)(\/|$)/.test(path);
    const ledger = path.startsWith("/api/proofs/");
    const service = identity ? "identity" : ledger ? "ledger" : "trails";
    const base = process.env[service.toUpperCase() + "_URL"];
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (req.headers.authorization) {
      headers.Authorization = req.headers.authorization;
      // Comprobación central del estado de cuenta, además de JWT en cada servicio.
      if (!path.startsWith("/api/auth/")) {
        const check = await this.http.request(
          "identity",
          `${process.env.IDENTITY_URL}/api/users/me`,
          { headers },
        );
        if (!check.ok)
          throw new UnauthorizedException(
            "Sesión inválida o cuenta deshabilitada",
          );
        await check.arrayBuffer();
      }
    }
    const load = async () => {
      const upstream = await this.http.request(
        service,
        base + req.originalUrl,
        {
          method: req.method,
          headers,
          body: ["GET", "HEAD"].includes(req.method)
            ? undefined
            : JSON.stringify(req.body),
        },
        20000,
      );
      return {
        status: upstream.status,
        contentType: upstream.headers.get("content-type") || "application/json",
        body: Buffer.from(await upstream.arrayBuffer()),
      };
    };
    const cacheable =
      req.method === "GET" &&
      path === "/api/routes" &&
      !req.headers.authorization;
    const result = cacheable
      ? await this.cache.get(req.originalUrl, load)
      : await load();
    if (!["GET", "HEAD"].includes(req.method) && result.status < 300)
      this.cache.clear();
    res.status(result.status);
    res.setHeader("Content-Type", result.contentType);
    res.setHeader("Cache-Control", "no-store");
    res.send(result.body);
  }
}
export function rateLimit() {
  const buckets = new Map<string, { count: number; until: number }>();
  let calls = 0;
  return (req: Request, res: Response, next: () => void) => {
    const login = req.path.startsWith("/api/auth/");
    const key = (req.ip || "unknown") + (login ? ":auth" : ":api");
    const now = Date.now();
    if (++calls % 1000 === 0)
      for (const [k, v] of buckets) if (v.until < now) buckets.delete(k);
    const b = buckets.get(key) || { count: 0, until: now + 60000 };
    if (b.until < now) {
      b.count = 0;
      b.until = now + 60000;
    }
    buckets.set(key, b);
    b.count++;
    const limit = Number(
      process.env[login ? "AUTH_RATE_LIMIT" : "API_RATE_LIMIT"] ||
        (login ? 20 : 600),
    );
    if (b.count > limit) {
      res.setHeader("Retry-After", String(Math.ceil((b.until - now) / 1000)));
      res
        .status(429)
        .json({ error: "Demasiadas solicitudes; espera un minuto" });
      return;
    }
    next();
  };
}
