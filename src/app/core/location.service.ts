import { Injectable, signal } from '@angular/core';
import { Geolocation, Position } from '@capacitor/geolocation';

/** Browser error codes of the Geolocation API */
const PERMISSION_DENIED = 1;
const TIMEOUT = 3;

/**
 * Positioning layer: wraps watchPosition() and exposes the latest fix (incl. coords.accuracy) as a signal.
 * No track is stored (privacy by design), only the current position.
 */
@Injectable({ providedIn: 'root' })
export class LocationService {
  readonly position = signal<Position | null>(null);
  readonly error = signal<string | null>(null);
  /** Location access was refused: the map shows how to allow it. */
  readonly denied = signal(false);
  readonly watching = signal(false);

  private watchId?: string;

  constructor() {
    // iOS may silently stop the watch while the web app is in the background: restart it on return.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && this.watching()) this.restart();
    });
  }

  async start() {
    if (this.watchId) return;
    this.watching.set(true);
    this.watchId = await Geolocation.watchPosition(
      {
        enableHighAccuracy: true,
        timeout: 20000,              // first GNSS fix in the mountains can take a while
        maximumAge: 0,               // never use cached positions
      },
      (pos, err) => {
        if (err) return this.onError(err as { code?: number; message?: string });
        if (pos) {
          this.error.set(null);
          this.denied.set(false);
          this.position.set(pos);
        }
      },
    );
  }

  async stop() {
    this.watching.set(false);
    await this.clear();               // GNSS drains the battery
  }

  private async restart() {
    await this.clear();
    if (this.watching()) await this.start();
  }

  private async clear() {
    if (!this.watchId) return;
    const id = this.watchId;
    this.watchId = undefined;
    await Geolocation.clearWatch({ id }).catch(() => {});
  }

  private onError(err: { code?: number; message?: string }) {
    if (err.code === PERMISSION_DENIED || /denied|permission/i.test(err.message ?? '')) {
      this.denied.set(true);
      this.error.set('Location access not allowed');
      this.clear();                   // a later start() (tab change, return to the app) asks again
      return;
    }
    // Timeouts happen while searching for satellites; the watch keeps going, so keep the last fix.
    if (err.code === TIMEOUT && this.position()) return;
    this.error.set(err.code === TIMEOUT ? 'Searching for position …' : 'Position not available');
  }
}
