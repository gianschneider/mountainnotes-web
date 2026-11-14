import { Injectable, effect, inject, signal, untracked } from '@angular/core';
import { Haptics } from '@capacitor/haptics';
import { LocationService } from './location.service';
import { NotesService } from './notes.service';
import { MAX_ACCURACY_M, PROXIMITY_M, PROXIMITY_RESET_M, SyncedNote, UNLOCK_FIXES } from './note';
import { distanceM } from './geo';
import { Ui } from './ui';

export type UnlockState =
  | { kind: 'readable' }
  | { kind: 'future'; from: Date }
  | { kind: 'nofix' }
  | { kind: 'far'; distance: number }
  | { kind: 'inaccurate'; distance: number; accuracy: number }
  | { kind: 'steady'; distance: number; fixes: number }   // inside the radius, waiting for more fixes
  | { kind: 'unlockable'; distance: number };

/**
 * Application logic: decides locally (also offline) whether a note can be opened.
 * Order as in the concept: person (server only delivers my notes) → time → distance → accuracy,
 * and the distance must hold for UNLOCK_FIXES consecutive fixes so a single GNSS jump does not unlock.
 */
@Injectable({ providedIn: 'root' })
export class UnlockService {
  private location = inject(LocationService);
  private notesService = inject(NotesService);
  private ui = inject(Ui);

  readonly states = signal<Map<string, UnlockState>>(new Map());

  private streaks = new Map<string, number>();
  private lastFix?: number;
  private notified = new Set<string>();

  constructor() {
    effect(() => {
      const pos = this.location.position();
      const notes = this.notesService.notes();
      this.notesService.opened();                      // re-evaluate after opening
      untracked(() => this.update(notes, pos));
    });
  }

  /** Demo reset: count fixes again and allow the proximity alert again. */
  forgetProgress() {
    this.streaks.clear();
    this.notified.clear();
  }

  private update(notes: SyncedNote[], pos: ReturnType<LocationService['position']>) {
    const newFix = !!pos && pos.timestamp !== this.lastFix;
    if (pos) this.lastFix = pos.timestamp;
    const now = Date.now();
    const states = new Map<string, UnlockState>();

    for (const note of notes) {
      if (this.notesService.isReadable(note)) {
        states.set(note.id, { kind: 'readable' });
        continue;
      }
      const from = new Date(note.validFrom);
      if (from.getTime() > now) {
        states.set(note.id, { kind: 'future', from });
        continue;
      }
      if (!pos) {
        states.set(note.id, { kind: 'nofix' });
        continue;
      }
      const distance = distanceM({ lat: pos.coords.latitude, lon: pos.coords.longitude }, note);
      const accuracy = pos.coords.accuracy;
      const inRange = distance <= note.unlockRadius;
      const accurate = accuracy <= MAX_ACCURACY_M;

      if (newFix) {
        this.streaks.set(note.id, inRange && accurate ? (this.streaks.get(note.id) ?? 0) + 1 : 0);
        this.checkProximity(note, distance);
      }
      const fixes = this.streaks.get(note.id) ?? 0;
      if (!inRange) states.set(note.id, { kind: 'far', distance });
      else if (!accurate) states.set(note.id, { kind: 'inaccurate', distance, accuracy });
      else if (fixes < UNLOCK_FIXES) states.set(note.id, { kind: 'steady', distance, fixes });
      else states.set(note.id, { kind: 'unlockable', distance });
    }
    this.states.set(states);
  }

  /** Vibrate once when approaching a note; again only after having moved away (hysteresis). */
  private checkProximity(note: SyncedNote, distance: number) {
    // Large radii (up to 200 m): alert at least 100 m before reaching the unlock circle.
    const alertAt = Math.max(PROXIMITY_M, note.unlockRadius + 100);
    if (distance > alertAt + (PROXIMITY_RESET_M - PROXIMITY_M)) {
      this.notified.delete(note.id);
    } else if (distance <= alertAt && !this.notified.has(note.id)) {
      this.notified.add(note.id);
      Haptics.vibrate().catch(() => {});
      // Longer than other hints: it comes while walking and is the cue to look at the map.
      this.ui.toast(`MountainNote from ${note.author} nearby (${Math.round(distance)} m)`, 'medium', 6000);
    }
  }
}
