import { Injectable, signal } from '@angular/core';
import { Directory, Filesystem } from '@capacitor/filesystem';
import { Preferences } from '@capacitor/preferences';
import { addProtocol } from 'maplibre-gl';
import type { StyleSpecification } from 'maplibre-gl';
import { BBox } from './notes.service';

// swisstopo light base map (vector tiles, free geodata with attribution)
const STYLE_URL = 'https://vectortiles.geo.admin.ch/styles/ch.swisstopo.lightbasemap.vt/style.json';
const PROTOCOL = 'mnmap';
const MAX_ZOOM = 14;                       // the swisstopo tiles end at 14, the map zooms further on its own
const GLYPH_RANGES = ['0-255', '256-511', '8192-8447'];   // Latin, accents, punctuation (enough for Swiss names)
const STYLE_FILE = 'map/style.json';
const REGIONS_KEY = 'mapRegions';
export const MAX_REGION_DEG = 0.5;         // ~55 × 37 km, about 100 MB at most
const PARALLEL = 6;

/** Extra data we keep in the cached style: where our mnmap:// URLs come from. */
interface Remote {
  tiles: Record<string, string>;           // source id -> https template with {z}/{x}/{y}
  glyphs: string;                          // https template with {fontstack}/{range}
  sprite: string;                          // https base URL without extension
  fonts: string[];
}

export interface MapRegion {
  id: string;
  name: string;
  bbox: BBox;
  createdAt: string;
  tiles: number;
  bytes: number;
}

export interface DownloadProgress {
  done: number;
  total: number;
}

/**
 * Base map for offline use. The style is rewritten to the mnmap:// protocol; every request first looks
 * on the phone (downloaded regions), then on the network. Files are stored gzip-compressed.
 */
@Injectable({ providedIn: 'root' })
export class OfflineMapService {
  readonly regions = signal<MapRegion[]>([]);
  private remote?: Remote;
  private registered = false;

  constructor() {
    Preferences.get({ key: REGIONS_KEY }).then(({ value }) => value && this.regions.set(JSON.parse(value)));
  }

  /** Style for MapLibre: from the network (and cached), offline the cached copy. */
  async style(): Promise<StyleSpecification | string> {
    this.register();
    let style: (StyleSpecification & { metadata?: { remote?: Remote } }) | null = null;
    try {
      style = await this.fetchStyle();
      await writeText(STYLE_FILE, JSON.stringify(style));
    } catch {
      const cached = await readText(STYLE_FILE);
      if (cached) style = JSON.parse(cached);
    }
    if (!style) return STYLE_URL;          // never online so far: let MapLibre try the network itself
    this.remote = style.metadata!.remote!;
    return style;
  }

  /** Number of files and a rough size, shown before downloading. */
  estimate(box: BBox): { tiles: number; megabytes: number } {
    const tiles = tileList(box).length * Object.keys(this.remote?.tiles ?? { a: 1, b: 1 }).length;
    return { tiles, megabytes: Math.max(1, Math.round((tiles * 35_000) / 1e6)) };   // ~35 kB per compressed tile
  }

  /** Download all tiles of the box (zoom 0–14), plus fonts and symbols. Already stored files are skipped. */
  async download(name: string, box: BBox, onProgress: (p: DownloadProgress) => void, signal: AbortSignal) {
    if (!this.remote) throw new Error('The map is not loaded yet. Please open it online first.');
    const keys = [...regionKeys(box, this.remote), ...extraKeys(this.remote)];
    let done = 0;
    let bytes = 0;
    let failed = 0;
    const queue = [...keys];
    const worker = async () => {
      while (queue.length && !signal.aborted) {
        const key = queue.shift()!;
        // One retry, then skip: a single missing tile must not stop the whole region.
        bytes += await this.ensure(key).catch(() => this.ensure(key)).catch(() => (failed++, 0));
        onProgress({ done: ++done, total: keys.length });
      }
    };
    await Promise.all(Array.from({ length: PARALLEL }, worker));
    const region: MapRegion = {
      id: crypto.randomUUID(), name, bbox: box, createdAt: new Date().toISOString(), tiles: keys.length, bytes,
    };
    // Cancelled: remove what was loaded for it (unless another region needs it), so nothing is left behind.
    if (signal.aborted) return this.remove(region);
    if (failed > keys.length / 10) {
      await this.remove(region);
      throw new Error('The map could not be loaded completely. Check the connection and try again.');
    }
    await this.saveRegions([...this.regions(), region]);
  }

