#!/usr/bin/env python3
"""Inspect the pinned kiosk first-flash archive locally; never contacts a device."""
import argparse
import hashlib
import json
from pathlib import Path
import struct
import tempfile
import zipfile
import zlib


def require(condition, message):
    if not condition:
        raise ValueError(message)


def header(disk, lba):
    disk.seek(lba * 512)
    raw = bytearray(disk.read(512))
    require(raw[:8] == b'EFI PART', f'Missing GPT header at LBA {lba}')
    revision, size, crc, reserved = struct.unpack_from('<4I', raw, 8)
    require(revision == 0x10000 and 92 <= size <= 512 and reserved == 0,
            'Unexpected GPT header format')
    struct.pack_into('<I', raw, 16, 0)
    require(zlib.crc32(raw[:size]) == crc, f'GPT header CRC failed at LBA {lba}')
    current, backup, first, last = struct.unpack_from('<4Q', raw, 24)
    table_lba, count, entry_size, table_crc = struct.unpack_from('<Q3I', raw, 72)
    require(current == lba and count <= 1024 and entry_size == 128,
            'Unexpected GPT table geometry')
    disk.seek(table_lba * 512)
    table = disk.read(count * entry_size)
    require(len(table) == count * entry_size and zlib.crc32(table) == table_crc,
            'GPT partition table CRC failed')
    return {'current': current, 'backup': backup, 'first': first, 'last': last,
            'guid': bytes(raw[56:72]), 'table': table}


def verify(archive, image='superbird-kiosk-dev-image'):
    expected_files = {'meta.json', 'superbird-boot.bin', 'superbird.wic', 'bandaid.ext4'}
    hashes = {}
    with zipfile.ZipFile(archive) as zipped, tempfile.TemporaryFile() as disk:
        require(set(zipped.namelist()) == expected_files and len(zipped.infolist()) == 4,
                'Unexpected archive members')
        for name in sorted(expected_files):
            digest = hashlib.sha256()
            with zipped.open(name) as source:
                while chunk := source.read(4 * 1024 * 1024):
                    digest.update(chunk)
                    if name == 'superbird.wic':
                        disk.write(chunk)
            hashes[name] = {'bytes': zipped.getinfo(name).file_size,
                            'sha256': digest.hexdigest()}
        meta = json.loads(zipped.read('meta.json'))
        require(meta['metadataVersion'] == 2 and meta['name'] == image,
                'Wrong metadata version or image')
        wic_size = hashes['superbird.wic']['bytes']
        require(wic_size % 512 == 0 and 0 < wic_size < 3600 * 1024 * 1024,
                'WIC is not sector aligned or exceeds the upstream minimum eMMC size')
        disk.seek(510)
        require(disk.read(2) == b'\x55\xaa', 'Missing protective MBR signature')
        primary = header(disk, 1)
        require(primary['backup'] == wic_size // 512 - 1, 'Backup GPT is not at the image end')
        backup = header(disk, primary['backup'])
        require(backup['backup'] == 1 and all(primary[k] == backup[k]
                for k in ('first', 'last', 'guid', 'table')), 'GPT copies disagree')
        require(34 <= primary['first'] <= primary['last'] < primary['backup'],
                'GPT usable range is invalid')
        partitions = []
        for offset in range(0, len(primary['table']), 128):
            entry = primary['table'][offset:offset + 128]
            if entry[:16] == bytes(16):
                continue
            start, end = struct.unpack_from('<2Q', entry, 32)
            name = entry[56:128].decode('utf-16-le').rstrip('\0')
            require(primary['first'] <= start <= end <= primary['last'],
                    f'{name} is outside GPT usable range')
            partitions.append({'name': name, 'start_lba': start, 'end_lba': end,
                               'bytes': (end - start + 1) * 512})
        require([p['name'] for p in partitions] ==
                ['env', 'boot_a', 'root_a', 'boot_b', 'root_b', 'bandaid'],
                'Unexpected partition layout')
        require(all(a['end_lba'] < b['start_lba'] for a, b in zip(partitions, partitions[1:])),
                'Overlapping partitions')
        expected_steps = [
            {'type': 'bulkcmd', 'value': 'amlmmc key'},
            *[{'type': 'writeBootPartition', 'value': {
                'hwpart': part, 'data': {'filePath': 'superbird-boot.bin'}}} for part in (1, 2)],
            {'type': 'writeUserArea', 'value': {
                'lba': 0, 'data': {'filePath': 'superbird.wic'}, 'sparse': True}},
            {'type': 'writeUserArea', 'value': {
                'lba': partitions[-1]['start_lba'], 'data': {'filePath': 'bandaid.ext4'}}},
        ]
        require(meta['steps'] == expected_steps, 'Flash steps differ from the reviewed recipe')
        require(0 < hashes['superbird-boot.bin']['bytes'] <= 2 * 1024 * 1024,
                'Boot payload exceeds this unit\'s verified 2 MiB boot hardware partition size')
        for name in ('superbird-boot.bin', 'bandaid.ext4'):
            require(hashes[name]['bytes'] % 512 == 0, f'{name} is not sector aligned')
        require(0 < hashes['bandaid.ext4']['bytes'] <= partitions[-1]['bytes'],
                'Bandaid payload exceeds its partition')
        with zipped.open('bandaid.ext4') as source:
            source.seek(1024 + 56)
            require(source.read(2) == b'\x53\xef', 'Bandaid ext filesystem signature missing')
    with archive.open('rb') as source:
        archive_hash = hashlib.file_digest(source, 'sha256').hexdigest()
    return {'archive': str(archive.resolve()), 'archive_bytes': archive.stat().st_size,
            'archive_sha256': archive_hash, 'payloads': hashes, 'partitions': partitions,
            'metadata': meta, 'result': 'local archive checks passed',
            'limitations': 'Does not verify boot signatures, device capacity, readback, or bootability.'}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('archive', type=Path)
    parser.add_argument('--image', choices=('superbird-kiosk-dev-image', 'astra-thing-dev-image', 'astra-thing-image'), default='superbird-kiosk-dev-image')
    args = parser.parse_args()
    print(json.dumps(verify(args.archive, args.image), indent=2))
