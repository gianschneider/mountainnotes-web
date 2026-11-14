import { Injectable, effect, inject, signal, untracked } from '@angular/core';
import { Preferences } from '@capacitor/preferences';
import { ApiService } from './api.service';
import { AuthService } from './auth.service';

export type JoinPolicy = 'open' | 'approval';

export interface Group {
  id: string;
  name: string;
  inviteCode: string;
  joinPolicy: JoinPolicy;
  role: 'admin' | 'member';
  memberCount: number;
  pendingRequests: number;   // only counted for group admins
}

/** Entry of the public group directory (no members, no invite code). */
export interface DirectoryGroup {
  id: string;
  name: string;
  joinPolicy: JoinPolicy;
  memberCount: number;
  myRole: 'admin' | 'member' | null;
  requested: boolean;
}

export interface JoinRequest {
  id: string;   // user id
  username: string;
  requestedAt: string;
}

export interface GroupMember {
  id: string;
  username: string;
  role: 'admin' | 'member';
  joinedAt: string;
}

export interface GroupDetail extends Omit<Group, 'role' | 'pendingRequests'> {
  role: 'admin' | 'member' | null;   // null: app admin looking at a group they are not in
  canManage: boolean;
  members: GroupMember[];
  requests: JoinRequest[];
}

/** "XRYT6GFE" → "XRYT-6GFE" */
export function formatInviteCode(code: string): string {
  return code.replace(/^(.{4})(.+)$/, '$1-$2');
}

/** Short, shareable address of the web app. */
export const SHORT_LINK = 'https://mountainnotes.pages.dev/';

export function inviteLink(code: string): string {
  // Short link (Cloudflare Pages from repo gianschneider/mountainnotes) forwards to the web app with ?join= kept;
  // the app reads it on start (see AppComponent).
  return `${SHORT_LINK}?join=${encodeURIComponent(code)}`;
}

/**
 * My groups. The list is cached per user so it is available offline
 * (needed later to pick a group as audience for a note).
 */
@Injectable({ providedIn: 'root' })
export class GroupsService {
  private api = inject(ApiService);
  private auth = inject(AuthService);
  private fresh = false;   // true once the server answered, so a slow cache read cannot overwrite it

  readonly groups = signal<Group[]>([]);
  /** Invite code from an invite link (?join=CODE), handled by the groups page. */
  readonly pendingJoin = signal<string | null>(null);

  constructor() {
    effect(() => {
      const userId = this.auth.userId();
      this.groups.set([]);
      this.fresh = false;
      // Cached list first (offline), then the server; needed before placing a note, not only on the groups tab.
      if (userId) untracked(() => this.loadCache(userId)).then(() => this.refresh()).catch(() => {});
    });
  }

  async refresh() {
    const groups = await this.api.get<Group[]>('/groups/mine');
    this.setGroups(groups);
  }

  directory(q = ''): Promise<DirectoryGroup[]> {
    return this.api.get<DirectoryGroup[]>(`/groups?q=${encodeURIComponent(q)}`);
  }

  /** Join from the directory: 'member' for open groups, 'pending' when the group admin has to approve. */
  async requestJoin(groupId: string): Promise<'member' | 'pending'> {
    const { status } = await this.api.post<{ status: 'member' | 'pending' }>(`/groups/${groupId}/join`, {});
    if (status === 'member') await this.refresh();
    return status;
  }

  withdrawRequest(groupId: string) {
    return this.api.delete(`/groups/${groupId}/requests/${this.auth.userId()}`);
  }

  approve(groupId: string, userId: string) {
    return this.api.post(`/groups/${groupId}/requests/${userId}/approve`, {});
  }

  reject(groupId: string, userId: string) {
    return this.api.delete(`/groups/${groupId}/requests/${userId}`);
  }

  async update(groupId: string, patch: { name?: string; joinPolicy?: JoinPolicy }) {
    await this.api.patch(`/groups/${groupId}`, patch);
    await this.refresh();
  }

  async deleteGroup(groupId: string) {
    await this.api.delete(`/groups/${groupId}`);
    await this.refresh();
  }

  async create(name: string): Promise<Group> {
    const group = await this.api.post<Group>('/groups', { name });
    await this.refresh();
    return group;
  }

  async join(code: string): Promise<Group> {
    const group = await this.api.post<Group>('/groups/join', { code });
    await this.refresh();
    return group;
  }

  detail(id: string): Promise<GroupDetail> {
    return this.api.get<GroupDetail>(`/groups/${id}`);
  }

  /** Leave the group (userId = me) or, as admin, remove a member. */
  async removeMember(groupId: string, userId: string) {
    await this.api.delete(`/groups/${groupId}/members/${userId}`);
    await this.refresh();
  }

  private cacheKey(userId: string) {
    return `groups:${userId}`;
  }

  private async loadCache(userId: string) {
    const { value } = await Preferences.get({ key: this.cacheKey(userId) });
    if (value && !this.fresh && this.auth.user()?.id === userId) this.groups.set(JSON.parse(value));
  }

  private setGroups(groups: Group[]) {
    this.fresh = true;
    this.groups.set(groups);
    const user = this.auth.user();
    if (user) Preferences.set({ key: this.cacheKey(user.id), value: JSON.stringify(groups) });
  }
}
