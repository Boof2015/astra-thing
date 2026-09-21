#!/bin/sh
# Development deployment into the existing image's writable vendor app area.
set -eu
cd "$(dirname "$0")/.."
python3 scripts/package-prototype.py
scp -F .local/car-thing-ssh.conf .local/astra-prototype.tar.gz carthing:/tmp/astra-prototype.tar.gz
ssh -F .local/car-thing-ssh.conf carthing 'set -eu
cd /opt/superbird-kiosk
mkdir -p astra
tar -xzf /tmp/astra-prototype.tar.gz -C astra
PYTHONPATH=/opt/superbird-kiosk/astra/runtime/usr/lib/python3.14:/opt/superbird-kiosk/astra/runtime/usr/lib/python3.14/lib-dynload python3 /opt/superbird-kiosk/astra/app/client.py --help >/dev/null
if [ ! -e daemon/kioskd.stock ]; then
  cp -p daemon/kioskd.current daemon/kioskd.stock
  if [ -e kiosk-env ]; then cp -p kiosk-env kiosk-env.before-astra; fi
fi
cp astra/app/launch daemon/kioskd.next
chmod 755 daemon/kioskd.next
mv daemon/kioskd.next daemon/kioskd.current
printf "KIOSK_URL=http://127.0.0.1:8080\n" > kiosk-env
systemctl restart superbird-kiosk-daemon
systemctl restart chromium-kiosk
systemctl is-active superbird-kiosk-daemon chromium-kiosk'
