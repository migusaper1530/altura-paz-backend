import { randomUUID } from "node:crypto";
import {
  auth,
  canonical,
  passwordHash,
  passwordMatches,
  proofId,
  sha256,
  sign,
  id,
  assertOwner,
  assertPublic,
  ApiErrorFilter,
  Database,
} from "../src/core";
import { BadRequestException, ForbiddenException } from "@nestjs/common";
import { z } from "zod";
beforeAll(() => {
  process.env.JWT_SECRET = "test-secret-that-has-more-than-32-characters";
});
test("contraseña salada y comparación constante", () => {
  const a = passwordHash("un secreto suficientemente largo");
  const b = passwordHash("un secreto suficientemente largo");
  expect(a).not.toBe(b);
  expect(passwordMatches("un secreto suficientemente largo", a)).toBe(true);
  expect(passwordMatches("otro secreto", a)).toBe(false);
  expect(passwordMatches("otro", a.split(":")[0] + ":aa")).toBe(false);
});
test("JWT limita rol, algoritmo, audiencia y vencimiento", () => {
  const u = { sub: randomUUID(), role: "tourist" as const };
  expect(auth("Bearer " + sign(u))).toMatchObject(u);
  for (const role of ["tourist", "guide", "organization", "admin"] as const)
    expect(auth("Bearer " + sign({ sub: u.sub, role })).role).toBe(role);
  expect(auth("Bearer " + sign({ sub: u.sub, role: "hiker" as any })).role).toBe("tourist");
  expect(() => auth()).toThrow();
  expect(() => auth("Basic abc")).toThrow();
  expect(() => auth("Bearer inválido")).toThrow();
  expect(() => auth("Bearer " + sign(u), "admin")).toThrow(ForbiddenException);
  expect(() =>
    auth("Bearer " + sign({ sub: "not-uuid", role: "admin" })),
  ).toThrow();
  expect(() =>
    auth("Bearer " + sign({ sub: randomUUID(), role: "invalid" as any })),
  ).toThrow();
});
test("canonicalización estable, SHA-256 y separación de versiones", () => {
  expect(canonical({ z: 3, a: [{ b: true, a: null }, "á"] })).toBe(
    canonical({ a: [{ a: null, b: true }, "á"], z: 3 }),
  );
  expect(sha256("abc")).toBe(
    "0xba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
  );
  const route = randomUUID();
  expect(proofId(route, 1)).not.toBe(proofId(route, 2));
});
test("permisos por autor y estado publicado", () => {
  const u = { sub: randomUUID(), role: "tourist" as const };
  expect(() => assertOwner(u, u.sub)).not.toThrow();
  expect(() => assertOwner(u, randomUUID())).toThrow();
  expect(() =>
    assertPublic({ state: "published", hidden: false }),
  ).not.toThrow();
  expect(() => assertPublic({ state: "draft" })).toThrow();
  expect(() => assertPublic({ state: "published", hidden: true })).toThrow();
  expect(id(u.sub)).toBe(u.sub);
  expect(() => id("wrong")).toThrow();
});
test.each([
  [new BadRequestException("test"), 400],
  [{ code: "23505" }, 409],
  [{ code: "22P02" }, 422],
  [{ type: "entity.too.large" }, 413],
  [new z.ZodError([{ code: "custom", path: ["field"], message: "test" }]), 422],
  [new Error("unexpected"), 500],
])("errores no filtran detalles de la base", (error, status) => {
  const res: any = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn(),
    getHeader: () => "request-id",
  };
  const host: any = { switchToHttp: () => ({ getResponse: () => res }) };
  const log = jest.spyOn(console, "error").mockImplementation(() => {});
  new ApiErrorFilter().catch(error, host);
  expect(res.status).toHaveBeenCalledWith(status);
  expect(res.json).toHaveBeenCalledWith(
    expect.objectContaining({ status, request_id: "request-id" }),
  );
  log.mockRestore();
});
test("transacciones hacen rollback y siempre liberan conexión", async () => {
  const db = new Database();
  const c: any = { query: jest.fn().mockResolvedValue({}), release: jest.fn() };
  jest.spyOn(db.pool as any, "connect").mockResolvedValue(c);
  await expect(db.tx(async () => 42)).resolves.toBe(42);
  expect(c.query).toHaveBeenCalledWith("COMMIT");
  await expect(
    db.tx(async () => {
      throw new Error("stop");
    }),
  ).rejects.toThrow("stop");
  expect(c.query).toHaveBeenCalledWith("ROLLBACK");
  expect(c.release).toHaveBeenCalledTimes(2);
  await db.onModuleDestroy();
});
