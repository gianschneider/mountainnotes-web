import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { HttpErrorResponse } from '@angular/common/http';
import {
  IonContent, IonList, IonItem, IonInput, IonButton,
  IonSegment, IonSegmentButton, IonLabel, IonText, IonSpinner,
} from '@ionic/angular';
import { AuthService } from '../core/auth.service';
import { errorMessage } from '../core/api.service';

const USERNAME_PATTERN = /^[A-Za-z0-9_.-]+$/;   // as in the server schema

@Component({
  selector: 'app-login',
  templateUrl: 'login.page.html',
  styleUrls: ['login.page.scss'],
  imports: [
    FormsModule, IonContent, IonList, IonItem, IonInput, IonButton,
    IonSegment, IonSegmentButton, IonLabel, IonText, IonSpinner,
  ],
})
export class LoginPage {
  private auth = inject(AuthService);
  private router = inject(Router);

  mode = signal<'login' | 'register'>('login');
  busy = signal(false);
  error = signal<string | null>(null);

  username = '';
  password = '';

  async submit() {
    const invalid = this.validate();
    this.error.set(invalid);
    if (invalid) return;
    this.busy.set(true);
    try {
      if (this.mode() === 'login') await this.auth.login(this.username.trim(), this.password);
      else await this.auth.register(this.username.trim(), this.password);
      this.password = '';
      await this.router.navigateByUrl('/tabs/map', { replaceUrl: true });
    } catch (err) {
      // On this page 401/409 can only mean wrong credentials / name taken (also with an older API without codes).
      const status = err instanceof HttpErrorResponse ? err.status : null;
      this.error.set(errorMessage(err, status === 401 ? 'WRONG_CREDENTIALS' : status === 409 ? 'USERNAME_TAKEN' : undefined));
    } finally {
      this.busy.set(false);
    }
  }

  /** Same rules as the server, checked first so the message can name the problem. */
  private validate(): string | null {
    const username = this.username.trim();
    if (!username) return 'Please enter your username.';
    if (!this.password) return 'Please enter your password.';
    if (this.mode() === 'login') return null;
    if (username.length < 3 || username.length > 32) return 'The username must be 3 to 32 characters long.';
    if (!USERNAME_PATTERN.test(username)) {
      return 'The username may only contain letters without accents, digits and . _ - (no spaces).';
    }
    if (this.password.length < 8) return 'The password must be at least 8 characters long.';
    return null;
  }
}
