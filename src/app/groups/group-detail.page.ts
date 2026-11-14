import { Component, computed, inject, input, signal } from '@angular/core';
import { Router } from '@angular/router';
import {
  IonHeader, IonToolbar, IonTitle, IonContent, IonButtons, IonBackButton, IonList, IonListHeader, IonItem,
  IonLabel, IonBadge, IonButton, IonIcon, IonNote, IonText, IonSpinner, IonToggle,
} from '@ionic/angular';
import { addIcons } from 'ionicons';
import { shareOutline, personRemoveOutline, exitOutline, checkmark, close, trashOutline } from 'ionicons/icons';
import { Share } from '@capacitor/share';
import { GroupDetail, GroupMember, GroupsService, JoinRequest, formatInviteCode, inviteLink } from '../core/groups.service';
import { AuthService } from '../core/auth.service';
import { errorMessage } from '../core/api.service';
import { Ui } from '../core/ui';

@Component({
  selector: 'app-group-detail',
  templateUrl: 'group-detail.page.html',
  styleUrls: ['group-detail.page.scss'],
  imports: [
    IonHeader, IonToolbar, IonTitle, IonContent, IonButtons, IonBackButton, IonList, IonListHeader, IonItem,
    IonLabel, IonBadge, IonButton, IonIcon, IonNote, IonText, IonSpinner, IonToggle,
  ],
})
export class GroupDetailPage {
  readonly id = input.required<string>();   // route parameter

  private groupsService = inject(GroupsService);
  private auth = inject(AuthService);
  private ui = inject(Ui);
  private router = inject(Router);

  group = signal<GroupDetail | null>(null);
  error = signal<string | null>(null);

  readonly me = computed(() => this.auth.user()?.id);
  readonly canManage = computed(() => this.group()?.canManage ?? false);
  readonly code = computed(() => formatInviteCode(this.group()?.inviteCode ?? ''));

  constructor() {
    addIcons({ shareOutline, personRemoveOutline, exitOutline, checkmark, close, trashOutline });
  }

  ionViewWillEnter() {
    this.load();
  }

  async load() {
    try {
      this.group.set(await this.groupsService.detail(this.id()));
      this.error.set(null);
    } catch (err) {
      this.error.set(errorMessage(err));
    }
  }

  async share() {
    const group = this.group();
    if (!group) return;
    const text =
      `Join my group «${group.name}» in MountainNotes.\n` +
      `Invite code: ${formatInviteCode(group.inviteCode)}\n${inviteLink(group.inviteCode)}`;
    if ((await Share.canShare()).value) {
      await Share.share({ title: 'Invitation to MountainNotes', text }).catch(() => {});   // cancelled
    } else {
      await navigator.clipboard.writeText(text);
      this.ui.toast('Invitation copied');
    }
  }

  async setApproval(required: boolean) {
    await this.run(() => this.groupsService.update(this.id(), { joinPolicy: required ? 'approval' : 'open' }));
  }

  async approve(request: JoinRequest) {
    await this.run(() => this.groupsService.approve(this.id(), request.id));
  }

  async reject(request: JoinRequest) {
    if (!(await this.ui.confirm('Decline request', `Decline the request from ${request.username}?`, 'Decline', true))) return;
    await this.run(() => this.groupsService.reject(this.id(), request.id));
  }

  async remove(member: GroupMember) {
    if (!(await this.ui.confirm('Remove member', `Remove ${member.username} from the group?`, 'Remove', true))) return;
    await this.run(() => this.groupsService.removeMember(this.id(), member.id));
  }

  async leave() {
    const group = this.group();
    const me = this.me();
    if (!group || !me) return;
    const last = group.memberCount === 1;
    const ok = await this.ui.confirm(
      'Leave group',
      last ? 'You are the last member. The group will be deleted.' : `Leave «${group.name}»?`,
      'Leave',
      true,
    );
    if (!ok) return;
    try {
      await this.groupsService.removeMember(group.id, me);
      await this.router.navigateByUrl('/tabs/groups', { replaceUrl: true });
    } catch (err) {
      this.ui.toast(errorMessage(err), 'danger');
    }
  }

  async deleteGroup() {
    const group = this.group();
    if (!group) return;
    const ok = await this.ui.confirm(
      'Delete group',
      `Delete «${group.name}» with all memberships and all notes for this group? This cannot be undone.`,
      'Delete',
      true,
    );
    if (!ok) return;
    try {
      await this.groupsService.deleteGroup(group.id);
      await this.router.navigateByUrl('/tabs/groups', { replaceUrl: true });
    } catch (err) {
      this.ui.toast(errorMessage(err), 'danger');
    }
  }

  /** Run an admin action, then reload the details; errors as toast. */
  private async run(action: () => Promise<unknown>) {
    try {
      await action();
      await this.load();
    } catch (err) {
      this.ui.toast(errorMessage(err), 'danger');
    }
  }
}
