#!/usr/bin/env python3
"""Bundle the prototype and missing Python modules from our pinned Yocto build."""
import hashlib
import io
import json
from pathlib import Path
import re
import shutil
import tarfile

ROOT = Path(__file__).resolve().parent.parent
feed = ROOT / '.local/yocto-superbird/build/tmp/deploy/ipk/cortexa53'
stage = ROOT / '.local/prototype-bundle'
stage.mkdir(parents=True, exist_ok=True)
runtime = stage / 'runtime'
runtime.mkdir(exist_ok=True)
installed = {line.split()[0] for line in (ROOT / '.local/yocto-superbird/build/tmp/deploy/images/superbird/superbird-kiosk-dev-image-superbird.manifest').read_text().splitlines()}

def members(path):
    data = path.read_bytes()
    if data[:8] != b'!<arch>\n':
        raise ValueError(f'Not an ipk: {path}')
    cursor = 8
    while cursor < len(data):
        header = data[cursor:cursor + 60]
        size = int(header[48:58])
        yield header[:16].decode().strip().rstrip('/'), data[cursor + 60:cursor + 60 + size]
        cursor += 60 + size + size % 2

pending = ['python3-netserver', 'python3-netclient', 'python3-json', 'python3-crypt',
           'python3-threading', 'python3-html', 'python3-logging', 'python3-ctypes', 'python3-misc', 'python3-shell']
seen = set()
records = []
while pending:
    package = pending.pop()
    if package in seen or package in installed:
        continue
    seen.add(package)
    matches = list(feed.glob(f'{package}_3.14.4-r0_*.ipk'))
    if len(matches) != 1:
        raise ValueError(f'Expected one matching Python package: {package}')
    path = matches[0]
    payloads = dict(members(path))
    with tarfile.open(fileobj=io.BytesIO(payloads['control.tar.gz'])) as archive:
        control = next(m for m in archive if m.name.lstrip('./') == 'control')
        metadata = archive.extractfile(control).read().decode()
    dependencies = re.search(r'^Depends: (.*)$', metadata, re.M)
    if dependencies:
        for dependency in dependencies[1].split(','):
            name = dependency.strip().split()[0]
            if name.startswith('python3-'):
                pending.append(name)
            elif name not in installed:
                raise ValueError(f'Uninstalled native dependency: {name}')
    with tarfile.open(fileobj=io.BytesIO(payloads['data.tar.zst'])) as archive:
        archive.extractall(runtime, filter='data')
    records.append({'package': package, 'file': path.name,
                    'sha256': hashlib.sha256(path.read_bytes()).hexdigest()})
shutil.copytree(ROOT / 'prototype', stage / 'app', dirs_exist_ok=True,
                ignore=shutil.ignore_patterns('__pycache__'))
(stage / 'runtime-packages.json').write_text(json.dumps(records, indent=2) + '\n')
output = ROOT / '.local/astra-prototype.tar.gz'
with tarfile.open(output, 'w:gz') as archive:
    for name in ('runtime', 'app', 'runtime-packages.json'):
        archive.add(stage / name, arcname=name)
print(f'{output}: {output.stat().st_size:,} bytes; {len(records)} matching Python packages')
