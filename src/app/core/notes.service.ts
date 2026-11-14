import { Injectable, effect, inject, signal, untracked } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { Preferences } from '@capacitor/preferences';
import { Network } from '@capacitor/network';
import { App } from '@capacitor/app';
import { ApiService } from './api.service';
import { AuthService } from './auth.service';
import { SyncedNote } from './note';
import type { NoteFormResult } from '../notes/note-form.component';
import { LatLon } from './geo';
import { SettlementService } from './settlement.service';
import { OutboxService } from './outbox.service';
import { PhotoService } from './photo.service';
import { decryptText, encryptText, isEncrypted } from './crypto';

export interface BBox {
  minLat: number;
  minLon: number;
  maxLat: number;
  maxLon: number;
}

interface Store {
  notes: SyncedNote[];
  opened: Record<string, string>;   // note id -> openedAt (local, also before it is reported)
  pendingOpens: string[];           // openings not yet reported to the server
  lastSync: string | null;
}

const CELL_DEG = 0.01;                    // auto sync rounds the position to ~1 km (privacy)
const AROUND_LAT = 0.18;                  // ±20 km
const AROUND_LON = 0.27;
const AUTO_SYNC_INTERVAL_MS = 5 * 60_000;
export const MAX_BBOX_DEG = 1;            // same limit as the server

/**
 * Notes meant for me, cached on the phone with content so they can be opened offline.
 * Openings are stored locally first and reported to the server when online.
 */
@Injectable({ providedIn: 'root' })
export class NotesService {
  private api = inject(ApiService);
  private auth = inject(AuthService);
  private settlements = inject(SettlementService);
  private outbox = inject(OutboxService);
  private photos = inject(PhotoService);

  readonly notes = signal<SyncedNote[]>([]);
  readonly opened = signal<Record<string, string>>({});
  readonly lastSync = signal<string | null>(null);
  /** Areas loaded in this session; the map offers to load an area outside them. */
  readonly loadedBoxes = signal<BBox[]>([]);
  private pendingOpens: string[] = [];
  private lastAuto?: { cell: string; at: number; box: BBox };

  constructor() {
    effect(() => {
      const userId = this.auth.userId();
      this.reset();
      if (userId) untracked(() => this.load(userId));
    });
    const retry = () => {
      this.flushOpens();
      if (this.lastAuto) this.syncBox(this.lastAuto.box).catch(() => {});
    };
    Network.addListener('networkStatusChange', (status) => status.connected && retry());
    App.addListener('resume', retry);
  }

  isReadable(note: SyncedNote): boolean {
    return note.isMine || note.openedByMe || note.id in this.opened();
  }

  /** Load all notes in the box (and the settlement mask for it); cached notes outside the box are kept. */
  async syncBox(box: BBox): Promise<number> {
    this.settlements.syncBox(box).catch(() => {});   // independent: a failed mask download must not block notes
    const q = new URLSearchParams(Object.entries(box).map(([k, v]) => [k, v.toFixed(5)]));
    const { notes } = await this.api.get<{ notes: SyncedNote[] }>(`/notes/sync?${q}`);
    const outside = this.notes().filter((n) => !inBox(n, box));
    this.notes.set(dropExpired([...outside, ...notes]));
    const ids = new Set(notes.map((n) => n.id));
    this.outbox.pruneSynced((n) => inBox(n, box) && !ids.has(n.id));
    this.lastSync.set(new Date().toISOString());
    this.loadedBoxes.update((boxes) => [...boxes, box]);
    await this.persist();
    this.flushOpens();
    this.syncPhotos();
    return notes.length;
  }

  /** Photos travel with the notes, so a note with a photo can be opened offline too. */
  private async syncPhotos() {
    const notes = this.notes();
    await this.photos.prune(new Set([...notes.map((n) => n.id), ...this.outbox.entries().map((e) => e.note.id)]));
    await this.photos.prefetch(notes.filter((n) => n.hasPhoto).map((n) => n.id));
  }

  /** Automatic sync around the rounded position, at most every few minutes or when entering a new cell. */
  async syncAround(pos: LatLon) {
    const lat = Math.round(pos.lat / CELL_DEG) * CELL_DEG;
    const lon = Math.round(pos.lon / CELL_DEG) * CELL_DEG;
    const cell = `${lat.toFixed(2)},${lon.toFixed(2)}`;
    if (this.lastAuto && this.lastAuto.cell === cell && Date.now() - this.lastAuto.at < AUTO_SYNC_INTERVAL_MS) return;
    const box = { minLat: lat - AROUND_LAT, maxLat: lat + AROUND_LAT, minLon: lon - AROUND_LON, maxLon: lon + AROUND_LON };
    this.lastAuto = { cell, at: Date.now(), box };
    await this.syncBox(box).catch(() => {});   // offline: keep the cached notes
  }

