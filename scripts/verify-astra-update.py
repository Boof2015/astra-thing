#!/usr/bin/env python3
"""Verify the built SWU bytes and exact inactive-slot-only recipe, without a device."""
import argparse
import hashlib
import json
from pathlib import Path
import re
import stat


def verify(path):
    expected = {'sw-description': 16384, 'boot.vfat': 64 * 1024**2, 'system.img': 516 * 1024**2}
    members = {}
    description = None
    with path.open('rb') as stream:
        while True:
            header = stream.read(110)
            if len(header) != 110 or header[:6] not in (b'070701', b'070702'):
                raise ValueError('Invalid CPIO header')
            fields = [int(header[i:i + 8], 16) for i in range(6, 110, 8)]
            mode, size, name_size, checksum = fields[1], fields[6], fields[11], fields[12]
            if not 1 <= name_size <= 128:
                raise ValueError('Invalid member name')
            raw_name = stream.read(name_size)
            if not raw_name.endswith(b'\0'):
                raise ValueError('Unterminated member name')
            name = raw_name[:-1].decode('ascii')
            stream.read(-(110 + name_size) % 4)
            if name == 'TRAILER!!!':
                if size or any(stream.read()):
                    raise ValueError('Unexpected trailing data')
                break
            if name not in expected or name in members or not stat.S_ISREG(mode) or not 0 < size <= expected[name]:
                raise ValueError(f'Unexpected member: {name}')
            digest, crc, remaining, small = hashlib.sha256(), 0, size, bytearray()
            while remaining:
                block = stream.read(min(1024**2, remaining))
                if not block:
                    raise ValueError('Truncated payload')
                digest.update(block)
                crc = (crc + sum(block)) & 0xffffffff
                remaining -= len(block)
                if name == 'sw-description':
                    small.extend(block)
            if header[:6] == b'070702' and checksum != crc:
                raise ValueError(f'CPIO checksum mismatch: {name}')
            stream.read(-size % 4)
            members[name] = {'bytes': size, 'sha256': digest.hexdigest()}
            if small:
                description = small.decode()
    if set(members) != set(expected) or members['boot.vfat']['bytes'] != expected['boot.vfat']:
        raise ValueError('Missing image or unexpected boot partition geometry')
    version = re.search(r'version = "(\d+\.\d+\.\d+(?:-[a-z0-9.-]+)?\+\d{14})";', description or '')
    if not version:
        raise ValueError('Unexpected Astra image version')
    template = (Path(__file__).resolve().parents[1] /
        'meta-astra-thing/recipes-extended/astra-thing-update/files/sw-description').read_text()
    template = template.replace('@@VERSION@@', version[1])
    for name in ('boot.vfat', 'system.img'):
        template = template.replace(f'$swupdate_get_sha256({name})', members[name]['sha256'])
    if description.strip() != template.strip():
        raise ValueError('Update actions or payload hashes differ from the reviewed recipe')
    with path.open('rb') as stream:
        checksum = hashlib.file_digest(stream, 'sha256').hexdigest()
    return {'archive': str(path.resolve()), 'sha256': checksum, 'bytes': path.stat().st_size,
            'version': version[1], 'members': members, 'result': 'CPIO, payload hashes and exact A/B update actions verified'}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('archive', type=Path)
    print(json.dumps(verify(parser.parse_args().archive), indent=2))