  /** Delete a region; files that another region still needs stay. */
  async remove(region: MapRegion) {
    const rest = this.regions().filter((r) => r.id !== region.id);
    const keep = new Set(rest.flatMap((r) => (this.remote ? regionKeys(r.bbox, this.remote) : [])));
    const shared = rest.length ? [] : extraKeys(this.remote);
    for (const key of [...(this.remote ? regionKeys(region.bbox, this.remote) : []), ...shared]) {
      if (!keep.has(key)) await Filesystem.deleteFile({ path: filePath(key), directory: Directory.Data }).catch(() => {});
    }
    await this.saveRegions(rest);
  }

  /** Download one file unless it is stored already; returns the stored size. */
  private async ensure(key: string): Promise<number> {
    const existing = await Filesystem.stat({ path: filePath(key), directory: Directory.Data }).catch(() => null);
    if (existing) return existing.size;
    const res = await fetch(this.remoteUrl(key));
    if (!res.ok) return 0;                  // e.g. outside the data area: nothing to store
    const gz = await gzip(await res.arrayBuffer());
    await writeFile(filePath(key), toBase64(gz));
    return gz.byteLength;
  }

  private register() {
    if (this.registered) return;
    this.registered = true;
    addProtocol(PROTOCOL, async (params) => {
      // MapLibre sends font names sometimes URL-encoded, sometimes not: keys use the decoded form.
      const key = decodeURIComponent(params.url.slice(PROTOCOL.length + 3).split('?')[0]);
      const stored = await Filesystem.readFile({ path: filePath(key), directory: Directory.Data }).catch(() => null);
      if (stored) {
        const data = await gunzip(fromBase64(stored.data as string));
        return { data: key.endsWith('.json') ? JSON.parse(new TextDecoder().decode(data)) : data };
      }
      const res = await fetch(this.remoteUrl(key));
      if (!res.ok) throw new Error(`${res.status} ${key}`);
      return { data: key.endsWith('.json') ? await res.json() : await res.arrayBuffer() };
    });
  }

  private remoteUrl(key: string): string {
    const r = this.remote!;
    const [kind, ...rest] = key.split('/');
    if (kind === 'tile') {
      const [source, z, x, y] = rest;
      return r.tiles[source].replace('{z}', z).replace('{x}', x).replace('{y}', y);
    }
    if (kind === 'glyph') {
      return r.glyphs.replace('{fontstack}', encodeURIComponent(rest[0])).replace('{range}', rest[1].replace('.pbf', ''));
    }
    return r.sprite + rest.join('/').replace(/^sprite/, '');   // sprite/sprite@2x.png -> <base>@2x.png
  }

  /** The swisstopo style with all URLs pointing to mnmap://, and the original URLs kept in metadata. */
  private async fetchStyle() {
    const style = await fetchJson(STYLE_URL, 5000);
    const tiles: Record<string, string> = {};
    for (const [id, source] of Object.entries<any>(style.sources)) {
      if (source.type !== 'vector') continue;
      const tilejson = source.url ? await fetchJson(source.url, 5000) : source;
      tiles[id] = tilejson.tiles[0];
      style.sources[id] = {
        type: 'vector', tiles: [`${PROTOCOL}://tile/${id}/{z}/{x}/{y}`], minzoom: 0, maxzoom: MAX_ZOOM,
      };
    }
    const fonts = new Set<string>();
    for (const layer of style.layers) {
      const font = layer.layout?.['text-font'];
      if (Array.isArray(font) && font.every((f: unknown) => typeof f === 'string')) fonts.add(font.join(','));
    }
    const remote: Remote = { tiles, glyphs: style.glyphs, sprite: style.sprite, fonts: [...fonts] };
    style.glyphs = `${PROTOCOL}://glyph/{fontstack}/{range}.pbf`;
    style.sprite = `${PROTOCOL}://sprite/sprite`;
    style.metadata = { ...style.metadata, remote };
    return style;
  }

