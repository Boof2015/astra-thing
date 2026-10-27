#!/usr/bin/env python3
"""Manually dispatched standard-runner experiment. Builds/audits; never signs, publishes or flashes."""
# SPDX-License-Identifier: GPL-3.0-only
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
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
LOG_TAIL_BYTES = 512 * 1024
NINJA_PROGRESS = re.compile(r'(?:^|[\r\n])\[(\d+)/(\d+)\]\s+([^\r\n]*)')


def write_json(path, value):
    temporary = path.with_suffix(path.suffix + '.tmp')
    temporary.write_text(json.dumps(value, indent=2) + '\n')
    temporary.replace(path)


def read_tail(path):
    # Ninja -v emits very long compiler commands. Bound both memory and artifact size.
    with path.open('rb') as source:
        size = os.fstat(source.fileno()).st_size
        offset = max(0, size - LOG_TAIL_BYTES)
        source.seek(offset)
        data = source.read(LOG_TAIL_BYTES)
    if offset:
        data = data.partition(b'\n')[2]
    return data.decode('utf-8', errors='replace')


def sample(start, proc=Path('/proc')):
    memory = {line.split(':')[0]: int(line.split()[1]) * 1024 for line in (proc / 'meminfo').read_text().splitlines()}
    # Guest ticks are already included in user/nice; do not count them twice.
    cpu = list(map(int, (proc / 'stat').read_text().splitlines()[0].split()[1:9]))
    return {'elapsedSeconds': round(time.monotonic() - start),
            'diskFreeBytes': shutil.disk_usage(ROOT).free,
            'memoryTotalBytes': memory['MemTotal'], 'memoryAvailableBytes': memory['MemAvailable'],
            'swapTotalBytes': memory['SwapTotal'], 'swapFreeBytes': memory['SwapFree'],
            'cpuTotalTicks': sum(cpu), 'cpuIdleTicks': cpu[3], 'cpuIowaitTicks': cpu[4],
            'cpuStealTicks': cpu[7], 'logicalCpus': os.cpu_count(),
            'loadAverage': list(map(float, (proc / 'loadavg').read_text().split()[:3]))}


def cpu_usage(current, previous):
    if not previous:
        return {}
    total = current['cpuTotalTicks'] - previous['cpuTotalTicks']
    if total <= 0:
        return {}
    def percent(key):
        return max(0, min(100, 100 * (current[key] - previous[key]) / total))
    idle, waiting, stolen = (percent(key) for key in ('cpuIdleTicks', 'cpuIowaitTicks', 'cpuStealTicks'))
    return {'cpuBusyPercent': round(max(0, 100 - idle - waiting - stolen), 1),
            'cpuIowaitPercent': round(waiting, 1), 'cpuStealPercent': round(stolen, 1)}


def chromium_progress():
    candidates = []
    for path in (UPSTREAM / 'build/tmp/work').glob('*/chromium-ozone-wayland/*/temp/log.do_compile*'):
        try:
            candidates.append((path.stat().st_mtime, path))
        except FileNotFoundError:
            pass  # rm_work can remove a completed recipe between samples.
    if not candidates:
        return None
    _, path = max(candidates)
    try:
        tail = read_tail(path)
        stat = path.stat()
    except FileNotFoundError:
        return None
    progress = {'source': str(path.relative_to(UPSTREAM)), 'logBytes': stat.st_size,
                'secondsSinceOutput': round(max(0, time.time() - stat.st_mtime))}
    matches = list(NINJA_PROGRESS.finditer(tail))
    if matches:
        latest = matches[-1]
        progress.update(completed=int(latest[1]), total=int(latest[2]), command=latest[3][:240])
    (REPORTS / 'chromium-compile.tail.log').write_text(tail)
    write_json(REPORTS / 'chromium-progress.json', progress)
    return progress


