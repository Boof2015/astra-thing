#!/usr/bin/env python3
"""Export reviewed project sources, without local keys, device data or build caches."""
# SPDX-License-Identifier: GPL-3.0-only
import argparse
import gzip
import hashlib
import io
import json
from pathlib import Path
import re
import tarfile

ROOT = Path(__file__).resolve().parents[1]
INCLUDE = ('README.md', 'LICENSE', 'LICENSES', '.gitignore', '.github', 'package.json', 'package-lock.json', 'branding',
           'config', 'docs', 'manager', 'meta-astra-thing', 'prototype', 'release',
           'scripts', 'tests', 'tools', 'design-preview')
OMIT = {'.git', '.local', '.codex', '.agents', '.vscode', '.idea', '.venv', 'venv',
        'node_modules', 'target', 'dist', '__pycache__', '.pytest_cache', '.cache',
        'coverage', 'htmlcov', '.DS_Store', 'Thumbs.db', 'Desktop.ini', '.coverage'}
PRIVATE_SUFFIXES = {'.pem', '.key', '.p12', '.pfx', '.keystore', '.jks', '.mobileprovision'}


def omitted(relative):
    name = relative.name
    environment = (name == '.env' or name.startswith('.env.')) and not name.endswith('.example')
    return (any(part in OMIT for part in relative.parts)
            or relative.as_posix().startswith('manager/resources/worker/')
            or environment or relative.suffix in PRIVATE_SUFFIXES
            or relative.suffix in {'.pyc', '.pyo', '.log', '.swp', '.swo'}
            or name.startswith('._'))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('output', type=Path)
    parser.add_argument('--build-record', type=Path, required=True)
    args = parser.parse_args()
    build = json.loads(args.build_record.read_text())
    files = {}
    for name in INCLUDE:
        origin = ROOT / name
        for source in sorted(origin.rglob('*')) if origin.is_dir() else [origin]:
            relative = source.relative_to(ROOT)
            if omitted(relative):
                continue
            if source.is_symlink():
                raise ValueError('Source export does not follow symlinks: ' + str(relative))
            if source.is_file():
                data = source.read_bytes()
                if re.search(rb'(?m)^-----BEGIN (?:RSA |EC )?PRIVATE KEY-----\r?$', data):
                    raise ValueError('Private key material in source input: ' + str(relative))
                files[relative.as_posix()] = data
    for name, digest in build['inputs'].items():
        if name not in files or hashlib.sha256(files[name]).hexdigest() != digest:
            raise ValueError('Sources differ from the tested firmware build: ' + name)
    record = {'firmware': build, 'projectFiles': {name: hashlib.sha256(data).hexdigest() for name, data in files.items()}}
    files['source-inputs.json'] = (json.dumps(record, indent=2) + '\n').encode()
    prefix = 'astra-thing-' + build['version'] + '-' + build['build']
    args.output.parent.mkdir(parents=True, exist_ok=True)
    # Stable headers contain no workstation account name or filesystem timestamps.
    with args.output.open('xb') as output, gzip.GzipFile(filename='', mode='wb', fileobj=output, mtime=0) as compressed, tarfile.open(fileobj=compressed, mode='w|') as archive:
        for name, data in sorted(files.items()):
            info = tarfile.TarInfo(prefix + '/' + name)
            info.size = len(data)
            info.mode = 0o755 if (ROOT / name).exists() and (ROOT / name).stat().st_mode & 0o111 else 0o644
            info.uid = info.gid = info.mtime = 0
            archive.addfile(info, io.BytesIO(data))
    print(json.dumps({'archive': str(args.output), 'files': len(files), 'sha256': hashlib.sha256(args.output.read_bytes()).hexdigest()}))


if __name__ == '__main__':
    main()