  private async saveRegions(regions: MapRegion[]) {
    this.regions.set(regions);
    await Preferences.set({ key: REGIONS_KEY, value: JSON.stringify(regions) });
  }
}

/** Slippy-map tiles covering the box for zoom 0–14. */
export function tileList(box: BBox): [number, number, number][] {
  const list: [number, number, number][] = [];
  for (let z = 0; z <= MAX_ZOOM; z++) {
    const [x0, y0] = lonLatToTile(box.minLon, box.maxLat, z);
    const [x1, y1] = lonLatToTile(box.maxLon, box.minLat, z);
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) list.push([z, x, y]);
  }
  return list;
}

function lonLatToTile(lon: number, lat: number, z: number): [number, number] {
  const n = 2 ** z;
  const x = Math.floor(((lon + 180) / 360) * n);
  const rad = (lat * Math.PI) / 180;
  const y = Math.floor(((1 - Math.asinh(Math.tan(rad)) / Math.PI) / 2) * n);
  return [Math.min(n - 1, Math.max(0, x)), Math.min(n - 1, Math.max(0, y))];
}

function regionKeys(box: BBox, remote: Remote): string[] {
  const tiles = tileList(box);
  return Object.keys(remote.tiles).flatMap((source) => tiles.map(([z, x, y]) => `tile/${source}/${z}/${x}/${y}`));
}

/** Fonts and symbols, needed once for all regions. */
function extraKeys(remote?: Remote): string[] {
  if (!remote) return [];
  const glyphs = remote.fonts.flatMap((f) => GLYPH_RANGES.map((r) => `glyph/${f}/${r}.pbf`));
  const sprites = ['sprite.json', 'sprite.png', 'sprite@2x.json', 'sprite@2x.png'].map((s) => `sprite/${s}`);
  return [...glyphs, ...sprites];
}

const filePath = (key: string) => `map/${key}.gz`;

async function fetchJson(url: string, timeoutMs: number) {
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json();
}

async function readText(path: string): Promise<string | null> {
  const file = await Filesystem.readFile({ path, directory: Directory.Data }).catch(() => null);
  return file ? new TextDecoder().decode(fromBase64(file.data as string)) : null;
}

async function writeText(path: string, text: string) {
  await writeFile(path, toBase64(new TextEncoder().encode(text).buffer as ArrayBuffer));
}

// Parallel downloads would create the same folders at once ("directory already exists"): create each once.
const folders = new Map<string, Promise<void>>();

/** Creates the folder and its parents one level after the other (the web implementation is not race-safe). */
function ensureFolder(path: string): Promise<void> {
  let task = folders.get(path);
  if (!task) {
    const parent = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : null;
    task = (parent ? ensureFolder(parent) : Promise.resolve())
      .then(() => Filesystem.mkdir({ path, directory: Directory.Data }))
      .catch(() => {});                     // exists already: fine
    folders.set(path, task);
  }
  return task;
}

async function writeFile(path: string, data: string) {
  await ensureFolder(path.slice(0, path.lastIndexOf('/')));
  await Filesystem.writeFile({ path, data, directory: Directory.Data });
}

async function gzip(data: ArrayBuffer): Promise<ArrayBuffer> {
  return new Response(new Blob([data]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer();
}

async function gunzip(data: ArrayBuffer): Promise<ArrayBuffer> {
  return new Response(new Blob([data]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
}

function toBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

function fromBase64(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}
