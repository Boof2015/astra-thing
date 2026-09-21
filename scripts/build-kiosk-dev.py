#!/usr/bin/env python3
"""Build the pinned upstream kiosk dev image; this never invokes the flasher."""
from pathlib import Path
import json
import os
import platform
import shutil
import subprocess

repo = Path(__file__).resolve().parent.parent
profile = json.loads((repo / 'config/bringup-toolchain.json').read_text())
upstream = repo / '.local/yocto-superbird'
commit = subprocess.check_output(['git', '-C', str(upstream), 'rev-parse', 'HEAD'], text=True).strip()
if commit != profile['yocto_superbird_commit']:
    raise SystemExit(f'Unexpected upstream revision: {commit}')
subprocess.run(['git', '-C', str(upstream), 'diff', '--exit-code', 'HEAD'], check=True)
shutil.copyfile(repo / 'config/kiosk-bringup.yml', upstream / 'kas/astra-bringup.yml')
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
command += ['build', 'kas/astra-bringup.yml']
subprocess.run(command, cwd=upstream, env=env, check=True)
if platform.system() == 'Darwin':
    # Pass the volume explicitly: upstream's nested `just pull-deploy` loses
    # its caller's --set override and otherwise reads the default volume.
    subprocess.run(['just', '--set', 'build_vol', volume, 'pull-deploy'],
                   cwd=upstream, env=env, check=True)
