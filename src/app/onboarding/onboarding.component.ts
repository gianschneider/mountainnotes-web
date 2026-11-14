import { Component, inject, signal } from '@angular/core';
import { IonContent, IonButton, IonIcon, ModalController } from '@ionic/angular';
import { addIcons } from 'ionicons';
import { lockClosed, add, cloudDownloadOutline, shieldCheckmarkOutline, phonePortraitOutline } from 'ionicons/icons';
import { Preferences } from '@capacitor/preferences';
import { DEFAULT_UNLOCK_RADIUS_M, MAX_ADJUST_M } from '../core/note';

const DONE_KEY = 'onboarding-done';

interface Step {
  icon: string;
  title: string;
  text: string;
}

/** Short introduction on the first start; can be opened again from the profile. */
@Component({
  selector: 'app-onboarding',
  templateUrl: 'onboarding.component.html',
  styleUrls: ['onboarding.component.scss'],
  imports: [IonContent, IonButton, IonIcon],
})
export class OnboardingComponent {
  private modals = inject(ModalController);

  readonly steps: Step[] = [
    {
      icon: 'lock-closed', title: 'Notes bound to a place',
      text: `MountainNotes are bound to a place. The map shows where one lies, but you can only read it `
        + `once you are there (about ${DEFAULT_UNLOCK_RADIUS_M} m). The app tells you when you get close (Android phones also vibrate).`,
    },
    {
      icon: 'add', title: 'Leave a note yourself',
      text: `Tap + when you stand at the spot. You can still move the marker by ${MAX_ADJUST_M} m, `
        + 'add a photo and choose who may read the note: everyone, a group or one person. '
        + 'This is not possible in building zones: notes belong in the mountains.',
    },
    {
      icon: 'cloud-download-outline', title: 'Prepare your tour',
      text: 'In the mountains there is often no network. Save the map and notes of an area beforehand with the cloud at '
        + 'the bottom right. Opening and placing then work offline too; uploading happens later.',
    },
    {
      icon: 'shield-checkmark-outline', title: 'Your position stays with you',
      text: 'Whether you are at a note is checked by the phone itself. Your exact position and your routes never go to '
        + 'the server. The notes on the phone are stored encrypted.',
    },
    ...(isInstalled() ? [] : [installStep()]),
  ];
  readonly index = signal(0);

  /** Opens the introduction unless it was already shown on this phone (or always, when forced). */
  static async showOnce(modals: ModalController, force = false) {
    if (!force && (await Preferences.get({ key: DONE_KEY })).value) return;
    const modal = await modals.create({ component: OnboardingComponent, backdropDismiss: false });
    await modal.present();
    await modal.onDidDismiss();
    await Preferences.set({ key: DONE_KEY, value: '1' });
  }

  constructor() {
    addIcons({ lockClosed, add, cloudDownloadOutline, shieldCheckmarkOutline, phonePortraitOutline });
  }

  next() {
    if (this.index() < this.steps.length - 1) this.index.update((i) => i + 1);
    else this.close();
  }

  close() {
    this.modals.dismiss();
  }
}

/** True when the web app runs from the home screen (own window), not in a browser tab. */
export function isInstalled(): boolean {
  return matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true;
}

/** Last step in the browser: how to put the web app on the home screen. */
function installStep(): Step {
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);   // iPadOS reports itself as a Mac
  const how = ios
    ? 'In Safari, tap the Share button and then "Add to Home Screen".'
    : 'In Chrome, tap the menu ⋮ and then "Add to Home screen" or "Install app".';
  return {
    icon: 'phone-portrait-outline', title: 'Add it to your home screen',
    text: `${how} MountainNotes then starts like an app, works offline and the browser keeps your saved notes and maps.`,
  };
}
