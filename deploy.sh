#!/bin/sh
# Builds the web app and deploys it to the Raspberry Pi (SSH alias in ~/.ssh/config).
#   sh deploy.sh
# The backend (API + database) is shared with the iOS app and deployed from the lbs-workshop repo.
set -eu
cd "$(dirname "$0")"

PI=${PI:-raspberrypi5}
DIR=mountainnotes/web
PORT=10000   # Funnel allows 443, 8443 and 10000; 8443 is the API

echo "→ Building"
npm run build

echo "→ Copying to $PI:~/$DIR"
ssh "$PI" "mkdir -p ~/$DIR/www"
rsync -az --delete hosting/ "$PI:$DIR/" --exclude www
rsync -az --delete www/ "$PI:$DIR/www/"

ssh "$PI" "cd ~/$DIR && PORT=$PORT sh -s" <<'REMOTE'
set -eu
echo "→ Starting nginx"
docker compose up -d --quiet-pull
# The tailscale operator user may change the Funnel config without sudo.
if ! tailscale funnel status 2>/dev/null | grep -q ":$PORT"; then
  echo "→ Publishing on Funnel port $PORT"
  tailscale funnel --bg --https="$PORT" http://127.0.0.1:8081
fi
for i in $(seq 1 15); do
  if curl -fsS -o /dev/null localhost:8081/ngsw.json; then echo "→ Web app is up"; exit 0; fi
  sleep 1
done
echo "Web app does not answer" >&2
docker compose logs --tail 30 web
exit 1
REMOTE

echo "→ https://raspberry-5-gian-schneider.tailec4975.ts.net:$PORT"
