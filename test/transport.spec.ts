import { ResilientHttp } from "../src/transport";
import { rateLimit } from "../src/gateway";
afterEach(() => jest.restoreAllMocks());
test("circuit breaker abre, limita llamadas y se recupera", async () => {
  const h = new ResilientHttp();
  let now = 100000;
  const clock = jest.spyOn(Date, "now").mockImplementation(() => now);
  const f = jest.spyOn(global, "fetch").mockRejectedValue(new Error("network"));
  for (let i = 0; i < 5; i++)
    await expect(h.request("a", "http://service")).rejects.toThrow();
  await expect(h.request("a", "http://service")).rejects.toThrow(
    "temporalmente",
  );
  expect(f).toHaveBeenCalledTimes(5);
  now += 15001;
  f.mockResolvedValue(new Response("{}"));
  await expect(h.request("a", "http://service")).resolves.toHaveProperty(
    "status",
    200,
  );
  await expect(h.request("a", "http://service")).resolves.toHaveProperty(
    "status",
    200,
  );
});
test("fallas 5xx cuentan y errores de usuario no abren circuito", async () => {
  const h = new ResilientHttp();
  const f = jest
    .spyOn(global, "fetch")
    .mockResolvedValue(new Response("{}", { status: 503 }));
  for (let i = 0; i < 5; i++) await h.request("a", "http://service");
  await expect(h.request("a", "http://service")).rejects.toThrow();
  f.mockResolvedValue(new Response("{}", { status: 422 }));
  for (let i = 0; i < 6; i++)
    expect((await h.request("b", "http://service")).status).toBe(422);
});
test("límite de autenticación aislado y ventana renovable", () => {
  let now = 100000;
  jest.spyOn(Date, "now").mockImplementation(() => now);
  const limit = rateLimit();
  const next = jest.fn();
  const res: any = {
    setHeader: jest.fn(),
    status: jest.fn().mockReturnThis(),
    json: jest.fn(),
  };
  const req: any = { ip: "127.0.0.1", path: "/api/auth/login" };
  for (let i = 0; i < 21; i++) limit(req, res, next);
  expect(next).toHaveBeenCalledTimes(20);
  expect(res.status).toHaveBeenCalledWith(429);
  now += 60001;
  limit(req, res, next);
  expect(next).toHaveBeenCalledTimes(21);
  for (let i = 0; i < 1001; i++)
    limit({ ip: "viewer-" + i, path: "/api/routes" } as any, res, next);
});
