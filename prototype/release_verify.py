"""Signed release and bounded SWUpdate archive verification; no device mutations."""
# SPDX-License-Identifier: GPL-3.0-only
import base64
import hashlib
import json
from pathlib import Path
import re
import stat
import subprocess
import tempfile

VERSION = re.compile(r'^(0|[1-9]\d{0,3})\.(0|[1-9]\d{0,3})\.(0|[1-9]\d{0,3})(?:-[a-z0-9.-]{1,40})?$')

def decode(value, maximum):
    if not isinstance(value, str) or len(value) > maximum * 2 or not re.fullmatch(r'[A-Za-z0-9_-]+', value):
        raise ValueError('Invalid release encoding')
    data = base64.urlsafe_b64decode(value + '=' * (-len(value) % 4))
    if len(data) > maximum or base64.urlsafe_b64encode(data).decode().rstrip('=') != value:
        raise ValueError('Invalid release encoding')
    return data

def verify_envelope(envelope, trust, openssl='/usr/bin/openssl'):
    if not isinstance(envelope, dict) or envelope.get('schema') != 1:
        raise ValueError('Invalid signed release')
    key = next((key for key in trust['keys'] if key['id'] == envelope.get('keyId')), None)
    if not key:
        raise ValueError('Unknown release publisher')
    payload, signature = decode(envelope.get('payload'), 65536), decode(envelope.get('signature'), 1024)
    with tempfile.TemporaryDirectory(prefix='astra-verify-') as directory:
        root = Path(directory)
        (root / 'public.pem').write_text(key['publicKey'])
        (root / 'payload').write_bytes(payload)
        (root / 'signature').write_bytes(signature)
        result = subprocess.run([openssl, 'dgst', '-sha256', '-verify', str(root / 'public.pem'), '-signature', str(root / 'signature'), str(root / 'payload')], capture_output=True, timeout=10)
        if result.returncode:
            raise ValueError('Release signature verification failed')
    manifest = json.loads(payload)
    if (manifest.get('schema') != 1 or manifest.get('modelId') != 'astra-thing'
            or not VERSION.fullmatch(manifest.get('version', '')) or not VERSION.fullmatch(manifest.get('minimumManager', ''))
            or manifest.get('channel') not in ('stable', 'preview') or not re.fullmatch(r'\d{14}', manifest.get('build', ''))):
        raise ValueError('Unsupported release')
    if set(manifest.get('artifacts', {})) != {'flash', 'update'}:
        raise ValueError('Missing release artifacts')
    for kind, artifact in manifest['artifacts'].items():
        if (not re.fullmatch(r'[a-zA-Z0-9][a-zA-Z0-9._-]{0,150}', artifact.get('file', ''))
                or not artifact['file'].endswith('.zip' if kind == 'flash' else '.swu')
                or type(artifact.get('bytes')) is not int or not 0 < artifact['bytes'] <= (4 * 1024**3 if kind == 'flash' else 600 * 1024**2)
                or not re.fullmatch(r'[a-f0-9]{64}', artifact.get('sha256', ''))):
            raise ValueError('Invalid artifact')
    return manifest

def verify_swu(path, manifest, template):
    """Require the exact reviewed A/B actions as well as archive/payload hashes."""
    artifact = manifest['artifacts']['update']
    with path.open('rb') as source:
        digest = hashlib.file_digest(source, 'sha256').hexdigest()
    if path.stat().st_size != artifact['bytes'] or digest != artifact['sha256']:
        raise ValueError('Update package hash or length mismatch')
    expected = {'sw-description': 16384, 'boot.vfat': 64 * 1024**2, 'system.img': 516 * 1024**2}
    members, description = {}, None
    with path.open('rb') as stream:
        while True:
            header = stream.read(110)
            if len(header) != 110 or header[:6] not in (b'070701', b'070702'):
                raise ValueError('Invalid update archive')
            fields = [int(header[i:i+8], 16) for i in range(6, 110, 8)]
            mode, size, name_size, checksum = fields[1], fields[6], fields[11], fields[12]
            if not 1 <= name_size <= 128:
                raise ValueError('Invalid archive member name')
            raw = stream.read(name_size)
            if len(raw) != name_size or not raw.endswith(b'\0'):
                raise ValueError('Truncated archive name')
            name = raw[:-1].decode('ascii')
            if any(stream.read(-(110 + name_size) % 4)):
                raise ValueError('Invalid archive padding')
            if name == 'TRAILER!!!':
                if size or any(stream.read(512)) or stream.read(1):
                    raise ValueError('Unexpected archive trailer')
                break
            if name not in expected or name in members or not stat.S_ISREG(mode) or not 0 < size <= expected[name]:
                raise ValueError('Unexpected update member')
            digest, crc, remaining, small = hashlib.sha256(), 0, size, bytearray()
            while remaining:
                block = stream.read(min(1024**2, remaining))
                if not block:
                    raise ValueError('Truncated update payload')
                digest.update(block)
                if header[:6] == b'070702':
                    crc = (crc + sum(block)) & 0xffffffff
                remaining -= len(block)
                if name == 'sw-description':
                    small.extend(block)
            if header[:6] == b'070702' and checksum != crc:
                raise ValueError('Update member checksum failed')
            if any(stream.read(-size % 4)):
                raise ValueError('Invalid member padding')
            members[name] = {'bytes': size, 'sha256': digest.hexdigest()}
            if small:
                description = small.decode('utf8')
    if set(members) != set(expected) or members['boot.vfat']['bytes'] != expected['boot.vfat']:
        raise ValueError('Incomplete update')
    expected_description = template.replace('@@VERSION@@', manifest['version'] + '+' + manifest['build'])
    for name in ('boot.vfat', 'system.img'):
        expected_description = expected_description.replace('$swupdate_get_sha256(' + name + ')', members[name]['sha256'])
    if (description or '').strip() != expected_description.strip():
        raise ValueError('Update requests unexpected write operations')
    return members
