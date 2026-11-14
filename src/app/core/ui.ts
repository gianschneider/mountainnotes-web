import { Injectable, inject } from '@angular/core';
import { AlertController, ToastController } from '@ionic/angular';

/** Small wrappers around Ionic alerts and toasts. */
@Injectable({ providedIn: 'root' })
export class Ui {
  private alerts = inject(AlertController);
  private toasts = inject(ToastController);

  async toast(message: string, color: 'success' | 'danger' | 'medium' = 'medium', duration = 2500) {
    const toast = await this.toasts.create({ message, color, duration, position: 'top' });
    await toast.present();
  }

  /** Ask for one line of text; resolves to null when cancelled. */
  async prompt(header: string, options: { placeholder?: string; okText: string; message?: string; value?: string }) {
    const alert = await this.alerts.create({
      header,
      message: options.message,
      inputs: [{ name: 'value', type: 'text', placeholder: options.placeholder, value: options.value }],
      buttons: [{ text: 'Cancel', role: 'cancel' }, { text: options.okText, role: 'confirm' }],
    });
    await alert.present();
    const { role, data } = await alert.onDidDismiss();
    const value = (data?.values?.value ?? '').trim();
    return role === 'confirm' && value ? value : null;
  }

  /** Asks for the password before a destructive action; null when cancelled. */
  async password(header: string, message: string, okText: string): Promise<string | null> {
    const alert = await this.alerts.create({
      header, message,
      inputs: [{ name: 'value', type: 'password', placeholder: 'Password', attributes: { autocomplete: 'current-password' } }],
      buttons: [{ text: 'Cancel', role: 'cancel' }, { text: okText, role: 'confirm', cssClass: 'alert-button-danger' }],
    });
    await alert.present();
    const { role, data } = await alert.onDidDismiss();
    const value = data?.values?.value ?? '';
    return role === 'confirm' && value ? value : null;
  }

  /** Current and new password (twice); resolves to null when cancelled. */
  async passwordChange(): Promise<{ current: string; next: string; repeat: string } | null> {
    const alert = await this.alerts.create({
      header: 'Change password',
      message: 'You will then be logged out on all other devices.',
      inputs: [
        { name: 'current', type: 'password', placeholder: 'Current password', attributes: { autocomplete: 'current-password' } },
        { name: 'next', type: 'password', placeholder: 'New password (min. 8 characters)', attributes: { autocomplete: 'new-password' } },
        { name: 'repeat', type: 'password', placeholder: 'Repeat new password', attributes: { autocomplete: 'new-password' } },
      ],
      buttons: [{ text: 'Cancel', role: 'cancel' }, { text: 'Change', role: 'confirm' }],
    });
    await alert.present();
    const { role, data } = await alert.onDidDismiss();
    return role === 'confirm' ? data.values : null;
  }

  async confirm(header: string, message: string, okText: string, destructive = false): Promise<boolean> {
    const alert = await this.alerts.create({
      header,
      message,
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        { text: okText, role: 'confirm', cssClass: destructive ? 'alert-button-danger' : undefined },
      ],
    });
    await alert.present();
    return (await alert.onDidDismiss()).role === 'confirm';
  }
}
