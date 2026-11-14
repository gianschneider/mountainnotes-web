# MountainNotes – Web App

Location-based notes for mountain tours: a note can only be read at the place where it was left.
This is the web app (PWA) for beta users on iOS and Android. The native iOS app and the backend
(Fastify + PostgreSQL/PostGIS on a Raspberry Pi) live in a separate repository.

Course project, module *Advanced Spatial Methods*, FHNW, autumn 2026.

## Use

Open **https://raspberry-5-gian-schneider.tailec4975.ts.net:10000** on the phone and add it to the home screen:

- **iPhone (Safari):** Share button → *Add to Home Screen*
- **Android (Chrome):** menu ⋮ → *Install app* / *Add to Home screen*

Started from the home screen, the app works offline: notes and map areas saved beforehand can be
opened without network, new notes are uploaded later.

## Develop

```bash
npm install
npm start          # http://localhost:4200 (no service worker in development)
npm run build      # production build with service worker in www/
sh deploy.sh       # build and deploy to the Raspberry Pi (nginx + Tailscale Funnel on port 10000)
```

## Limits of the web app

- Position only while the app is open (no background location, no geofencing in the background)
- No vibration on iOS; the nearby hint is shown as a message
- Without installing to the home screen, Safari may delete saved data after some days without use
