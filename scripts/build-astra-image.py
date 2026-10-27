#!/usr/bin/env python3
"""Build the Astra image and inactive-slot update against the pinned upstream BSP. Never flashes."""
from pathlib import Path
import json
import os
import platform
import shutil
import subprocess
import hashlib
import argparse
from datetime import datetime, timezone

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--release', action='store_true', help='Build the public maintenance-enabled firmware profile')
parser.add_argument('--ci', action='store_true', help='Use the standard-runner resource limits (release profile only)')
args = parser.parse_args()
if args.ci and not args.release:
    parser.error('--ci requires --release')

repo = Path(__file__).resolve().parent.parent
profile = json.loads((repo / 'config/bringup-toolchain.json').read_text())
upstream = repo / '.local/yocto-superbird'
branding = json.loads((repo / 'branding/generated/manifest.json').read_text())
def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()
if sha(repo / 'branding/astra-full.svg') != branding['sourceSha256']:
    raise SystemExit('SVG changed: run node scripts/render-branding.mjs first')
for name, expected in branding['files'].items():
    if sha(repo / 'branding/generated' / name) != expected:
        raise SystemExit(f'Branding asset changed: {name}')
if sha(repo / 'prototype/web/assets/astra-full.svg') != branding['sourceSha256']:
    raise SystemExit('App startup logo differs from the supplied SVG')
commit = subprocess.check_output(['git', '-C', str(upstream), 'rev-parse', 'HEAD'], text=True).strip()
if commit != profile['yocto_superbird_commit']:
    raise SystemExit(f'Unexpected upstream revision: {commit}')
subprocess.run(['git', '-C', str(upstream), 'diff', '--exit-code', 'HEAD'], check=True)
# Stage only the public build inputs inside kas-container's /work mount.
# Device state, .local tooling, backups, and credentials never enter a recipe.
stage = upstream / 'astra'
if stage.is_symlink():
    raise SystemExit('Refusing a symlinked image staging directory')
if stage.exists():
    shutil.rmtree(stage)
stage.mkdir()
for name in ('meta-astra-thing', 'prototype', 'branding'):
    shutil.copytree(repo / name, stage / name, ignore=shutil.ignore_patterns('__pycache__', '*.pyc', '.DS_Store'))
shutil.copyfile(repo / 'LICENSE', stage / 'LICENSE')
configuration = (repo / ('config/astra-release.yml' if args.release else 'config/astra-image.yml')).read_text()
if args.release:
    version = json.loads((repo / 'release/version.json').read_text())
    build = datetime.now(timezone.utc).strftime('%Y%m%d%H%M%S')
    configuration += '\n  astra-release-identity: |\n    ASTRA_RELEASE_BUILD = "' + build + '"\n    DISTRO_VERSION = "' + version['version'] + '"\n'
    if args.ci:
        configuration += '\n  astra-ci-resources: |\n' + ''.join('    ' + line + '\n' for line in (repo / 'config/astra-ci.conf').read_text().splitlines())
    inputs = {str(file.relative_to(stage)): sha(file) for file in sorted(stage.rglob('*')) if file.is_file()}
    record = {'version': version['version'], 'build': build, 'upstream': commit, 'inputs': inputs}
    record['configurationSha256'] = hashlib.sha256(configuration.encode()).hexdigest()
    record['standardRunnerProfile'] = args.ci
    (repo / '.local/release-build.json').write_text(json.dumps(record, indent=2) + '\n')
(upstream / 'kas/astra-image.yml').write_text(configuration)
env = os.environ.copy()
env['PATH'] = str(repo / '.local/build-venv/bin') + os.pathsep + env['PATH']
env['KAS_CONTAINER_ENGINE'] = 'docker'
env['KAS_CONTAINER_IMAGE'] = profile['kas_container_image']
command = ['kas-container']
if platform.system() == 'Darwin':
    env['PATH'] = str(upstream / 'scripts/macos-shims') + os.pathsep + env['PATH']
    env['KAS_BUILD_DIR'] = ''
    volume = profile['docker_volume']
    if subprocess.run(['docker', 'volume', 'inspect', volume], stdout=subprocess.DEVNULL).returncode:
        subprocess.run(['docker', 'volume', 'create', volume], check=True)
    command += ['--runtime-args',
                f'-e KAS_DOCKER_ROOTLESS=1 -e KAS_BUILD_DIR=/build/build -v {volume}:/build']
command += ['build', 'kas/astra-image.yml']
subprocess.run(command, cwd=upstream, env=env, check=True)
if platform.system() == 'Darwin':
    # Pass the volume explicitly: upstream's nested `just pull-deploy` loses
    # its caller's --set override and otherwise reads the default volume.
    subprocess.run(['just', '--set', 'build_vol', volume, 'pull-deploy'],
                   cwd=upstream, env=env, check=True)
