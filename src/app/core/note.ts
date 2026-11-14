/** Rules shared by placing and (later) opening notes. */
export const MAX_ADJUST_M = 20;
export const DEFAULT_UNLOCK_RADIUS_M = 30;
export const UNLOCK_RADIUS_OPTIONS = [20, 30, 50, 100, 200];   // the server allows 20–200 m
export const MAX_ACCURACY_M = 30;           // GNSS fix must be at least this good to place or open a note
export const DEFAULT_VALIDITY_YEARS = 2;
export const UNLOCK_FIXES = 3;              // consecutive fixes inside the radius (against GNSS jumps)
export const PROXIMITY_M = 200;             // vibrate when getting this close
export const PROXIMITY_RESET_M = 250;       // hysteresis: notify again only after moving this far away

export type Audience = 'user' | 'group' | 'public';

/** A note meant for me, as delivered by GET /notes/sync (incl. content, so it can be unlocked offline). */
export interface SyncedNote {
  id: string;
  lat: number;
  lon: number;
  unlockRadius: number;
  validFrom: string;
  validUntil: string;
  audience: Audience;
  audienceLabel: string | null;   // group name or username, null for public
  author: string;
  isMine: boolean;
  body: string;
  createdAt: string;
  openedByMe: boolean;
  openCount: number | null;       // only for my own notes
  hasPhoto: boolean;
  photoPreview: string | null;    // tiny JPEG data URL, shown blurred before opening
  audienceGroupId?: string | null; // only for my own notes (to edit them)
}

/** A note as sent to POST /notes. The id is generated on the phone so uploads are idempotent. */
export interface NewNote {
  id: string;
  lat: number;                // adjusted position
  lon: number;
  gnssLat: number;            // original GNSS fix
  gnssLon: number;
  gnssAccuracy: number;
  unlockRadius: number;
  validFrom: string;          // ISO timestamps
  validUntil: string;
  audience: Audience;
  audienceGroupId?: string;
  audienceUsername?: string;  // resolved by the server, so it works offline
  body: string;
  createdAt: string;
}

/**
 * UUID v4 from crypto.getRandomValues (crypto.randomUUID needs a secure context,
 * which is not guaranteed under capacitor://).
 */
export function uuidv4(): string {
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
