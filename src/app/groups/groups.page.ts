import { Component, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import {
  IonHeader, IonToolbar, IonTitle, IonContent, IonList, IonItem, IonLabel, IonBadge, IonButton, IonButtons,
  IonIcon, IonRefresher, IonRefresherContent, IonText, IonSegment, IonSegmentButton, IonSearchbar, IonNote,
} from '@ionic/angular';
import type { RefresherCustomEvent } from '@ionic/angular';
import { addIcons } from 'ionicons';
import { add, enterOutline } from 'ionicons/icons';
import { DirectoryGroup, GroupsService } from '../core/groups.service';
import { errorMessage } from '../core/api.service';
import { Ui } from '../core/ui';

@Component({
  selector: 'app-groups',
  templateUrl: 'groups.page.html',
  imports: [
    RouterLink, IonHeader, IonToolbar, IonTitle, IonContent, IonList, IonItem, IonLabel, IonBadge, IonButton,
    IonButtons, IonIcon, IonRefresher, IonRefresherContent, IonText, IonSegment, IonSegmentButton, IonSearchbar,
    IonNote,
  ],
})
export class GroupsPage {
  readonly groupsService = inject(GroupsService);
  private ui = inject(Ui);
  private router = inject(Router);

  view = signal<'mine' | 'discover'>('mine');
  offline = signal(false);
  directory = signal<DirectoryGroup[]>([]);
  private query = '';

  constructor() {
    addIcons({ add, enterOutline });
  }

  ionViewWillEnter() {
    this.reload();
    const code = this.groupsService.pendingJoin();
    if (code) {
      this.groupsService.pendingJoin.set(null);
      this.join(code);
    }
  }

  setView(view: 'mine' | 'discover') {
    this.view.set(view);
    if (view === 'discover') this.loadDirectory();
  }

  async reload(event?: RefresherCustomEvent) {
    try {
      await this.groupsService.refresh();
      if (this.view() === 'discover') await this.loadDirectory();
      this.offline.set(false);
    } catch {
      this.offline.set(true);   // keep showing the cached list
    } finally {
      event?.target.complete();
    }
  }

  search(q: string) {
    this.query = q;
    this.loadDirectory();
  }

  async loadDirectory() {
    try {
      this.directory.set(await this.groupsService.directory(this.query));
      this.offline.set(false);
    } catch {
      this.offline.set(true);
    }
  }

  async create() {
    const name = await this.ui.prompt('New group', {
      placeholder: 'e.g. Basel',
      okText: 'Create',
      message: 'Others can find the group in the directory and ask to join.',
    });
    if (!name) return;
    try {
      const group = await this.groupsService.create(name);
      await this.router.navigate(['/tabs/groups', group.id]);
    } catch (err) {
      this.ui.toast(errorMessage(err), 'danger');
    }
  }

  async join(code?: string) {
    code ??= (await this.ui.prompt('Join group', { placeholder: 'Invite code', okText: 'Join' })) ?? undefined;
    if (!code) return;
    try {
      const group = await this.groupsService.join(code);
      this.ui.toast(`You are now in «${group.name}»`, 'success');
      await this.router.navigate(['/tabs/groups', group.id]);
    } catch (err) {
      this.ui.toast(errorMessage(err), 'danger');
    }
  }

  /** Directory action: join an open group, request a closed one, or withdraw a request. */
  async directoryAction(group: DirectoryGroup) {
    try {
      if (group.myRole) {
        await this.router.navigate(['/tabs/groups', group.id]);
      } else if (group.requested) {
        if (!(await this.ui.confirm('Withdraw request', `Withdraw your request to join «${group.name}»?`, 'Withdraw'))) return;
        await this.groupsService.withdrawRequest(group.id);
      } else if ((await this.groupsService.requestJoin(group.id)) === 'member') {
        this.ui.toast(`You are now in «${group.name}»`, 'success');
      } else {
        this.ui.toast(`Request sent. An admin of «${group.name}» has to approve it.`);
      }
      await this.loadDirectory();
    } catch (err) {
      this.ui.toast(errorMessage(err), 'danger');
    }
  }

  actionLabel(group: DirectoryGroup): string {
    if (group.myRole) return 'Open';
    if (group.requested) return 'Requested';
    return group.joinPolicy === 'open' ? 'Join' : 'Request';
  }
}
