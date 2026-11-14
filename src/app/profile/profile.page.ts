import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { OnboardingComponent } from '../onboarding/onboarding.component';
import {
  IonHeader, IonToolbar, IonTitle, IonContent, IonList, IonListHeader, IonItem, IonLabel, IonInput,
  IonButton, IonNote, IonIcon, IonBadge, ModalController,
} from '@ionic/angular';
import { addIcons } from 'ionicons';
import { personCircleOutline, bookOutline, shieldCheckmarkOutline, logOutOutline, keyOutline, mapOutline, trashOutline, helpCircleOutline, refreshOutline } from 'ionicons/icons';
import { AuthService } from '../core/auth.service';
import { ApiService, errorMessage } from '../core/api.service';
import { Ui } from '../core/ui';
import { NotesService } from '../core/notes.service';
import { UnlockService } from '../core/unlock.service';

@Component({
  selector: 'app-profile',
  templateUrl: 'profile.page.html',
  imports: [
    FormsModule, RouterLink, IonHeader, IonToolbar, IonTitle, IonContent, IonList, IonListHeader, IonItem, IonLabel,
    IonInput, IonButton, IonNote, IonIcon, IonBadge,
  ],
})
export class ProfilePage {
  readonly auth = inject(AuthService);
  readonly api = inject(ApiService);
  private router = inject(Router);
  private ui = inject(Ui);
  private modals = inject(ModalController);
  private notes = inject(NotesService);
  private unlock = inject(UnlockService);

  apiUrl = this.api.baseUrl();
  serverStatus = signal<string | null>(null);

  constructor() {
    addIcons({ personCircleOutline, bookOutline, shieldCheckmarkOutline, logOutOutline, keyOutline, mapOutline, trashOutline, helpCircleOutline, refreshOutline });
  }

  /** Test accounts only: lock opened notes again so the demo can be repeated. */
  async resetDemo() {
    try {
      await this.notes.forgetOpens();
      this.unlock.forgetProgress();
      this.ui.toast('Demo reset: opened notes are locked again');
    } catch (err) {
      this.ui.toast(errorMessage(err), 'danger');
    }
  }

  async testServer() {
    this.serverStatus.set('Checking …');
    await this.api.setBaseUrl(this.apiUrl);
    this.apiUrl = this.api.baseUrl();
    try {
      const health = await this.api.get<{ postgis: string }>('/health');
      this.serverStatus.set(`Connected (PostGIS ${health.postgis})`);
    } catch (err) {
      this.serverStatus.set(errorMessage(err));
    }
  }

  async changePassword() {
    const input = await this.ui.passwordChange();
    if (!input) return;
    if (!input.current) return this.ui.toast('Please enter your current password.', 'danger');
    if (input.next.length < 8) return this.ui.toast('The new password must be at least 8 characters long.', 'danger');
    if (input.next !== input.repeat) return this.ui.toast('The two new passwords do not match.', 'danger');
    try {
      await this.auth.changePassword(input.current, input.next);
      this.ui.toast('Password changed. Other devices are logged out.', 'success');
    } catch (err) {
      this.ui.toast(errorMessage(err), 'danger');
    }
  }

  showIntro() {
    OnboardingComponent.showOnce(this.modals, true);
  }

  async deleteAccount() {
    const ok = await this.ui.confirm('Delete account',
      'Your account, all your notes with photos and your group memberships will be deleted for good. '
      + 'This cannot be undone.', 'Continue', true);
    if (!ok) return;
    const password = await this.ui.password('Delete account', 'Enter your password to confirm:', 'Delete for good');
    if (!password) return;
    try {
      await this.auth.deleteAccount(password);
      this.ui.toast('Your account has been deleted.');
      await this.router.navigateByUrl('/login', { replaceUrl: true });
    } catch (err) {
      this.ui.toast(errorMessage(err), 'danger');
    }
  }

  async logout() {
    await this.auth.logout();
    await this.router.navigateByUrl('/login', { replaceUrl: true });
  }
}
