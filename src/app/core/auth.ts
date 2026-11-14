import { inject } from '@angular/core';
import { HttpInterceptorFn } from '@angular/common/http';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from './auth.service';

/** Adds the JWT to every API request. */
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const token = inject(AuthService).token();
  return next(token ? req.clone({ setHeaders: { Authorization: `Bearer ${token}` } }) : req);
};

/** Only logged-in users may enter the tabs. */
export const authGuard: CanActivateFn = () =>
  inject(AuthService).isLoggedIn() || inject(Router).parseUrl('/login');

/** Logged-in users skip the login page. */
export const guestGuard: CanActivateFn = () =>
  !inject(AuthService).isLoggedIn() || inject(Router).parseUrl('/tabs/map');

/** Administration is only for app admins. */
export const adminGuard: CanActivateFn = () =>
  inject(AuthService).user()?.role === 'admin' || inject(Router).parseUrl('/tabs/profile');
