import { bootstrapApplication } from '@angular/platform-browser';
import { inject, isDevMode, provideAppInitializer } from '@angular/core';
import { provideServiceWorker } from '@angular/service-worker';
import { provideHttpClient, withFetch, withInterceptors } from '@angular/common/http';
import { RouteReuseStrategy, provideRouter, withComponentInputBinding, withPreloading, PreloadAllModules } from '@angular/router';
import { IonicRouteStrategy, provideIonicAngular } from '@ionic/angular';

import { routes } from './app/app.routes';
import { AppComponent } from './app/app.component';
import { ApiService } from './app/core/api.service';
import { AuthService } from './app/core/auth.service';
import { authInterceptor } from './app/core/auth';

bootstrapApplication(AppComponent, {
  providers: [
    { provide: RouteReuseStrategy, useClass: IonicRouteStrategy },
    provideIonicAngular(),
    provideRouter(routes, withPreloading(PreloadAllModules), withComponentInputBinding()),
    provideHttpClient(withFetch(), withInterceptors([authInterceptor])),
    // Offline start: the service worker caches the app shell (not the API; notes have their own offline store).
    provideServiceWorker('ngsw-worker.js', { enabled: !isDevMode(), registrationStrategy: 'registerWhenStable:30000' }),
    // Restore API URL and session before the first route guard runs.
    provideAppInitializer(async () => {
      const api = inject(ApiService);
      const auth = inject(AuthService);
      await api.init();
      await auth.init();
    }),
  ],
});
