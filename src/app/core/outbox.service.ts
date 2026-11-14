import { Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { Preferences } from '@capacitor/preferences';
import { Network } from '@capacitor/network';
import { App } from '@capacitor/app';
import { ApiService, errorMessage } from './api.service';
import { AuthService } from './auth.service';
import { NewNote } from './note';
import { NotePhoto } from './photo';
import { PhotoService } from './photo.service';
import { decryptText, encryptText, isEncrypted } from './crypto';

export interface OutboxEntry {
  note: NewNote;
  status: 'pending' | 'synced' | 'failed';
  error?: string;
  audienceLabel: string;   // for display, e.g. group name or username
  photoPreview?: string;   // the photo itself waits in the PhotoService until uploaded
  photoPending?: boolean;
}

/**
 * Local queue of notes I placed. Notes are stored first and uploaded when the server is reachable;
 * thanks to the phone-generated id a retry after a dropped connection creates no duplicate.
 * Synced entries are kept so my own notes stay visible on the map (until note sync exists).
 */
@Injectable({ providedIn: 'root' })
export class OutboxService {
  private api = inject(ApiService);
  private auth = inject(AuthService);
  private photos = inject(PhotoService);
  private syncing = false;

  readonly entries = signal<OutboxEntry[]>([]);
  readonly pendingCount = computed(() => this.entries().filter((e) => e.status === 'pending').length);

  constructor() {
    effect(() => {
      const userId = this.auth.userId();
      this.entries.set([]);
      if (userId) untracked(() => this.load(userId)).then(() => this.sync());
    });
    Network.addListener('networkStatusChange', (status) => {
      if (status.connected) this.sync();
    });
    App.addListener('resume', () => this.sync());   // e.g. server was down while the network stayed up
  }

  async add(note: NewNote, audienceLabel: string, photo?: NotePhoto) {
    if (photo) await this.photos.savePending(note.id, photo);
    const entry: OutboxEntry = { note, status: 'pending', audienceLabel };
    if (photo) Object.assign(entry, { photoPreview: photo.preview, photoPending: true });
    this.entries.update((list) => [...list, entry]);
    await this.persist();
    this.sync();
  }

  async discard(id: string) {
    this.entries.update((list) => list.filter((e) => e.note.id !== id));
    await this.photos.discardPending(id);
    await this.persist();
  }

  /** Drop uploaded entries the server no longer delivers (deleted by an admin or expired). */
  async pruneSynced(isGone: (note: NewNote) => boolean) {
    const before = this.entries().length;
    this.entries.update((list) => list.filter((e) => e.status !== 'synced' || !isGone(e.note)));
    if (this.entries().length !== before) await this.persist();
  }

  /**
   * Upload all pending notes, then their photos (a photo needs the note on the server first).
   * Stops at the first network problem and retries on the next trigger.
   */
  async sync() {
    if (this.syncing || !this.auth.isLoggedIn()) return;
    this.syncing = true;
    try {
      for (const entry of this.entries().filter((e) => e.status === 'pending' || e.photoPending)) {
        const id = entry.note.id;
        try {
          if (entry.status === 'pending') {
            await this.api.post('/notes', entry.note);
            this.patch(id, { status: 'synced', error: undefined });
          }
          if (entry.photoPending) {
            await this.photos.upload(id, entry.photoPreview!);
            this.patch(id, { photoPending: false });
          }
        } catch (err) {
          // Offline, server down or token expired: keep pending. A 4xx means the server rejected it.
          if (!(err instanceof HttpErrorResponse) || err.status === 0 || err.status === 401 || err.status >= 500) break;
          const noteRejected = this.entries().find((e) => e.note.id === id)?.status === 'pending';
          if (noteRejected) this.patch(id, { status: 'failed', error: errorMessage(err) });
          else this.patch(id, { photoPending: false, error: `Photo: ${errorMessage(err)}` });
        }
        await this.persist();
      }
    } finally {
      this.syncing = false;
    }
  }

  private patch(id: string, changes: Partial<OutboxEntry>) {
    this.entries.update((list) => list.map((e) => (e.note.id === id ? { ...e, ...changes } : e)));
  }

  private key(userId: string) {
    return `outbox:${userId}`;
  }

  private async load(userId: string) {
    const { value } = await Preferences.get({ key: this.key(userId) });
    if (!value || this.auth.user()?.id !== userId) return;
    this.entries.set(JSON.parse(await decryptText(value)));
    if (!isEncrypted(value)) await this.persist();   // stored before encryption existed
  }

  private async persist() {
    const user = this.auth.user();
    if (user) await Preferences.set({ key: this.key(user.id), value: await encryptText(JSON.stringify(this.entries())) });
  }
}
