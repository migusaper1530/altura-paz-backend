import "reflect-metadata";
import { Controller, Get, Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { json } from "express";
import helmet from "helmet";
import { randomUUID } from "node:crypto";
import { ApiErrorFilter, Database } from "./core";
import {
  IdentityController,
  IdentityRepository,
  IdentityPort,
  IdentityUseCases,
} from "./identity";
import {
  TrailsController,
  TrailsRepository,
  TrailsPort,
  TrailsUseCases,
} from "./trails";
import { GatewayController, rateLimit } from "./gateway";
import { LedgerController, LedgerService, OutboxPublisher } from "./ledger";
import { ResilientHttp } from "./transport";
import { PublicListCache } from "./cache";

@Controller()
class HealthController {
  @Get("health") health() {
    return {
      status: "ok",
      service: process.env.SERVICE_MODE || "gateway",
      version: "0.2.0",
    };
  }
}
const definitions: any = {
  gateway: {
    controllers: [GatewayController],
    providers: [ResilientHttp, PublicListCache],
  },
  identity: {
    controllers: [IdentityController],
    providers: [
      Database,
      { provide: IdentityPort, useClass: IdentityRepository },
      IdentityUseCases,
    ],
  },
  trails: {
    controllers: [TrailsController],
    providers: [
      Database,
      { provide: TrailsPort, useClass: TrailsRepository },
      TrailsUseCases,
      ResilientHttp,
      OutboxPublisher,
    ],
  },
  ledger: {
    controllers: [LedgerController],
    providers: [Database, LedgerService],
  },
};
export async function createApplication(mode: string) {
  if (!definitions[mode]) throw new Error("SERVICE_MODE inválido");
  if (
    mode !== "ledger" &&
    (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32)
  )
    throw new Error("Configura JWT_SECRET de al menos 32 caracteres");
  if (
    mode === "trails" &&
    (!process.env.VISIT_SECRET || process.env.VISIT_SECRET.length < 32)
  )
    throw new Error("Configura VISIT_SECRET de al menos 32 caracteres");
  @Module({
    controllers: [HealthController, ...definitions[mode].controllers],
    providers: definitions[mode].providers,
  })
  class AppModule {}
  const app = await NestFactory.create(AppModule, { bodyParser: false });
  app.use(
    helmet({ contentSecurityPolicy: mode === "gateway" ? false : undefined }),
  );
  app.use((req: any, res: any, next: any) => {
    res.setHeader("X-Request-Id", randomUUID());
    next();
  });
  app.use(json({ limit: "8mb" }));
  if (mode === "gateway") app.use(rateLimit());
  app.useGlobalFilters(new ApiErrorFilter());
  app.enableShutdownHooks();
  return app;
}
if (require.main === module)
  void createApplication(process.env.SERVICE_MODE || "gateway").then((app) =>
    app.listen(Number(process.env.PORT || 3000), "0.0.0.0"),
  );
