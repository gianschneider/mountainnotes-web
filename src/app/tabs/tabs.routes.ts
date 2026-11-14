import { Routes } from '@angular/router';
import { TabsPage } from './tabs.page';
import { adminGuard } from '../core/auth';

export const routes: Routes = [
  {
    path: '',
    component: TabsPage,
    children: [
      {
        path: 'map',
        loadComponent: () => import('../map/map.page').then((m) => m.MapPage),
      },
      {
        path: 'groups',
        loadComponent: () => import('../groups/groups.page').then((m) => m.GroupsPage),
      },
      {
        path: 'groups/:id',
        loadComponent: () => import('../groups/group-detail.page').then((m) => m.GroupDetailPage),
      },
      {
        path: 'profile',
        loadComponent: () => import('../profile/profile.page').then((m) => m.ProfilePage),
      },
      {
        path: 'profile/notes',
        loadComponent: () => import('../profile/my-notes.page').then((m) => m.MyNotesPage),
      },
      {
        path: 'profile/maps',
        loadComponent: () => import('../profile/offline-maps.page').then((m) => m.OfflineMapsPage),
      },
      {
        path: 'profile/admin',
        canActivate: [adminGuard],
        loadComponent: () => import('../admin/admin.page').then((m) => m.AdminPage),
      },
      {
        path: '',
        redirectTo: '/tabs/map',
        pathMatch: 'full',
      },
    ],
  },
];
