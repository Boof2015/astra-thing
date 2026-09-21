"""Verified inactive-slot installation and post-boot confirmation."""
# SPDX-License-Identifier: GPL-3.0-only
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import threading
import time
from client import save_connection
from release_verify import verify_envelope, verify_swu

class Updater:
    def __init__(self, root, trust, template, version, execute=subprocess.run, boot_id=None):
        self.root, self.trust, self.template, self.version, self.execute = root, trust, template, version, execute
        self.lock = threading.RLock()
        self.receive_deadline = None
        self.boot_id = boot_id or Path('/proc/sys/kernel/random/boot_id').read_text().strip()
        self.job = json.loads((root / 'operation.json').read_text()) if (root / 'operation.json').exists() else None
        if self.job and self.job.get('phase') in ('receiving', 'checking', 'installing'):
            self.job.update(phase='interrupted', message='The update did not finish. Check the running firmware before trying again.')
            self.persist()
        for stale in root.glob('update-*.swu'):
            if re.fullmatch(r'update-[a-f0-9]{32}\.swu', stale.name):
                stale.unlink(missing_ok=True)

    def persist(self):
        save_connection(self.root / 'operation.json', self.job)

    def command(self, args, timeout=30):
        result = self.execute(args, capture_output=True, timeout=timeout)
        if result.returncode:
            raise ValueError('Device maintenance command failed: ' + args[0])
        return result.stdout.decode().strip()

    def slots(self):
        match = re.search(r'(?:^|\s)superbird\.slot=([ab])(?:\s|$)', Path('/proc/cmdline').read_text())
        if not match:
            raise ValueError('Cannot determine the running firmware slot')
        active = match[1]
        running = self.command(['findmnt', '-n', '-o', 'SOURCE', '/'])
        if Path(running).resolve() != Path('/dev/disk/by-partlabel/root_' + active).resolve():
            raise ValueError('Root filesystem and boot slot disagree')
        selected = self.command(['fw_printenv', '-n', 'slot_active'])
        if selected != active:
            raise ValueError('A different firmware slot is already selected for the next boot')
        return active, 'b' if active == 'a' else 'a'

    def snapshot(self):
        with self.lock:
            self.expire_upload()
            if not self.job:
                return None
            return {key: self.job[key] for key in ('id', 'phase', 'message', 'received', 'bytes', 'version', 'build', 'previousSlot', 'targetSlot') if key in self.job}

    def expire_upload(self):
        # A computer can disappear after preparation but before opening the upload.
        # Expire only that reservation; an accepted stream has its own idle timeout.
        if self.job and self.job['phase'] == 'receiving' and self.receive_deadline is not None and time.monotonic() >= self.receive_deadline:
            self.job.update(phase='interrupted', message='The upload did not start. Reconnect your Thing and try the update again.')
            self.receive_deadline = None
            self.persist()

    def prepare(self, envelope, owner):
        manifest = verify_envelope(envelope, self.trust)
        artifact = manifest['artifacts']['update']
        if manifest['build'] <= self.version.get('build', ''):
            raise ValueError('Choose a newer firmware release')
        if tuple(map(int, manifest['version'].split('-')[0].split('.'))) < tuple(map(int, self.version['version'].split('-')[0].split('.'))):
            raise ValueError('Firmware downgrades are not supported')
        with self.lock:
            self.expire_upload()
            if self.job and self.job['phase'] in ('receiving', 'checking', 'installing', 'restarting'):
                raise ValueError('An update is already in progress')
            active, target = self.slots()
            if shutil.disk_usage(self.root).free < artifact['bytes'] + 64 * 1024**2:
                raise ValueError('Not enough free device storage for this update')
            import secrets
            self.job = {'id': secrets.token_hex(16), 'owner': owner, 'phase': 'receiving', 'received': 0,
                        'bytes': artifact['bytes'], 'version': manifest['version'], 'build': manifest['build'],
                        'previousSlot': active, 'targetSlot': target, 'manifest': manifest, 'envelope': envelope,
                        'bootId': self.boot_id, 'message': 'Receiving the update'}
            self.receive_deadline = time.monotonic() + 120
            self.persist()
            return self.snapshot()

    def receive(self, upload_id, owner, stream, length):
        with self.lock:
            self.expire_upload()
            job = self.job
            if not job or job['id'] != upload_id or job['owner'] != owner or job['phase'] != 'receiving' or length != job['bytes']:
                raise ValueError('Update upload does not match the approved package')
            job['phase'] = 'checking'  # Exclusively reserves this upload against concurrent requests.
            self.receive_deadline = None
        path = self.root / ('update-' + upload_id + '.swu')
        try:
            with os.fdopen(os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600), 'wb') as output:
                remaining = length
                while remaining:
                    chunk = stream.read(min(1024**2, remaining))
                    if not chunk:
                        raise ValueError('Update upload was interrupted')
                    output.write(chunk)
                    remaining -= len(chunk)
                    with self.lock:
                        job['received'] = length - remaining
                output.flush()
                os.fsync(output.fileno())
            # The file is complete and closed before any partition operation starts.
            members = verify_swu(path, job['manifest'], self.template)
            active, target = self.slots()
            if (active, target) != (job['previousSlot'], job['targetSlot']):
                raise ValueError('Device boot state changed during upload')
            for name, image in (('boot', 'boot.vfat'), ('root', 'system.img')):
                device = '/dev/disk/by-partlabel/' + name + '_' + target
                if int(self.command(['blockdev', '--getsize64', device])) < members[image]['bytes']:
                    raise ValueError('Update does not fit the inactive firmware slot')
                mounts = self.execute(['findmnt', '-n', '-S', device], capture_output=True)
                if mounts.returncode == 0:
                    raise ValueError('Inactive firmware partition is mounted')
            with self.lock:
                job.update(phase='installing', message='Installing into the inactive firmware slot')
                self.persist()
            threading.Thread(target=self.install, args=(path, members), daemon=True).start()
            return self.snapshot()
        except Exception:
            with self.lock:
                job.update(phase='failed', message='The update could not be verified. Your current firmware has not been replaced.')
                self.persist()
            path.unlink(missing_ok=True)
            raise

    def install(self, path, members):
        try:
            job = self.job
            self.command(['systemctl', 'stop', 'swupdate.socket', 'swupdate.service'])
            select = 'stable,slot_' + job['targetSlot']
            self.command(['swupdate', '-c', '-i', str(path), '-e', select], timeout=90)
            self.command(['swupdate', '-i', str(path), '-e', select], timeout=600)
            for name, image in (('boot', 'boot.vfat'), ('root', 'system.img')):
                remaining, digest = members[image]['bytes'], hashlib.sha256()
                with open('/dev/disk/by-partlabel/' + name + '_' + job['targetSlot'], 'rb') as source:
                    while remaining:
                        block = source.read(min(1024**2, remaining))
                        if not block:
                            raise ValueError('Incomplete firmware readback')
                        digest.update(block)
                        remaining -= len(block)
                if digest.hexdigest() != members[image]['sha256']:
                    raise ValueError('Written firmware did not match the package')
            if self.command(['fw_printenv', '-n', 'slot_active']) != job['targetSlot']:
                raise ValueError('Next boot slot was not selected correctly')
            with self.lock:
                job.update(phase='restarting', message='Restarting into the verified firmware')
                self.persist()
            time.sleep(2)
            self.command(['systemctl', 'reboot'])
        except Exception:
            # A failed write/readback must leave the current slot selected.
            try:
                self.command(['fw_setenv', 'slot_active', self.job['previousSlot']])
                message = 'Update failed. The previous firmware remains selected.'
            except Exception:
                message = 'Update failed and the boot selection could not be restored. Use the recovery guide before restarting.'
            with self.lock:
                self.job.update(phase='failed', message=message)
                self.persist()
        finally:
            path.unlink(missing_ok=True)

    def confirm_boot(self, healthy):
        with self.lock:
            if not self.job or self.job['phase'] != 'restarting':
                return
            if self.job.get('bootId') == self.boot_id:
                return  # The install thread has not restarted this boot yet.
            # A rollback boots the old package, whose service reads the same operation record.
            active = re.search(r'(?:^|\s)superbird\.slot=([ab])(?:\s|$)', Path('/proc/cmdline').read_text())
            if not active:
                return
            if active[1] == self.job['previousSlot']:
                self.job.update(phase='rolled-back', message='The previous firmware is running. The new version did not finish startup.')
            elif active[1] == self.job['targetSlot'] and healthy and self.version.get('version') == self.job['version'] and self.version.get('build') == self.job['build']:
                self.job.update(phase='complete', message='Updated firmware started successfully')
            else:
                return
            self.persist()
