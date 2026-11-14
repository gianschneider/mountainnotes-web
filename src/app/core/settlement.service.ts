import { Injectable, inject, signal } from '@angular/core';
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';
import { booleanPointInPolygon } from '@turf/boolean-point-in-polygon';
import type { Feature, FeatureCollection, MultiPolygon, Polygon, Position } from 'geojson';
import { ApiService } from './api.service';
import { LatLon } from './geo';
import type { BBox } from './notes.service';

export const SETTLEMENT_ATTRIBUTION = 'Building zones: Kantonale Raumplanungsfachstellen, INFOPLAN-ARE';

type Zone = Feature<Polygon | MultiPolygon>;

interface MaskArea {
  box: BBox;
  features: Zone[];
  loadedAt: string;
}

export type SettlementCheck = 'inside' | 'outside' | 'unknown';

const FILE = 'settlement-mask.json';
const MAX_AREAS = 6;   // a few tour regions; one area is ~0.5 MB

/**
 * Settlement mask (building zones) for the regions I synced, stored as a file so the
 * "no notes in settlements" rule can be checked offline. The server checks again on upload.
 */
@Injectable({ providedIn: 'root' })
export class SettlementService {
  private api = inject(ApiService);

  readonly areas = signal<MaskArea[]>([]);
  private index: { box: BBox; zones: { bbox: [number, number, number, number]; zone: Zone }[] }[] = [];
  private loaded = this.load();

  async syncBox(box: BBox) {
    const q = new URLSearchParams(Object.entries(box).map(([k, v]) => [k, v.toFixed(5)]));
    const fc = await this.api.get<FeatureCollection<Polygon | MultiPolygon>>(`/settlements?${q}`);
    await this.loaded;
    const area: MaskArea = { box, features: fc.features, loadedAt: new Date().toISOString() };
    // Newest first; areas completely covered by the new one are obsolete.
    this.setAreas([area, ...this.areas().filter((a) => !contains(box, a.box))].slice(0, MAX_AREAS));
    await Filesystem.writeFile({ path: FILE, directory: Directory.Data, encoding: Encoding.UTF8, data: JSON.stringify(this.areas()) });
  }

  /** 'unknown' when no mask was loaded for this place (e.g. offline in a new region). */
  check(p: LatLon): SettlementCheck {
    const areas = this.index.filter((a) => inBox(p, a.box));
    if (!areas.length) return 'unknown';
    const pt: Position = [p.lon, p.lat];
    const inside = areas.some((a) => a.zones.some(({ bbox, zone }) =>
      p.lon >= bbox[0] && p.lon <= bbox[2] && p.lat >= bbox[1] && p.lat <= bbox[3] && booleanPointInPolygon(pt, zone)));
    return inside ? 'inside' : 'outside';
  }

  /** Zones of all stored areas that touch the box, for showing them on the map. */
  zonesIn(box: BBox): Zone[] {
    return this.index.flatMap((a) => a.zones
      .filter(({ bbox }) => bbox[0] <= box.maxLon && bbox[2] >= box.minLon && bbox[1] <= box.maxLat && bbox[3] >= box.minLat)
      .map(({ zone }) => zone));
  }

  private async load() {
    try {
      const { data } = await Filesystem.readFile({ path: FILE, directory: Directory.Data, encoding: Encoding.UTF8 });
      this.setAreas(JSON.parse(data as string));
    } catch {
      // no mask stored yet
    }
  }

  private setAreas(areas: MaskArea[]) {
    this.areas.set(areas);
    this.index = areas.map((a) => ({ box: a.box, zones: a.features.map((zone) => ({ bbox: bboxOf(zone), zone })) }));
  }
}

function inBox(p: LatLon, b: BBox): boolean {
  return p.lat >= b.minLat && p.lat <= b.maxLat && p.lon >= b.minLon && p.lon <= b.maxLon;
}

function contains(outer: BBox, inner: BBox): boolean {
  return inner.minLat >= outer.minLat && inner.maxLat <= outer.maxLat && inner.minLon >= outer.minLon && inner.maxLon <= outer.maxLon;
}

function bboxOf(zone: Zone): [number, number, number, number] {
  const rings = zone.geometry.type === 'Polygon' ? zone.geometry.coordinates : zone.geometry.coordinates.flat();
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const ring of rings) {
    for (const [x, y] of ring) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  return [minX, minY, maxX, maxY];
}
