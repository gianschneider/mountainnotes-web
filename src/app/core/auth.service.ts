import { Injectable, computed, inject, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { Preferences } from '@capacitor/preferences';
import { Directory, Filesystem } from '@capacitor/filesystem';
import { ApiService } from './api.service';

export interface User {
  id: string;
  username: string;
  role?: 'admin' | 'user';   // missing in sessions saved before roles existed
  isTest?: boolean;          // test account: its notes are hidden from real users
}

interface AuthResponse {
  token: string;
  user: User;
}

const SESSION_KEY = 'session';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private api = inject(ApiService);

  readonly token = signal<string | null>(null);
  readonly user = signal<User | null>(null);
  readonly isLoggedIn = computed(() => this.token() !== null);
  /** Changes only when another user logs in (not when name or role are refreshed). */
  readonly userId = computed(() => this.user()?.id ?? null);

  /** Restore the saved session. Works offline: the token is only re-checked when the server answers. */
  async init() {
    const { value } = await Preferences.get({ key: SESSION_KEY });
    if (!value) return;
    const session = JSON.parse(value) as AuthResponse;
    this.token.set(session.token);
    this.user.set(session.user);

    // Refresh name and role (they may have changed); 401 = token expired or account deleted.
    this.api.get<User>('/auth/me')
      .then(async (user) => {
        this.user.set(user);
        await Preferences.set({ key: SESSION_KEY, value: JSON.stringify({ ...session, user }) });
      })
      .catch((err) => {
        if (err instanceof HttpErrorResponse && err.status === 401) this.logout();
      });
  }

  login(username: string, password: string) {
    return this.authenticate('/auth/login', username, password);
  }

  register(username: string, password: string) {
    return this.authenticate('/auth/register', username, password);
  }

  /** New password; the server invalidates all other sessions and returns a fresh token for this device. */
  async changePassword(currentPassword: string, newPassword: string) {
    const session = await this.api.put<AuthResponse>('/auth/password', { currentPassword, newPassword });
    await Preferences.set({ key: SESSION_KEY, value: JSON.stringify(session) });
    this.token.set(session.token);
    this.user.set(session.user);
  }

  /** Delete my account on the server, then everything of it on this phone (notes, outbox, groups, photos). */
  async deleteAccount(password: string) {
    const id = this.userId();
    await this.api.post('/auth/delete-account', { password });
    if (id) {
      for (const key of [`notes:${id}`, `outbox:${id}`, `groups:${id}`]) await Preferences.remove({ key });
      await Filesystem.rmdir({ path: `photos/${id}`, directory: Directory.Data, recursive: true }).catch(() => {});
    }
    await this.logout();
  }

  async logout() {
    this.token.set(null);
    this.user.set(null);
    await Preferences.remove({ key: SESSION_KEY });
  }

  private async authenticate(path: string, username: string, password: string) {
    const session = await this.api.post<AuthResponse>(path, { username, password });
    await Preferences.set({ key: SESSION_KEY, value: JSON.stringify(session) });
    this.token.set(session.token);
    this.user.set(session.user);
  }
}