  /** Edit my note (online only): text, audience, validity, radius, and the photo. */
  async updateNote(id: string, result: NoteFormResult) {
    const n = result.note;
    await this.api.patch(`/notes/${id}`, {
      body: n.body, audience: n.audience, audienceUsername: n.audienceUsername, audienceGroupId: n.audienceGroupId,
      validFrom: n.validFrom, validUntil: n.validUntil, unlockRadius: n.unlockRadius,
    });
    let photo: Partial<SyncedNote> = {};
    if (result.photo) {
      await this.photos.replace(id, result.photo);
      photo = { hasPhoto: true, photoPreview: result.photo.preview };
    } else if (result.removePhoto) {
      await this.photos.remove(id);
      photo = { hasPhoto: false, photoPreview: null };
    }
    this.notes.update((list) => list.map((note) => note.id !== id ? note : {
      ...note, ...photo, body: n.body, audience: n.audience, audienceGroupId: n.audienceGroupId ?? null,
      audienceLabel: n.audience === 'public' ? null : result.audienceLabel,
      validFrom: n.validFrom, validUntil: n.validUntil, unlockRadius: n.unlockRadius,
    }));
    await this.persist();
  }

  /** Delete my own note, or any note as app admin. */
  async deleteNote(id: string) {
    await this.api.delete(`/notes/${id}`);
    this.notes.update((list) => list.filter((n) => n.id !== id));
    await this.outbox.discard(id);
    await this.persist();
  }

  /** Called after the unlock conditions were met on the phone. */
  async markOpened(id: string) {
    if (id in this.opened()) return;
    this.opened.update((o) => ({ ...o, [id]: new Date().toISOString() }));
    this.pendingOpens.push(id);
    await this.persist();
    this.flushOpens();
  }

  /** Demo reset (test accounts only): forget my openings here and on the server, then reload the notes. */
  async forgetOpens() {
    await this.api.delete('/notes/opened');
    this.opened.set({});
    this.pendingOpens = [];
    await this.persist();
    const boxes = this.loadedBoxes();
    this.loadedBoxes.set([]);
    for (const box of boxes) await this.syncBox(box);
  }

  private async flushOpens() {
    for (const id of [...this.pendingOpens]) {
      try {
        await this.api.post(`/notes/${id}/opened`, { openedAt: this.opened()[id] });
      } catch (err) {
        // Offline or server error: try again later. 404: note is gone or no longer for me, nothing to report.
        if (!(err instanceof HttpErrorResponse) || err.status !== 404) return;
      }
      this.pendingOpens = this.pendingOpens.filter((p) => p !== id);
      await this.persist();
    }
  }

  private reset() {
    this.notes.set([]);
    this.opened.set({});
    this.lastSync.set(null);
    this.loadedBoxes.set([]);
    this.pendingOpens = [];
    this.lastAuto = undefined;
  }

  private key(userId: string) {
    return `notes:${userId}`;
  }

  private async load(userId: string) {
    const { value } = await Preferences.get({ key: this.key(userId) });
    if (!value || this.auth.user()?.id !== userId) return;
    const store = JSON.parse(await decryptText(value)) as Store;   // contents of locked notes: encrypted at rest
    this.notes.set(dropExpired(store.notes));
    this.opened.set(store.opened);
    this.pendingOpens = store.pendingOpens;
    this.lastSync.set(store.lastSync);
    this.flushOpens();
    if (!isEncrypted(value)) this.persist();   // stored before encryption existed: re-save encrypted
  }

  private async persist() {
    const user = this.auth.user();
    if (!user) return;
    const store: Store = { notes: this.notes(), opened: this.opened(), pendingOpens: this.pendingOpens, lastSync: this.lastSync() };
    await Preferences.set({ key: this.key(user.id), value: await encryptText(JSON.stringify(store)) });
  }
}

/** True if the box lies completely inside one of the loaded boxes. */
export function isCovered(box: BBox, loaded: BBox[]): boolean {
  return loaded.some((l) => box.minLat >= l.minLat && box.maxLat <= l.maxLat && box.minLon >= l.minLon && box.maxLon <= l.maxLon);
}

function inBox(p: LatLon, box: BBox): boolean {
  return p.lat >= box.minLat && p.lat <= box.maxLat && p.lon >= box.minLon && p.lon <= box.maxLon;
}

/** Notes past their end date are deleted on the phone too. */
function dropExpired(notes: SyncedNote[]): SyncedNote[] {
  const now = Date.now();
  return notes.filter((n) => new Date(n.validUntil).getTime() > now);
}
