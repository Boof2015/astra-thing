#!/usr/bin/env python3
"""Verify release identity and packages; optionally audit every installed root and boot logo on Linux."""
# SPDX-License-Identifier: GPL-3.0-only
import argparse
import contextlib
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import shutil
import subprocess
import tempfile
import zipfile

ROOT = Path(__file__).resolve().parents[1]


def load(name):
    spec = importlib.util.spec_from_file_location(name, ROOT / 'scripts' / (name + '.py'))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def check_identity(flash, update, build):
    if flash['metadata']['version'] != build['version'] or update['version'] != build['version'] + '+' + build['build']:
        raise ValueError('Firmware packages do not match the build record; rebuild before preparing a release')


def extract_update(source, destination):
    # Called only after the complete CPIO structure, members and hashes pass verify().
    with source.open('rb') as stream:
        while True:
            header = stream.read(110)
            size, name_size = int(header[54:62], 16), int(header[94:102], 16)
            name = stream.read(name_size)[:-1].decode('ascii')
            stream.seek(-(110 + name_size) % 4, 1)
            if name == 'TRAILER!!!':
                return
            if name in ('system.img', 'boot.vfat'):
                with (destination / name).open('xb') as output:
                    remaining = size
                    while remaining:
                        chunk = stream.read(min(1024**2, remaining))
                        if not chunk:
                            raise ValueError('Truncated verified update')
                        output.write(chunk)
                        remaining -= len(chunk)
            else:
                stream.seek(size, 1)
            stream.seek(-size % 4, 1)


def audit_images(flash_path, update_path, flash_report, build):
    for command in ('unsquashfs', 'mcopy'):
        if not shutil.which(command):
            raise ValueError('--audit requires Linux squashfs-tools and mtools')
    expected_logo = (ROOT / 'branding/generated/logo.bmp').read_bytes()
    expected_splash = (ROOT / 'branding/generated/splash.png').read_bytes()
    def logo(image, offset=0):
        actual = subprocess.check_output(['mcopy', '-i', str(image) + (f'@@{offset}' if offset else ''), '::logo.bmp', '-'])
        if actual != expected_logo:
            raise ValueError('Boot logo differs from the reviewed branding')
    def root(image, offset=0):
        with tempfile.TemporaryDirectory(prefix='astra-root-') as temporary:
            extracted = Path(temporary) / 'root'
            subprocess.run(['unsquashfs', '-no-xattrs', '-no-progress', '-processors', '2',
                            '-offset', str(offset), '-d', str(extracted), '-excludes', str(image), 'dev/*'],
                           check=True, stdout=subprocess.DEVNULL)
            with contextlib.redirect_stdout(io.StringIO()):
                load('audit-release-rootfs').audit(extracted, build)
            if (extracted / 'usr/share/superbird/splash.png').read_bytes() != expected_splash:
                raise ValueError('OS splash differs from the reviewed branding')
    with tempfile.TemporaryDirectory(prefix='astra-images-') as temporary:
        working = Path(temporary)
        extract_update(update_path, working)
        root(working / 'system.img')
        logo(working / 'boot.vfat')
        with zipfile.ZipFile(flash_path) as archive:
            archive.extract('superbird.wic', working)
        for partition in flash_report['partitions']:
            offset = partition['start_lba'] * 512
            if partition['name'] in ('root_a', 'root_b'):
                root(working / 'superbird.wic', offset)
            elif partition['name'] in ('boot_a', 'boot_b'):
                logo(working / 'superbird.wic', offset)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('flash', type=Path)
    parser.add_argument('update', type=Path)
    parser.add_argument('build_record', type=Path)
    parser.add_argument('--audit', action='store_true')
    parser.add_argument('--report', type=Path)
    args = parser.parse_args()
    build = json.loads(args.build_record.read_text())
    expected_inputs = {'LICENSE'}
    for folder in ('meta-astra-thing', 'prototype', 'branding'):
        expected_inputs.update(str(file.relative_to(ROOT)) for file in (ROOT / folder).rglob('*')
                               if file.is_file() and '__pycache__' not in file.parts
                               and file.suffix != '.pyc' and file.name != '.DS_Store')
    if set(build['inputs']) != expected_inputs:
        raise ValueError('Build record does not describe every firmware input')
    if build['upstream'] != json.loads((ROOT / 'config/bringup-toolchain.json').read_text())['yocto_superbird_commit']:
        raise ValueError('Build uses a different BSP revision')
    for name, expected in build['inputs'].items():
        file = (ROOT / name).resolve()
        if not file.is_relative_to(ROOT) or hashlib.sha256(file.read_bytes()).hexdigest() != expected:
            raise ValueError('Build inputs differ from this checkout: ' + name)
    flash = load('verify-kiosk-image').verify(args.flash, 'astra-thing-image')
    update = load('verify-astra-update').verify(args.update)
    check_identity(flash, update, build)
    if args.audit:
        audit_images(args.flash, args.update, flash, build)
    flash['archive'], update['archive'] = args.flash.name, args.update.name
    result = {'version': build['version'], 'build': build['build'], 'flash': flash, 'update': update,
              'rootsAndBrandingAudited': args.audit, 'hardwareBootTested': False}
    report = json.dumps(result, indent=2) + '\n'
    if args.report:
        args.report.write_text(report)
    print(report)


if __name__ == '__main__':
    main()
