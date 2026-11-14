import { Injectable, inject } from '@angular/core';
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';
import { decryptBase64, encryptBase64 } from './crypto';
import { ApiService } from './api.service';
import { AuthService } from './auth.service';
import { NotePhoto, jpegDataUrl } from './photo';

/**
 * Note photos on the phone, per user: a cache of downloaded photos (so notes open offline)
 * and the photos of my own notes that still wait for upload.
 */
@Injectable({ providedIn: 'root' })
export class PhotoService {
  private api = inject(ApiService);
  private auth = inject(AuthService);
  private loading = new Map<string, Promise<string | null>>();

  /** Photo as data URL: from the phone, otherwise downloaded and cached. Null when offline and not cached. */
  get(noteId: string): Promise<string | null> {
    const running = this.loading.get(noteId);
    if (running) return running;
    const task = this.read(this.cachePath(noteId))
      .then((cached) => cached ?? this.download(noteId))
      .finally(() => this.loading.delete(noteId));
    this.loading.set(noteId, task);
    return task;
  }

  /** Download photos of notes I may open, one after the other, so they are there without network. */
  async prefetch(noteIds: string[]) {
    for (const id of noteIds) {
      if (await this.read(this.cachePath(id))) continue;
      if ((await this.get(id)) === null) return;   // offline: stop, try again with the next sync
    }
  }

  /** Remove cached photos of notes that are no longer on the phone. */
  async prune(keepIds: Set<string>) {
    const dir = this.dir('cache');
    const files = await Filesystem.readdir({ path: dir, directory: Directory.Data }).catch(() => null);
    for (const f of files?.files ?? []) {
      if (!keepIds.has(f.name.replace(/\.jpg$/, ''))) {
        await Filesystem.deleteFile({ path: `${dir}/${f.name}`, directory: Directory.Data }).catch(() => {});
      }
    }
  }

  /** Keep the photo of a new note until it is uploaded. */
  savePending(noteId: string, photo: NotePhoto): Promise<void> {
    return this.write(this.pendingPath(noteId), photo.jpeg);
  }

  /** Upload the waiting photo; afterwards it moves into the cache, so I see it without downloading. */
  async upload(noteId: string, preview: string) {
    const jpeg = await this.read(this.pendingPath(noteId), false);
    if (!jpeg) return;   // already uploaded
    await this.api.put(`/notes/${noteId}/photo`, { jpeg, preview });
    await this.write(this.cachePath(noteId), jpeg);
    await this.discardPending(noteId);
  }

  /** Edit mode: upload a new photo right away (online) and keep it in the cache. */
  async replace(noteId: string, photo: NotePhoto) {
    await this.api.put(`/notes/${noteId}/photo`, { jpeg: photo.jpeg, preview: photo.preview });
    await this.write(this.cachePath(noteId), photo.jpeg);
  }

  async remove(noteId: string) {
    await this.api.delete(`/notes/${noteId}/photo`);
    await Filesystem.deleteFile({ path: this.cachePath(noteId), directory: Directory.Data }).catch(() => {});
  }

  async pendingDataUrl(noteId: string): Promise<string | null> {
    return this.read(this.pendingPath(noteId));
  }

  discardPending(noteId: string): Promise<void> {
    return Filesystem.deleteFile({ path: this.pendingPath(noteId), directory: Directory.Data }).catch(() => {});
  }

  private async download(noteId: string): Promise<string | null> {
    try {
      const blob = await this.api.getBlob(`/notes/${noteId}/photo`);
      const base64 = await blobToBase64(blob);
      await this.write(this.cachePath(noteId), base64);
      return jpegDataUrl(base64);
    } catch {
      return null;   // offline or no photo
    }
  }

  private dir(kind: 'cache' | 'pending') {
    return `photos/${this.auth.userId() ?? 'none'}/${kind}`;
  }

  private cachePath(noteId: string) {
    return `${this.dir('cache')}/${noteId}.jpg`;
  }

  private pendingPath(noteId: string) {
    return `${this.dir('pending')}/${noteId}.jpg`;
  }

  /** Base64 file content as data URL (or raw base64), null if missing. */
  /** Photos are stored encrypted (text file); files from before encryption are plain JPEG and still readable. */
  private async read(path: string, asDataUrl = true): Promise<string | null> {
    try {
      const text = await Filesystem.readFile({ path, directory: Directory.Data, encoding: Encoding.UTF8 });
      let base64 = typeof text.data === 'string' && text.data.startsWith('enc1:') ? await decryptBase64(text.data) : null;
      if (base64 === null) {
        const { data } = await Filesystem.readFile({ path, directory: Directory.Data });
        base64 = typeof data === 'string' ? data : await blobToBase64(data);
        await this.write(path, base64);    // stored before encryption existed: re-save encrypted
      }
      return asDataUrl ? jpegDataUrl(base64) : base64;
    } catch {
      return null;
    }
  }

  private async write(path: string, base64: string) {
    const data = await encryptBase64(base64);
    await Filesystem.writeFile({ path, data, directory: Directory.Data, encoding: Encoding.UTF8, recursive: true });
  }
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}
