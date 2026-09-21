#!/usr/bin/env python3
"""Inspect an extracted release root. No device access or writes."""
import argparse
import hashlib
import json
from pathlib import Path

def audit(root, expected):
    identity = json.loads((root / 'etc/astra-thing-release.json').read_text())
    assert identity['version'] == expected['version'] and identity['build'] == expected['build'], 'Firmware identity mismatch'
    for name in ('sshd.service','sshd.socket','ssh.service','android-tools-adbd.service','kiosk-cdp-proxy.service','swupdate.service','swupdate.socket','superbird-slot-ok.timer'):
        entry = root / 'etc/systemd/system' / name
        assert entry.is_symlink() and str(entry.readlink()) == '/dev/null', 'Debug/update ingress is not masked: ' + name
    root_password = next(line.split(':')[1] for line in (root/'etc/shadow').read_text().splitlines() if line.startswith('root:'))
    assert root_password.startswith(('!', '*')), 'Root login is not locked'
    assert not (root/'etc/usb-debugging-enabled').exists(), 'ADB enabled'
    gadget = (root/'usr/libexec/superbird-usb-gadget').read_text()
    assert 'mkdir -p "$CFG/functions/ffs.adb"' not in gadget and 'echo "$UDC" > "$CFG/UDC"' in gadget, 'USB network binding is incorrect'
    chromium = (root/'usr/bin/chromium-kiosk-launch').read_text()
    assert '--remote-debugging-port=' not in chromium and '--remote-allow-origins=' not in chromium, 'Browser debugging enabled'
    assert str((root/'etc/weston.ini').readlink()) == 'weston-kiosk.ini', 'Production compositor configuration missing'
    assert not (root/'etc/default/weston').exists(), 'Development compositor enabled'
    unit = (root/'usr/lib/systemd/system/superbird-kiosk-daemon.service').read_text()
    assert 'ExecStart=/usr/lib/superbird-kiosk/astra/app/launch' in unit, 'Client still uses an overlay'
    for name in ('astra-thing-management.service','astra-thing-boot-watchdog.timer'):
        assert (root/'usr/lib/systemd/system'/name).is_file(), 'Missing health or management service'
    app = root/'usr/lib/superbird-kiosk/astra/app'
    for name, digest in expected['inputs'].items():
        if name.startswith('prototype/'):
            file = app / name.removeprefix('prototype/')
            assert file.is_file() and hashlib.sha256(file.read_bytes()).hexdigest() == digest, 'Bundled client changed: ' + name
    for name in ('connection.json','preferences.json','managers.json','tls-key.pem'):
        assert not list(root.rglob(name)), 'Device-specific state present: ' + name
    print(json.dumps({'version':identity['version'],'build':identity['build'],'result':'Release defaults, immutable client and build inputs verified'}))

if __name__ == '__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('root',type=Path);parser.add_argument('build',type=Path)
    args=parser.parse_args();audit(args.root,json.loads(args.build.read_text()))
