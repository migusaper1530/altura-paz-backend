import { Controller, Get, Injectable, Query, ServiceUnavailableException } from "@nestjs/common";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";

// Áreas pequeñas y fijas: evitan consultas arbitrarias o extracciones masivas.
export const GIS_AREAS = {
  mallasa: { name: "Mallasa y Valle de la Luna", bbox: [-68.10, -16.57, -68.08, -16.55] },
  palca: { name: "Palca", bbox: [-67.96, -16.57, -67.94, -16.55] },
  sur: { name: "Zona sur de La Paz", bbox: [-68.05, -16.61, -68.03, -16.59] },
  cordillera: { name: "Cordillera, sector Chacaltaya", bbox: [-68.14, -16.36, -68.12, -16.34] },
} as const;
type Area = keyof typeof GIS_AREAS;
type Coordinate = [number, number];
const TTL = 6 * 3600000;
const MAX_STALE = 7 * 24 * 3600000;
const MAX_BYTES = 12 * 1024 * 1024;
const agent = "AlturaPaz/0.3 (+https://github.com/migusaper1530/altura-paz-backend)";
const isCoordinate = (v: any): v is Coordinate => Array.isArray(v) && Number.isFinite(v[0]) && Number.isFinite(v[1]) && Math.abs(v[0]) <= 180 && Math.abs(v[1]) <= 90;
function segments(points: any[], nodes: Map<number, any>): Coordinate[][] {
  const result: Coordinate[][] = []; let current: Coordinate[] = [];
  for (const item of points) {
    const p = typeof item === "number" ? nodes.get(item) : item;
    const coordinate: Coordinate = [p?.lon, p?.lat];
    if (isCoordinate(coordinate)) current.push(coordinate);
    else { if (current.length > 1) result.push(current); current = []; }
  }
  if (current.length > 1) result.push(current);
  return result;
}
export function geometryLength(lines: Coordinate[][]) {
  let length = 0; const rad = Math.PI / 180;
  for (const line of lines) for (let i = 1; i < line.length; i++) {
    const [x1, y1] = line[i - 1], [x2, y2] = line[i];
    const a = Math.sin((y2 - y1) * rad / 2) ** 2 + Math.cos(y1 * rad) * Math.cos(y2 * rad) * Math.sin((x2 - x1) * rad / 2) ** 2;
    length += 6371008.8 * 2 * Math.asin(Math.sqrt(Math.min(1, a)));
  }
  return Math.round(length * 10) / 10;
}
export function osmFeatures(payload: any) {
  if (!Array.isArray(payload?.elements) || payload.elements.length > 100000 || payload.remark)
    throw new Error("Respuesta GIS incompleta o inválida");
  const nodes = new Map<number, any>(), ways = new Map<number, any>();
  for (const e of payload.elements) { if (e.type === "node") nodes.set(e.id, e); if (e.type === "way") ways.set(e.id, e); }
  const covered = new Set<number>(), seen = new Set<string>(), features: any[] = [];
  const permitted = (tags: any) => !["private", "no"].includes(tags.access) && !["private", "no"].includes(tags.foot);
  function add(e: any, coordinates: Coordinate[][], kind: string) {
    const tags = e.tags || {}, id = `osm-${e.type}-${e.id}`;
    if (!coordinates.length || seen.has(id) || !Number.isSafeInteger(e.id) || !permitted(tags)) return false;
    seen.add(id);
    const sourceTags: Record<string, string> = {};
    for (const key of ["route", "highway", "surface", "sac_scale", "trail_visibility", "access", "foot", "network", "operator", "distance", "ascent", "descent", "roundtrip"])
      if (typeof tags[key] === "string") sourceTags[key] = tags[key].slice(0, 1000);
    features.push({ type: "Feature", id, geometry: { type: "MultiLineString", coordinates }, properties: {
      name: String(tags["name:es"] || tags.name || tags.ref || (kind === "hiking_route" ? `Ruta de senderismo OSM ${e.id}` : `Sendero OSM ${e.id}`)).slice(0, 200),
      description: String(tags["description:es"] || tags.description || "Trazado obtenido de la cartografía colaborativa de OpenStreetMap.").slice(0, 5000),
      source: "OpenStreetMap", source_url: `https://www.openstreetmap.org/${e.type}/${e.id}`,
      osm_type: e.type, osm_id: e.id, kind, license: "ODbL-1.0", source_tags: sourceTags,
      distance_m: geometryLength(coordinates), distance_method: "geometry_haversine",
      // No deducir dificultad turística, altura o tiempos de una línea cartográfica.
      difficulty: null, ascent_m: null, estimated_minutes: null,
    } });
    return true;
  }
  for (const e of payload.elements) {
    if (e.type !== "relation" || !["hiking", "foot"].includes(e.tags?.route)) continue;
    const lines: Coordinate[][] = [], memberIds: number[] = [];
    let complete = true;
    for (const member of e.members || []) {
      if (member.type !== "way" || ["alternative", "excursion"].includes(member.role)) continue;
      const way = ways.get(member.ref);
      if (way && !permitted(way.tags || {})) { complete = false; break; }
      const geometry = member.geometry || way?.geometry || way?.nodes;
      if (!Array.isArray(geometry)) { complete = false; break; }
      const parts = segments(geometry, nodes);
      if (!parts.length || parts.reduce((n, line) => n + line.length, 0) !== geometry.length) { complete = false; break; }
      if (member.role === "backward") { parts.reverse(); parts.forEach(line => line.reverse()); }
      lines.push(...parts); memberIds.push(member.ref);
    }
    if (complete && add(e, lines, "hiking_route")) memberIds.forEach(id => covered.add(id));
  }
  for (const e of payload.elements) {
    if (e.type !== "way" || covered.has(e.id) || !["path", "footway"].includes(e.tags?.highway) || ["sidewalk", "crossing"].includes(e.tags?.footway)) continue;
    if (!Array.isArray(e.geometry || e.nodes)) continue;
    add(e, segments(e.geometry || e.nodes, nodes), "trail_segment");
  }
  return features.sort((a, b) => (a.properties.kind === "hiking_route" ? 0 : 1) - (b.properties.kind === "hiking_route" ? 0 : 1) || a.properties.name.localeCompare(b.properties.name)).slice(0, 150);
}
@Injectable()
export class WebGisService {
  private cache = new Map<Area, any>();
  private inFlight = new Map<Area, Promise<any>>();
  private retryAfter = new Map<Area, number>();
  private directory() { return process.env.GIS_CACHE_DIR || join(process.cwd(), "gis-cache"); }
  async routes(query: unknown) {
    const { area } = z.object({ area: z.enum(["mallasa", "palca", "sur", "cordillera"]).default("mallasa") }).strict().parse(query);
    if (!this.cache.has(area)) {
      try {
        const saved = JSON.parse(await readFile(join(this.directory(), `${area}.json`), "utf8"));
        if (this.validCache(saved, area)) this.cache.set(area, saved);
      } catch { /* Primera consulta o caché no válida: consultar la fuente. */ }
    }
    const saved = this.cache.get(area), age = saved ? Date.now() - Date.parse(saved.fetched_at) : Infinity;
    if (saved && age >= 0 && age < TTL) return { ...saved, cache_status: "fresh" };
    if ((this.retryAfter.get(area) || 0) > Date.now()) {
      if (saved && age < MAX_STALE) return { ...saved, cache_status: "stale", warning: "La fuente GIS no responde; se conserva la última consulta disponible." };
      throw new ServiceUnavailableException("La fuente GIS no responde. Vuelve a intentarlo en un minuto.");
    }
    if (this.inFlight.has(area)) return this.inFlight.get(area)!;
    const pending = this.refresh(area, saved).finally(() => this.inFlight.delete(area));
    this.inFlight.set(area, pending); return pending;
  }
  private validCache(saved: any, area: Area) {
    return saved?.schema_version === 1 && saved.area === area && saved.type === "FeatureCollection" &&
      Number.isFinite(Date.parse(saved.fetched_at)) && Date.parse(saved.fetched_at) <= Date.now() &&
      Array.isArray(saved.features) && saved.features.length <= 150 && saved.features.every((f: any) =>
        /^osm-(way|relation)-\d+$/.test(f.id) && f.geometry?.type === "MultiLineString" &&
        Array.isArray(f.geometry.coordinates) && f.geometry.coordinates.every((line: any) => Array.isArray(line) && line.length > 1 && line.every(isCoordinate)));
  }
  private async json(url: string, timeout: number) {
    const response = await fetch(url, { headers: { "User-Agent": agent, Accept: "application/json" }, signal: AbortSignal.timeout(timeout), redirect: "error" });
    if (!response.ok || Number(response.headers.get("content-length")) > MAX_BYTES) throw new Error("Fuente GIS no disponible");
    const reader = response.body?.getReader(); if (!reader) throw new Error("Respuesta GIS vacía");
    const chunks: Uint8Array[] = []; let size = 0;
    try {
      while (true) { const { done, value } = await reader.read(); if (done) break; size += value.byteLength; if (size > MAX_BYTES) throw new Error("Respuesta GIS demasiado grande"); chunks.push(value); }
      return JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch (error) { await reader.cancel().catch(() => {}); throw error; }
  }
  private async refresh(area: Area, saved: any) {
    try {
      const { bbox } = GIS_AREAS[area], [west, south, east, north] = bbox;
      const bounds = `${south},${west},${north},${east}`;
      const query = `[out:json][timeout:8][maxsize:12582912];relation["type"="route"]["route"~"^(hiking|foot)$"](${bounds});out geom 50;way["highway"~"^(path|footway)$"]["access"!~"^(private|no)$"]["foot"!~"^(private|no)$"](${bounds});out geom 150;`;
      let payload: any, transport: string, endpoint: string;
      try {
        endpoint = "https://overpass-api.de/api/interpreter";
        payload = await this.json(endpoint + "?" + new URLSearchParams({ data: query }), 10000);
        // Las consultas incompletas de Overpass no sustituyen una caché correcta.
        if (payload.remark || !Array.isArray(payload.elements)) throw new Error("Consulta Overpass incompleta");
        transport = "overpass";
      } catch {
        // Respaldo acotado de ~2x2 km; nunca extrae una ciudad completa con la API de edición.
        endpoint = "https://api.openstreetmap.org/api/0.6/map.json?bbox=" + bbox.join(",");
        payload = await this.json(endpoint, 15000); transport = "osm-map-api";
      }
      const result = {
        type: "FeatureCollection", schema_version: 1, area, area_name: GIS_AREAS[area].name, bbox,
        source: "OpenStreetMap", attribution: "© OpenStreetMap contributors", license: "ODbL-1.0",
        license_url: "https://www.openstreetmap.org/copyright", transport, endpoint,
        fetched_at: new Date().toISOString(), source_timestamp: payload.osm3s?.timestamp_osm_base || null,
        scope: "Área acotada; los senderos cartografiados no equivalen a recorridos turísticos verificados.",
        features: osmFeatures(payload),
      };
      this.cache.set(area, result); this.retryAfter.delete(area);
      try {
        await mkdir(this.directory(), { recursive: true });
        const target = join(this.directory(), `${area}.json`), temp = target + ".tmp";
        await writeFile(temp, JSON.stringify(result), { mode: 0o600 }); await rename(temp, target);
      } catch { console.warn("Caché GIS disponible solo en memoria"); }
      return { ...result, cache_status: "updated" };
    } catch {
      this.retryAfter.set(area, Date.now() + 60000);
      if (saved && Date.now() - Date.parse(saved.fetched_at) < MAX_STALE) return { ...saved, cache_status: "stale", warning: "La fuente GIS no responde; se conserva la última consulta disponible." };
      throw new ServiceUnavailableException("No se pudieron obtener los senderos de OpenStreetMap. Inténtalo de nuevo en un minuto.");
    }
  }
}
@Controller("api/gis")
export class WebGisController {
  constructor(readonly gis: WebGisService) {}
  @Get("routes") routes(@Query() query: unknown) { return this.gis.routes(query); }
}
