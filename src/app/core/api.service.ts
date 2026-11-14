import { Injectable, inject, signal } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Preferences } from '@capacitor/preferences';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../environments/environment';

const API_URL_KEY = 'apiUrl';

/** Thin wrapper around the REST API. The auth token is added by authInterceptor. */
@Injectable({ providedIn: 'root' })
export class ApiService {
  private http = inject(HttpClient);

  readonly baseUrl = signal(environment.apiUrl);

  async init() {
    const { value } = await Preferences.get({ key: API_URL_KEY });
    if (value) this.baseUrl.set(value);
  }

  /** Override the backend URL (e.g. laptop vs. Raspberry Pi); empty resets to the default. */
  async setBaseUrl(url: string) {
    const clean = url.trim().replace(/\/+$/, '');
    if (clean) {
      await Preferences.set({ key: API_URL_KEY, value: clean });
      this.baseUrl.set(clean);
    } else {
      await Preferences.remove({ key: API_URL_KEY });
      this.baseUrl.set(environment.apiUrl);
    }
  }

  get<T>(path: string): Promise<T> {
    return firstValueFrom(this.http.get<T>(this.baseUrl() + path));
  }

  getBlob(path: string): Promise<Blob> {
    return firstValueFrom(this.http.get(this.baseUrl() + path, { responseType: 'blob' }));
  }

  put<T = void>(path: string, body: unknown): Promise<T> {
    return firstValueFrom(this.http.put<T>(this.baseUrl() + path, body));
  }

  post<T>(path: string, body: unknown): Promise<T> {
    return firstValueFrom(this.http.post<T>(this.baseUrl() + path, body));
  }

  patch<T = void>(path: string, body: unknown): Promise<T> {
    return firstValueFrom(this.http.patch<T>(this.baseUrl() + path, body));
  }

  delete<T = void>(path: string): Promise<T> {
    return firstValueFrom(this.http.delete<T>(this.baseUrl() + path));
  }
}

// Our own user-facing texts for the error codes the API sends ({ error, code }).
const ERROR_TEXTS: Record<string, string> = {
  WRONG_CREDENTIALS: 'Username or password is wrong. The password is case-sensitive.',
  USERNAME_TAKEN: 'This username is already taken. Choose another one.',
  SESSION_EXPIRED: 'Your session has expired. Please log in again.',
  UNKNOWN_USER: 'This user does not exist. Check the spelling of the name.',
  USER_NOT_FOUND: 'This user no longer exists.',
  UNKNOWN_CODE: 'This invite code is unknown. Check the 8 characters or ask for a new code.',
  NOT_A_MEMBER: 'You are not (or no longer) in this group.',
  NAME_REQUIRED: 'Please enter a name.',
  ADJUST_TOO_FAR: 'The marker is more than 20 m from the GNSS fix.',
  IN_SETTLEMENT: 'This is a building zone. Notes cannot be placed in settlements.',
  INVALID_PERIOD: 'The end date must be after the start date.',
  EXPIRED: 'The end date has already passed.',
  INVALID_BBOX: 'This map area is too large. Zoom in closer.',
  NOT_GROUP_ADMIN: 'Only admins of this group can do that.',
  ADMIN_ONLY: 'Only admins can do that.',
  TEST_ACCOUNTS_ONLY: 'This only works with test accounts.',
  NOT_ALLOWED: 'You are not allowed to do that.',
  SELF: 'This is not possible for your own account.',
  GROUP_NOT_FOUND: 'This group no longer exists.',
  MEMBER_NOT_FOUND: 'This person is no longer in the group.',
  REQUEST_NOT_FOUND: 'This join request no longer exists.',
  NOTE_NOT_FOUND: 'This note no longer exists.',
  TOO_MANY_ATTEMPTS: 'Too many attempts. Wait a moment and try again.',
  WRONG_PASSWORD: 'The current password is wrong.',
  SAME_PASSWORD: 'The new password must differ from the old one.',
  LAST_ADMIN: 'You are the only admin. Make someone else an admin first.',
  NOTE_QUOTA: 'You have placed a lot of notes today (at most 100 per day). Try again tomorrow.',
  PHOTO_QUOTA: 'You have reached the maximum of 100 photos. Delete old notes with photos to add new ones.',
  STORAGE_FULL: 'The server has no space for photos right now. The note is saved without the photo.',
  PHOTO_NOT_JPEG: 'The photo must be a JPEG.',
  PHOTO_TOO_LARGE: 'The photo is too large (at most 2 MB).',
  PHOTO_NOT_FOUND: 'There is no photo for this note any more.',
};

/** Fallback by HTTP status when the server sent no known code. */
function statusText(status: number): string {
  if (status === 0) return 'No connection to the server. Check Wi-Fi or mobile data and try again.';
  if (status === 400) return 'The input is invalid. Check the fields.';
  if (status === 401) return ERROR_TEXTS['SESSION_EXPIRED'];
  if (status === 403) return ERROR_TEXTS['NOT_ALLOWED'];
  if (status === 404) return 'Not found. It may have been deleted in the meantime.';
  if (status === 413) return 'This is too large.';
  if (status === 429) return 'Too many attempts. Wait a moment and try again.';
  if (status >= 500) return 'Something went wrong on the server. Try again later.';
  return `Unexpected error (${status}).`;
}

/** User-facing text for an API error; `fallbackCode` is used when the server sent no code. */
export function errorMessage(err: unknown, fallbackCode?: string): string {
  if (err instanceof HttpErrorResponse) {
    // Server texts are technical: show only our own texts.
    if (err.error?.code === 'TOO_MANY_ATTEMPTS' && err.error?.retryAfter) {
      const minutes = Math.ceil(err.error.retryAfter / 60);
      return `Too many attempts. Try again in ${minutes === 1 ? 'one minute' : `${minutes} minutes`}.`;
    }
    return ERROR_TEXTS[err.error?.code] ?? (fallbackCode && ERROR_TEXTS[fallbackCode]) ?? statusText(err.status);
  }
  return err instanceof Error ? err.message : String(err);
}
