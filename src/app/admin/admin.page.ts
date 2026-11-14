import { Component, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import {
  IonHeader, IonToolbar, IonTitle, IonContent, IonButtons, IonBackButton, IonSegment, IonSegmentButton, IonLabel,
  IonList, IonItem, IonButton, IonIcon, IonBadge, IonNote, IonSearchbar, IonRefresher, IonRefresherContent,
} from '@ionic/angular';
import type { RefresherCustomEvent } from '@ionic/angular';
import { addIcons } from 'ionicons';
import { trashOutline, shieldOutline, shieldCheckmark, flaskOutline } from 'ionicons/icons';
import { ApiService, errorMessage } from '../core/api.service';
import { AuthService } from '../core/auth.service';
import { NotesService } from '../core/notes.service';
import { GroupsService, JoinPolicy } from '../core/groups.service';
import { Audience } from '../core/note';
import { Ui } from '../core/ui';

interface AdminNote {
  id: string;
  body: string;
  author: string;
  audience: Audience;
  audienceLabel: string | null;
  authorIsTest: boolean;
  createdAt: string;
  validUntil: string;
  openCount: number;
}

interface AdminUser {
  id: string;
  username: string;
  role: 'admin' | 'user';
  isTest: boolean;
  createdAt: string;
  noteCount: number;
  groupCount: number;
}

interface AdminGroup {
  id: string;
  name: string;
  joinPolicy: JoinPolicy;
  memberCount: number;
  noteCount: number;
}

/** Moderation for app admins: every note (with content), user and group. */
@Component({
  selector: 'app-admin',
  templateUrl: 'admin.page.html',
  imports: [
    DatePipe, RouterLink, IonHeader, IonToolbar, IonTitle, IonContent, IonButtons, IonBackButton, IonSegment,
    IonSegmentButton, IonLabel, IonList, IonItem, IonButton, IonIcon, IonBadge, IonNote, IonSearchbar, IonRefresher,
    IonRefresherContent,
  ],
})
export class AdminPage {
  private api = inject(ApiService);
  private auth = inject(AuthService);
  private notesService = inject(NotesService);
  private groupsService = inject(GroupsService);
  private ui = inject(Ui);

  view = signal<'notes' | 'users' | 'groups'>('notes');
  notes = signal<AdminNote[]>([]);
  users = signal<AdminUser[]>([]);
  groups = signal<AdminGroup[]>([]);
  readonly me = computed(() => this.auth.userId());
  private query = '';

  constructor() {
    addIcons({ trashOutline, shieldOutline, shieldCheckmark, flaskOutline });
  }

  ionViewWillEnter() {
    this.load();
  }

  setView(view: 'notes' | 'users' | 'groups') {
    this.view.set(view);
    this.load();
  }

  search(q: string) {
    this.query = q;
    this.load();
  }

  async load(event?: RefresherCustomEvent) {
    try {
      switch (this.view()) {
        case 'notes': this.notes.set(await this.api.get(`/admin/notes?q=${encodeURIComponent(this.query)}`)); break;
        case 'users': this.users.set(await this.api.get('/admin/users')); break;
        case 'groups': this.groups.set(await this.api.get('/admin/groups')); break;
      }
    } catch (err) {
      this.ui.toast(errorMessage(err), 'danger');
    } finally {
      event?.target.complete();
    }
  }

  async deleteNote(note: AdminNote) {
    if (!(await this.ui.confirm('Delete note', `Delete the note from ${note.author}?\n«${note.body.slice(0, 80)}»`, 'Delete', true))) return;
    await this.run(() => this.notesService.deleteNote(note.id));
  }

  async toggleRole(user: AdminUser) {
    const role = user.role === 'admin' ? 'user' : 'admin';
    const text = role === 'admin' ? `Make ${user.username} an admin? Admins see all notes.` : `Remove the admin role from ${user.username}?`;
    if (!(await this.ui.confirm('Change role', text, 'Change'))) return;
    await this.run(() => this.api.patch(`/admin/users/${user.id}`, { role }));
  }

  /** Notes of test accounts are hidden from real users. */
  async toggleTest(user: AdminUser) {
    const isTest = !user.isTest;
    const text = isTest
      ? `Mark ${user.username} as a test account? Their notes will then only be seen by test accounts and admins.`
      : `Make ${user.username} a real account again? Their notes become visible to everyone allowed.`;
    if (!(await this.ui.confirm('Test account', text, 'Change'))) return;
    await this.run(() => this.api.patch(`/admin/users/${user.id}`, { isTest }));
  }

  async deleteUser(user: AdminUser) {
    const text = `Delete ${user.username} with ${user.noteCount} notes? The groups remain.`;
    if (!(await this.ui.confirm('Delete user', text, 'Delete', true))) return;
    await this.run(() => this.api.delete(`/admin/users/${user.id}`));
  }

  async deleteGroup(group: AdminGroup) {
    const text = `Delete «${group.name}» with ${group.memberCount} members and ${group.noteCount} notes?`;
    if (!(await this.ui.confirm('Delete group', text, 'Delete', true))) return;
    await this.run(() => this.groupsService.deleteGroup(group.id));
  }

  audienceText(note: AdminNote): string {
    return note.audience === 'public' ? 'everyone' : (note.audienceLabel ?? '–');
  }

  private async run(action: () => Promise<unknown>) {
    try {
      await action();
      await this.load();
    } catch (err) {
      this.ui.toast(errorMessage(err), 'danger');
    }
  }
}
