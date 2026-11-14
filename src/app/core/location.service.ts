import { Injectable, signal } from '@angular/core';
import { Capacitor } from '@capacitor/core';
import { Geolocation, Position } from '@capacitor/geolocation';

/**
 * Positioning layer: wraps watchPosition() and exposes the latest fix (incl. coords.accuracy) as a signal.
 * No track is stored (privacy by design), only the current position.
 */
@Injectable({ providedIn: 'root' })
export class LocationService {
  readonly position = signal<Position | null>(null);
  readonly error = signal<string | null>(null);
  readonly watching = signal(false);

  private watchId?: string;

  async start() {
    if (this.watchId) return;
    if (!(await this.ensurePermission())) {
      this.error.set('Location access not allowed');
      return;
    }
    this.error.set(null);
    this.watchId = await Geolocation.watchPosition(
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 0,               // never use cached positions
        interval: 2000,              // Android only: desired update interval
        minimumUpdateInterval: 1000, // Android only
      },
      (pos, err) => {
        if (err) {
          this.error.set(err.message ?? String(err));
          return;
        }
        if (pos) {
          this.error.set(null);
          this.position.set(pos);
        }
      },
    );
    this.watching.set(true);
  }

  async stop() {
    if (!this.watchId) return;
    await Geolocation.clearWatch({ id: this.watchId }); // GNSS drains the battery
    this.watchId = undefined;
    this.watching.set(false);
  }

  private async ensurePermission(): Promise<boolean> {
    if (!Capacitor.isNativePlatform()) return true;
    let perm = await Geolocation.checkPermissions();
    if (perm.location !== 'granted') perm = await Geolocation.requestPermissions();
    return perm.location === 'granted';
  }
}
