import { point } from '@turf/helpers';
import { distance } from '@turf/distance';
import { bearing } from '@turf/bearing';
import { destination } from '@turf/destination';

export interface LatLon {
  lat: number;
  lon: number;
}

const toPoint = (p: LatLon) => point([p.lon, p.lat]);

/** Distance in metres (Turf, great circle). */
export function distanceM(a: LatLon, b: LatLon): number {
  return distance(toPoint(a), toPoint(b), { units: 'meters' });
}

/** Returns p, or the point on the circle around center with radius maxM in the direction of p. */
export function clampToRadius(center: LatLon, p: LatLon, maxM: number): LatLon {
  if (distanceM(center, p) <= maxM) return p;
  const dest = destination(toPoint(center), maxM, bearing(toPoint(center), toPoint(p)), { units: 'meters' });
  const [lon, lat] = dest.geometry.coordinates;
  return { lat, lon };
}

/** Direction from a to b in degrees clockwise from north (0–360). */
export function bearingDeg(a: LatLon, b: LatLon): number {
  return (bearing(toPoint(a), toPoint(b)) + 360) % 360;
}

const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

/** German compass point for a bearing, e.g. 40° → "NO". */
export function compassPoint(deg: number): string {
  return COMPASS[Math.round(deg / 45) % 8];
}

/** "34 m" (exact near the note, where the unlock radius matters), "120 m" or "1.4 km". */
export function formatDistance(m: number): string {
  if (m < 100) return `${Math.round(m)} m`;
  return m < 1000 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(m < 10_000 ? 1 : 0)} km`;
}
