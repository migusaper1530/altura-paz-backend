import { PublicListCache } from "../src/cache";
const value = {
  status: 200,
  contentType: "application/json",
  body: Buffer.from("{}"),
};
afterEach(() => jest.restoreAllMocks());
test("reutiliza durante un segundo y agrupa consultas simultáneas", async () => {
  let now = 100;
  jest.spyOn(Date, "now").mockImplementation(() => now);
  const c = new PublicListCache();
  const load = jest.fn().mockResolvedValue(value);
  await Promise.all([c.get("routes", load), c.get("routes", load)]);
  expect(load).toHaveBeenCalledTimes(1);
  await c.get("routes", load);
  expect(load).toHaveBeenCalledTimes(1);
  now += 1001;
  await c.get("routes", load);
  expect(load).toHaveBeenCalledTimes(2);
  c.clear();
  await c.get("routes", load);
  expect(load).toHaveBeenCalledTimes(3);
});
test("no conserva errores, respuestas grandes o resultados previos a una escritura", async () => {
  const c = new PublicListCache();
  const fail = jest.fn().mockResolvedValue({ ...value, status: 503 });
  await c.get("a", fail);
  await c.get("a", fail);
  expect(fail).toHaveBeenCalledTimes(2);
  const big = jest
    .fn()
    .mockResolvedValue({ ...value, body: Buffer.alloc(300000) });
  await c.get("a", big);
  await c.get("a", big);
  expect(big).toHaveBeenCalledTimes(2);
  let resolve: any;
  const p = c.get("x", () => new Promise((r) => (resolve = r)));
  c.clear();
  resolve(value);
  await p;
  const fresh = jest.fn().mockResolvedValue(value);
  await c.get("x", fresh);
  expect(fresh).toHaveBeenCalled();
});
test("limita memoria a cien entradas y libera consultas fallidas", async () => {
  const c = new PublicListCache();
  const load = jest.fn().mockResolvedValue(value);
  for (let i = 0; i < 101; i++) await c.get("route" + i, load);
  await c.get("route0", load);
  expect(load).toHaveBeenCalledTimes(102);
  await expect(
    c.get("error", async () => {
      throw new Error("network");
    }),
  ).rejects.toThrow();
  await expect(c.get("error", load)).resolves.toEqual(value);
});