def snapshot_logs():
    progress = chromium_progress()
    record = ROOT / '.local/release-build.json'
    if record.exists():
        shutil.copyfile(record, REPORTS / 'build-inputs.json')
    cooker = UPSTREAM / 'build/tmp/log/cooker'
    for path in cooker.glob('*/*.log'):
        destination = REPORTS / 'cooker' / path.relative_to(cooker)
        destination.parent.mkdir(parents=True, exist_ok=True)
        try:
            destination.write_text(read_tail(path))
        except FileNotFoundError:
            pass
    # No command-line arguments or environment variables: just resource/process state.
    try:
        processes = subprocess.check_output(['ps', '-eo', 'pid,ppid,stat,pcpu,rss,comm', '--sort=-pcpu'],
                                            text=True, stderr=subprocess.STDOUT, timeout=3)
        (REPORTS / 'processes.txt').write_text('\n'.join(processes.splitlines()[:21]) + '\n')
    except (OSError, subprocess.SubprocessError) as error:
        print(f'[diagnostics] Process snapshot unavailable: {error}', flush=True)
    return progress


def progress_message(current):
    gib = 1024**3
    cpu = (f"{current['cpuBusyPercent']:.0f}% busy, {current['cpuIowaitPercent']:.0f}% I/O wait, "
           f"{current['cpuStealPercent']:.0f}% stolen" if 'cpuBusyPercent' in current else 'sampling')
    message = (f"[firmware {current['elapsedSeconds'] / 60:.1f}m / {current['stage']}] "
               f"CPU {cpu} ({current['logicalCpus']} CPUs), load {current['loadAverage'][0]:.2f}; "
               f"RAM available {current['memoryAvailableBytes'] / gib:.1f} GiB; "
               f"swap used {(current['swapTotalBytes'] - current['swapFreeBytes']) / gib:.1f} GiB; "
               f"disk free {current['diskFreeBytes'] / gib:.1f} GiB")
    progress = current.get('chromium')
    if progress:
        counts = f"{progress['completed']}/{progress['total']} steps" if 'completed' in progress else 'starting'
        message += (f"\n[chromium] {counts}; log {progress['logBytes'] / 1024**2:.1f} MiB; "
                    f"last output {progress['secondsSinceOutput']}s ago")
        if progress.get('command'):
            message += '\n[chromium] ' + progress['command']
    elif current['stage'] == 'build':
        message += '\n[chromium] No compile log present (not started or work directory cleaned).'
    return message


def collect_diagnostics(outcome):
    """Also callable as a separate Actions step after a hard timeout kills Python."""
    REPORTS.mkdir(parents=True, exist_ok=True)
    snapshot_logs()
    samples = []
    resources = REPORTS / 'resources.jsonl'
    if resources.exists():
        for line in resources.read_text().splitlines():
            try:
                samples.append(json.loads(line))
            except json.JSONDecodeError:
                pass  # A hard kill can leave the last sample incomplete.
    status = REPORTS / 'status.json'
    status = json.loads(status.read_text()) if status.exists() else {}
    summary = {'result': 'passed' if outcome == 'success' else outcome,
               'lastStage': status.get('stage', 'setup'), 'sampleCount': len(samples)}
    if samples:
        summary.update(elapsedSeconds=samples[-1]['elapsedSeconds'],
                       minimumDiskFreeBytes=min(s['diskFreeBytes'] for s in samples),
                       minimumMemoryAvailableBytes=min(s['memoryAvailableBytes'] for s in samples),
                       maximumSwapUsedBytes=max(s['swapTotalBytes'] - s['swapFreeBytes'] for s in samples),
                       firstSample=samples[0], lastSample=samples[-1])
    chromium = REPORTS / 'chromium-progress.json'
    if chromium.exists():
        summary['lastChromiumProgress'] = json.loads(chromium.read_text())
    write_json(REPORTS / 'summary.json', summary)
    text = (f"## Standard-runner firmware experiment: {summary['result']}\n\n"
            f"Last stage: **{summary['lastStage']}**. Resource samples: {len(samples)}.\n")
    if samples:
        text += (f"\nObserved duration: {summary['elapsedSeconds'] / 60:.1f} minutes. "
                 f"Minimum free disk: {summary['minimumDiskFreeBytes'] / 1024**3:.1f} GiB. "
                 f"Minimum available RAM: {summary['minimumMemoryAvailableBytes'] / 1024**3:.1f} GiB. "
                 f"Peak swap used: {summary['maximumSwapUsedBytes'] / 1024**3:.1f} GiB.\n")
    progress = summary.get('lastChromiumProgress', {})
    if 'completed' in progress:
        text += f"\nLast captured Chromium progress: **{progress['completed']}/{progress['total']} Ninja steps** (not an estimate of time remaining).\n"
    text += '\nDiagnostics include compiler log tails, process snapshots and CPU/memory/disk samples. Successful images are unsigned; nothing is published or flashed.\n'
    if os.environ.get('GITHUB_STEP_SUMMARY'):
        with open(os.environ['GITHUB_STEP_SUMMARY'], 'a') as output:
            output.write(text)
    print(text, flush=True)
    return summary


