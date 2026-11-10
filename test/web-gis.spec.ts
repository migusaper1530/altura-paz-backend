import { WebGisService, osmFeatures, geometryLength } from "../src/web-gis";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createApplication } from "../src/main";
import { INestApplication, ServiceUnavailableException } from "@nestjs/common";

const geometry = [{ lon: -68.09, lat: -16.56 }, { lon: -68.089, lat: -16.559 }];
const way = (id = 1, tags: any = {}) => ({ type: "way", id, geometry, tags: { highway: "path", name: "Sendero", ...tags } });
const data = (...elements: any[]) => ({ elements });
const response = (payload: any, status = 200) => new Response(JSON.stringify(payload), { status, headers: { "Content-Type": "application/json" } });
let directory: string;
beforeEach(async () => { directory = await mkdtemp(join(tmpdir(), "altura-gis-test-")); process.env.GIS_CACHE_DIR = directory; });
afterEach(async () => { jest.restoreAllMocks(); await rm(directory, { recursive: true, force: true }); delete process.env.GIS_CACHE_DIR; });
test("convierte una muestra web real de Mallasa sin inventar dificultad, altura ni duración", async () => {
  const payload = JSON.parse(await readFile("test/fixtures/osm-mallasa.json", "utf8"));
  const features = osmFeatures(payload);
  expect(features).toHaveLength(3);
  const trail = features.find(f => f.properties.osm_id === 450286550);
  expect(trail.properties).toMatchObject({ name: "Sendero Del Águila", source: "OpenStreetMap", license: "ODbL-1.0", kind: "trail_segment", difficulty: null, ascent_m: null, estimated_minutes: null });
  expect(trail.properties.source_url).toBe("https://www.openstreetmap.org/way/450286550");
  expect(trail.properties.distance_m).toBeCloseTo(876.3, 1);
  expect(trail.geometry.coordinates[0][0]).toHaveLength(2);
  expect(JSON.stringify(features)).not.toMatch(/"user"|"uid"|"changeset"/);
});
test("conserva segmentos de relación, respeta backward y evita duplicar sus miembros", () => {
  const features = osmFeatures(data(way(), { type: "relation", id: 2, tags: { route: "hiking", name: "Circuito" }, members: [{ type: "way", ref: 1, role: "backward", geometry }] }));
  expect(features).toHaveLength(1);
  expect(features[0].geometry.coordinates[0][0]).toEqual([-68.089, -16.559]);
  expect(features[0].properties.kind).toBe("hiking_route");
  const other = osmFeatures(data(way(), { type: "relation", id: 3, tags: { route: "foot" }, members: [{ type: "way", ref: 9 }] }));
  expect(other).toHaveLength(1); expect(other[0].id).toBe("osm-way-1");
});
test("omite privados, cruces, geometrías incompletas y datos parciales; no une huecos", () => {
  const features = osmFeatures(data(way(1, { access: "private" }), way(2, { foot: "no" }), way(6, { foot: "private" }), way(3, { footway: "sidewalk", highway: "footway" }), { ...way(4), geometry: [geometry[0], null, geometry[1]] }, way(5), way(5)));
  expect(features.map(f => f.id)).toEqual(["osm-way-5"]);
  expect(() => osmFeatures({ elements: [], remark: "timeout" })).toThrow();
  expect(() => osmFeatures({})).toThrow();
  expect(geometryLength([[[-68, -16], [-68, -16]], [[-67, -15], [-67, -15]]])).toBe(0);
});
test("agrupa solicitudes simultáneas, persiste caché y la reutiliza tras reiniciar el servicio", async () => {
  const fetcher = jest.spyOn(globalThis, "fetch").mockImplementation(async () => response(data(way())));
  const service = new WebGisService();
  const results = await Promise.all([service.routes({}), service.routes({})]);
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(results[0].transport).toBe("overpass");
  const second = await new WebGisService().routes({ area: "mallasa" });
  expect(second.cache_status).toBe("fresh"); expect(fetcher).toHaveBeenCalledTimes(1);
  expect(JSON.parse(await readFile(join(directory, "mallasa.json"), "utf8")).features).toHaveLength(1);
});
test("usa el respaldo oficial si Overpass falla y conserva la consulta acotada", async () => {
  const fetcher = jest.spyOn(globalThis, "fetch").mockResolvedValueOnce(response({}, 502)).mockResolvedValueOnce(response(data(way())));
  const result = await new WebGisService().routes({ area: "palca" });
  expect(result.transport).toBe("osm-map-api");
  expect(String(fetcher.mock.calls[1][0])).toBe("https://api.openstreetmap.org/api/0.6/map.json?bbox=-67.96,-16.57,-67.94,-16.55");
  expect(result.features[0].geometry.type).toBe("MultiLineString");
});
test("si ambas fuentes fallan devuelve error y limita reintentos, sin datos de ejemplo", async () => {
  const fetcher = jest.spyOn(globalThis, "fetch").mockRejectedValue(new Error("offline"));
  const service = new WebGisService();
  await expect(service.routes({})).rejects.toBeInstanceOf(ServiceUnavailableException);
  await expect(service.routes({})).rejects.toBeInstanceOf(ServiceUnavailableException);
  expect(fetcher).toHaveBeenCalledTimes(2);
  await expect(service.routes({ area: "otro" })).rejects.toThrow();
  await expect(service.routes({ bbox: "todo-el-mundo" })).rejects.toThrow();
});
test("caché vencida se identifica como antigua y nunca se reemplaza por una respuesta parcial", async () => {
  const fetcher = jest.spyOn(globalThis, "fetch").mockResolvedValue(response(data(way())));
  const service = new WebGisService(); await service.routes({});
  const file = join(directory, "mallasa.json"); const saved = JSON.parse(await readFile(file, "utf8"));
  saved.fetched_at = new Date(Date.now() - 8 * 3600000).toISOString(); await writeFile(file, JSON.stringify(saved));
  fetcher.mockImplementation(async () => response({ elements: [], remark: "timeout" }));
  const refreshed = await new WebGisService().routes({});
  expect(refreshed.cache_status).toBe("stale"); expect(refreshed.features).toHaveLength(1); expect(refreshed.fetched_at).toBe(saved.fetched_at);
});
test("el endpoint GIS del gateway tiene prioridad sobre el proxy y entrega GeoJSON", async () => {
  process.env.JWT_SECRET = "gis-gateway-test-secret-with-more-than-32-characters";
  const actualFetch = globalThis.fetch;
  jest.spyOn(globalThis, "fetch").mockImplementation(async (url, options) => String(url).startsWith("http://127.0.0.1:") ? actualFetch(url, options) : response(data(way())));
  let app: INestApplication | undefined;
  try {
    app = await createApplication("gateway"); await app.listen(0, "127.0.0.1");
    const base = "http://127.0.0.1:" + app.getHttpServer().address().port;
    const r = await actualFetch(base + "/api/gis/routes?area=mallasa");
    expect(r.status).toBe(200); expect((await r.json()).features[0].id).toBe("osm-way-1");
    expect((await actualFetch(base + "/api/gis/routes?area=bad")).status).toBe(422);
  } finally { await app?.close(); }
});
