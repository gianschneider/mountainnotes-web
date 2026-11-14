import { Injectable, inject } from '@angular/core';
import { SwUpdate } from '@angular/service-worker';
import { ToastController } from '@ionic/angular';

/**
 * Web app updates: the service worker keeps serving the cached version, so new versions must be looked for
 * actively (on start and whenever the app comes back to the foreground) and switched to with a reload.
 */
@Injectable({ providedIn: 'root' })
export class AppUpdateService {
  private sw = inject(SwUpdate);
  private toasts = inject(ToastController);
  private offered = false;

  start() {
    if (!this.sw.isEnabled) return;
    this.sw.versionUpdates.subscribe((e) => {
      if (e.type === 'VERSION_READY') this.offerReload();
    });
    // Cache broken (e.g. files of the old version evicted): only a reload helps.
    this.sw.unrecoverable.subscribe(() => location.reload());
    this.check();
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') this.check();
    });
  }

  private check() {
    this.sw.checkForUpdate().catch(() => {});   // offline: try again next time
  }

  private async offerReload() {
    if (this.offered) return;
    this.offered = true;
    const toast = await this.toasts.create({
      message: 'A new version of MountainNotes is ready.',
      position: 'top',
      color: 'primary',
      buttons: [{ text: 'Update', role: 'update' }, { text: 'Later', role: 'cancel' }],
    });
    await toast.present();
    const { role } = await toast.onDidDismiss();
    if (role === 'update') location.reload();   // the service worker then serves the new version
    else this.offered = false;
  }
}
