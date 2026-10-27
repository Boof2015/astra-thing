#!/usr/bin/env python3
"""Manually dispatched standard-runner experiment. Builds/audits; never signs, publishes or flashes."""
# SPDX-License-Identifier: GPL-3.0-only
import hashlib
import json
import os
from pathlib import Path
import shutil
import signal
import subprocess
import sys
import threading
import time

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / 'release-output/firmware-ci'
REPORTS = OUTPUT / 'reports'
UPSTREAM = ROOT / '.local/yocto-superbird'


def sample(start):
    memory = {line.split(':')[0]: int(line.split()[1]) * 1024 for line in Path('/proc/meminfo').read_text().splitlines()}
    return {'elapsedSeconds': round(time.monotonic() - start),
            'diskFreeBytes': shutil.disk_usage(ROOT).free,
            'memoryTotalBytes': memory['MemTotal'], 'memoryAvailableBytes': memory['MemAvailable'],
            'swapTotalBytes': memory['SwapTotal'], 'swapFreeBytes': memory['SwapFree']}


def main():
    if sys.platform != 'linux' or os.environ.get('GITHUB_ACTIONS') != 'true' or os.environ.get('RUNNER_ENVIRONMENT') != 'github-hosted':
        raise SystemExit('This experiment runs only on a disposable GitHub-hosted Linux runner')
    REPORTS.mkdir(parents=True, exist_ok=True)
    if UPSTREAM.exists():
        raise SystemExit('Expected a fresh checkout with no existing Yocto build tree')
    profile = json.loads((ROOT / 'config/bringup-toolchain.json').read_text())
    start, stop, samples = time.monotonic(), threading.Event(), []
    child = None
    stage, result = 'setup', 'failed'
    def interrupted(signum, frame):
        if child and child.poll() is None:
            child.send_signal(signal.SIGTERM)
        raise RuntimeError('Firmware experiment interrupted')
    signal.signal(signal.SIGTERM, interrupted)
    def monitor():
        with (REPORTS / 'resources.jsonl').open('w') as output:
            while True:
                current = sample(start)
                samples.append(current)
                output.write(json.dumps(current) + '\n')
                output.flush()
                if stop.wait(30):
                    break
    thread = threading.Thread(target=monitor, daemon=True)
    thread.start()
    try:
        with (REPORTS / 'build.log').open('w', buffering=1) as log:
            def run(args, cwd=ROOT):
                nonlocal child
                message = '+ ' + ' '.join(map(str, args))
                print(message, flush=True)
                log.write(message + '\n')
                child = subprocess.Popen(list(map(str, args)), cwd=cwd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, errors='replace')
                for line in child.stdout:
                    print(line, end='', flush=True)
                    log.write(line)
                code = child.wait()
                if code:
                    raise subprocess.CalledProcessError(code, args)
            UPSTREAM.parent.mkdir(parents=True, exist_ok=True)
            run(['git', 'init', UPSTREAM])
            run(['git', 'remote', 'add', 'origin', profile['yocto_superbird_url']], cwd=UPSTREAM)
            run(['git', 'fetch', '--depth', '1', 'origin', profile['yocto_superbird_commit']], cwd=UPSTREAM)
            run(['git', 'checkout', '--detach', 'FETCH_HEAD'], cwd=UPSTREAM)
            venv = ROOT / '.local/build-venv'
            run([sys.executable, '-m', 'venv', venv])
            run([venv / 'bin/python', '-m', 'pip', 'install', 'kas==' + profile['kas_version']])
            stage = 'build'
            run([sys.executable, ROOT / 'scripts/build-astra-image.py', '--release', '--ci'])
            stage = 'audit'
            deploy = UPSTREAM / 'build/tmp/deploy/images/superbird'
            flash, update = deploy / 'astra-thing-image-superbird-flashthing.zip', deploy / 'astra-thing-update-superbird.swu'
            record = ROOT / '.local/release-build.json'
            run([sys.executable, ROOT / 'scripts/verify-release-images.py', flash, update, record, '--audit', '--report', REPORTS / 'firmware-audit.json'])
            stage = 'package'
            packages = OUTPUT / 'packages'
            packages.mkdir()
            build = json.loads(record.read_text())
            prefix = 'astra-thing-' + build['version'] + '-' + build['build']
            for source, name in [(flash, prefix + '.zip'), (update, prefix + '.swu'), (record, 'build-inputs.json'), (REPORTS / 'firmware-audit.json', 'firmware-audit.json')]:
                shutil.copyfile(source, packages / name)
            run([sys.executable, ROOT / 'scripts/package-sources.py', packages / 'project-sources.tar.gz', '--build-record', record])
            commit = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip()
            (packages / 'provenance.json').write_text(json.dumps({'schema': 1, 'commit': commit, 'version': build['version'], 'build': build['build'], 'signed': False}, indent=2) + '\n')
            (packages / 'README.txt').write_text('Unsigned CI experiment. Not a Manager-installable release. Image contents were audited, but no hardware boot was tested. Sign a candidate locally with the existing trusted publisher key after reviewing the reports.\n')
            with (packages / 'SHA256SUMS').open('w') as sums:
                for file in sorted(packages.iterdir()):
                    if file.name != 'SHA256SUMS':
                        with file.open('rb') as source:
                            sums.write(hashlib.file_digest(source, 'sha256').hexdigest() + '  ' + file.name + '\n')
            result = 'passed'
    finally:
        stop.set()
        thread.join(timeout=5)
        samples.append(sample(start))
        record = ROOT / '.local/release-build.json'
        if record.exists():
            shutil.copyfile(record, REPORTS / 'build-inputs.json')
        cooker = UPSTREAM / 'build/tmp/log/cooker'
        if cooker.exists():
            shutil.copytree(cooker, REPORTS / 'cooker', symlinks=True, dirs_exist_ok=True)
        summary = {'result': result, 'lastStage': stage, 'elapsedSeconds': round(time.monotonic() - start),
                   'minimumDiskFreeBytes': min(s['diskFreeBytes'] for s in samples),
                   'minimumMemoryAvailableBytes': min(s['memoryAvailableBytes'] for s in samples),
                   'maximumSwapUsedBytes': max(s['swapTotalBytes'] - s['swapFreeBytes'] for s in samples),
                   'firstSample': samples[0], 'lastSample': samples[-1]}
        (REPORTS / 'summary.json').write_text(json.dumps(summary, indent=2) + '\n')
        text = f"## Standard-runner firmware experiment: {result}\n\nLast stage: **{stage}**. Elapsed: {summary['elapsedSeconds'] / 60:.1f} minutes.\n\nMinimum free disk: {summary['minimumDiskFreeBytes'] / 1024**3:.1f} GiB. Minimum available RAM: {summary['minimumMemoryAvailableBytes'] / 1024**3:.1f} GiB. Peak swap used: {summary['maximumSwapUsedBytes'] / 1024**3:.1f} GiB.\n\nBuild log, cache-hit summaries and resource samples are in the diagnostics artifact. Successful image files are unsigned artifacts; nothing is published or flashed.\n"
        if os.environ.get('GITHUB_STEP_SUMMARY'):
            with open(os.environ['GITHUB_STEP_SUMMARY'], 'a') as output:
                output.write(text)
        print(text, flush=True)


if __name__ == '__main__':
    main()
