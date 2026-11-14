import { Injectable, signal } from '@angular/core';

type CompassState = 'off' | 'on' | 'denied' | 'unsupported';

interface IosOrientationEvent extends DeviceOrientationEvent {
  webkitCompassHeading?: number;     // degrees clockwise from north (iOS Safari / WKWebView)
}

interface PermissionRequesting {
  requestPermission?: () => Promise<'granted' | 'denied'>;
}

/**
 * Compass heading of the phone (degrees clockwise from north), so arrows can point in the real direction.
 * iOS asks for permission, and only after a tap: call enable() from a click handler.
 */
@Injectable({ providedIn: 'root' })
export class HeadingService {
  readonly heading = signal<number | null>(null);
  readonly state = signal<CompassState>(typeof DeviceOrientationEvent === 'undefined' ? 'unsupported' : 'off');

  async enable() {
    if (this.state() === 'on' || this.state() === 'unsupported') return;
    const request = (DeviceOrientationEvent as unknown as PermissionRequesting).requestPermission;
    if (request) {
      const answer = await request().catch(() => 'denied' as const);
      if (answer !== 'granted') return this.state.set('denied');
    }
    // iOS reports a compass heading on "deviceorientation"; other platforms an absolute alpha.
    window.addEventListener('deviceorientation', (e) => this.onOrientation(e as IosOrientationEvent));
    window.addEventListener('deviceorientationabsolute', (e) => this.onOrientation(e as IosOrientationEvent));
    this.state.set('on');
  }

  private onOrientation(e: IosOrientationEvent) {
    const value = e.webkitCompassHeading ?? (e.absolute && e.alpha !== null ? 360 - e.alpha : null);
    if (value === null || Number.isNaN(value)) return;
    const previous = this.heading();
    if (previous === null) return this.heading.set(value);
    // Continuous value (may leave 0–360), so turning past north does not spin the animated arrow around.
    const delta = ((value - previous) % 360 + 540) % 360 - 180;
    if (Math.abs(delta) >= 2) this.heading.set(previous + delta);   // ignore jitter below 2°
  }
}

/** CSS rotation for the "navigate" icon (it points north-east, i.e. 45°) towards a bearing. */
export function arrowRotation(bearing: number, heading: number | null): string {
  return `rotate(${bearing - (heading ?? 0) - 45}deg)`;
}
