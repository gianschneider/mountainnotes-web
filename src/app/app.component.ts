import { Component, inject } from '@angular/core';
import { Router } from '@angular/router';
import { IonApp, IonRouterOutlet } from '@ionic/angular';
import { GroupsService } from './core/groups.service';
import { AuthService } from './core/auth.service';
import { OutboxService } from './core/outbox.service';
import { UnlockService } from './core/unlock.service';

@Component({
  selector: 'app-root',
  templateUrl: 'app.component.html',
  imports: [IonApp, IonRouterOutlet],
})
export class AppComponent {
  private router = inject(Router);
  private groups = inject(GroupsService);
  private auth = inject(AuthService);
  private outbox = inject(OutboxService);   // created at startup so pending notes upload in the background
  private unlock = inject(UnlockService);   // created at startup so proximity alerts work on every tab

  constructor() {
    // Invite links: https://<web app>/?join=<CODE>. The groups page performs the join (after login if needed).
    const code = new URLSearchParams(location.search).get('join');
    if (code && /^[A-Za-z0-9-]+$/.test(code)) {
      history.replaceState(null, '', location.pathname);   // a reload must not join again
      this.groups.pendingJoin.set(code);
      setTimeout(() => this.router.navigateByUrl(this.auth.isLoggedIn() ? '/tabs/groups' : '/login'));
    }
    // Ask the browser not to evict notes, outbox and offline map (granted for installed web apps).
    navigator.storage?.persist?.().catch(() => {});
  }
}
