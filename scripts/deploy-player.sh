#!/bin/sh
# Staged app/runtime update. Pairing and firmware stay in place; both prior
# directories are retained and restored automatically if the health check fails.
set -eu
cd "$(dirname "$0")/.."
node --check prototype/web/app.js
node --check prototype/web/browse.js
node --check prototype/web/system.js
python3 scripts/package-prototype.py
scp -F .local/car-thing-ssh.conf .local/astra-prototype.tar.gz carthing:/tmp/astra-prototype.tar.gz
ssh -F .local/car-thing-ssh.conf carthing 'sh -s' <<'DEVICE'
set -eu
cd /opt/superbird-kiosk/astra
release=$(date -u +%Y%m%dT%H%M%SZ)
stage="release.staged-$release"
saved="app.previous-$release"
saved_runtime="runtime.previous-$release"
test -d app
test ! -e "$saved"
mkdir "$stage"
tar -xzf /tmp/astra-prototype.tar.gz -C "$stage"
export PYTHONPATH="$(pwd)/$stage/runtime/usr/lib/python3.14:$(pwd)/$stage/runtime/usr/lib/python3.14/lib-dynload:$(pwd)/$stage/app"
python3 -c 'from device_client import DeviceClient; from hardware_pairing import EphemeralKey; key=EphemeralKey(); assert key.public; key.close()'
python3 "$stage/app/client.py" --help >/dev/null
activated=no
rollback() {
  code=$?
  if [ "$code" -ne 0 ] && [ "$activated" = yes ]; then
    systemctl stop superbird-kiosk-daemon || true
    if [ -d app ]; then mv app "app.failed-$release"; fi
    mv "$saved" app
    if [ -d "$saved_runtime" ]; then
      if [ -d runtime ]; then mv runtime "runtime.failed-$release"; fi
      mv "$saved_runtime" runtime
    fi
    systemctl start superbird-kiosk-daemon
    systemctl restart chromium-kiosk
    echo "Update failed; restored $saved" >&2
  fi
  exit "$code"
}
trap rollback EXIT
systemctl stop superbird-kiosk-daemon
mv app "$saved"
activated=yes
mv runtime "$saved_runtime"
mv "$stage/runtime" runtime
mv "$stage/app" app
cp "$stage/runtime-packages.json" runtime-packages.json
systemctl start superbird-kiosk-daemon
systemctl restart chromium-kiosk
healthy=no
for attempt in 1 2 3 4 5 6 7 8 9 10; do
  if busybox wget -qO /tmp/astra-player-health.json http://127.0.0.1:8080/state; then healthy=yes;break;fi
  sleep 1
done
test "$healthy" = yes
export PYTHONPATH=/opt/superbird-kiosk/astra/runtime/usr/lib/python3.14:/opt/superbird-kiosk/astra/runtime/usr/lib/python3.14/lib-dynload
python3 -c 'import json; data=json.load(open("/tmp/astra-player-health.json")); assert "pairing" in data and "preferences" in data'
systemctl is-active superbird-kiosk-daemon chromium-kiosk
trap - EXIT
echo "Previous app retained at /opt/superbird-kiosk/astra/$saved"
sha256sum app/client.py app/web/app.js
DEVICE