def main():
    if sys.platform != 'linux' or os.environ.get('GITHUB_ACTIONS') != 'true' or os.environ.get('RUNNER_ENVIRONMENT') != 'github-hosted':
        raise SystemExit('This experiment runs only on a disposable GitHub-hosted Linux runner')
    REPORTS.mkdir(parents=True, exist_ok=True)
    if UPSTREAM.exists():
        raise SystemExit('Expected a fresh checkout with no existing Yocto build tree')
    profile = json.loads((ROOT / 'config/bringup-toolchain.json').read_text())
    start, stop = time.monotonic(), threading.Event()
    child = None
    stage, result = 'setup', 'failed'
    def set_stage(value):
        nonlocal stage
        stage = value
        write_json(REPORTS / 'status.json', {'stage': stage, 'result': 'running'})
    set_stage('setup')
    def interrupted(signum, frame):
        if child and child.poll() is None:
            try:
                os.killpg(child.pid, signal.SIGTERM)
            except ProcessLookupError:
                pass
        raise RuntimeError(f'Firmware experiment interrupted by {signal.Signals(signum).name}')
    signal.signal(signal.SIGINT, interrupted)
    signal.signal(signal.SIGTERM, interrupted)
    def monitor():
        previous, next_log = None, 0
        with (REPORTS / 'resources.jsonl').open('w', buffering=1) as output, (REPORTS / 'progress.log').open('w', buffering=1) as progress_log:
            while True:
                try:
                    current = sample(start)
                    current.update(cpu_usage(current, previous))
                    current['stage'] = stage
                    emit = current['elapsedSeconds'] >= next_log
                    current['chromium'] = snapshot_logs() if emit else chromium_progress()
                    output.write(json.dumps(current) + '\n')
                    if emit:
                        message = progress_message(current)
                        print(message, flush=True)
                        progress_log.write(message + '\n')
                        next_log = current['elapsedSeconds'] + 60
                    previous = current
                except (OSError, ValueError) as error:
                    message = f'[diagnostics] Sample unavailable; retrying next interval: {error}'
                    print(message, flush=True)
                    progress_log.write(message + '\n')
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
                child = subprocess.Popen(list(map(str, args)), cwd=cwd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                         text=True, errors='replace', start_new_session=True)
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
            set_stage('build')
            run([sys.executable, ROOT / 'scripts/build-astra-image.py', '--release', '--ci'])
            set_stage('audit')
            deploy = UPSTREAM / 'build/tmp/deploy/images/superbird'
            flash, update = deploy / 'astra-thing-image-superbird-flashthing.zip', deploy / 'astra-thing-update-superbird.swu'
            record = ROOT / '.local/release-build.json'
            run([sys.executable, ROOT / 'scripts/verify-release-images.py', flash, update, record, '--audit', '--report', REPORTS / 'firmware-audit.json'])
            set_stage('package')
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
        write_json(REPORTS / 'status.json', {'stage': stage, 'result': result})
        # This is best effort. The independent always() step can collect even if
        # Actions kills this process before its cleanup finishes.
        snapshot_logs()


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--collect-diagnostics', action='store_true')
    parser.add_argument('--outcome', choices=('success', 'failure', 'cancelled', 'skipped', ''), default='failure')
    arguments = parser.parse_args()
    if arguments.collect_diagnostics:
        collect_diagnostics(arguments.outcome or 'skipped')
    else:
        main()
