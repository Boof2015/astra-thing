import contextlib
import importlib.util
import io
import json
import os
from pathlib import Path
import shutil
import tempfile
import time
import unittest
from unittest.mock import patch


spec = importlib.util.spec_from_file_location('firmware_ci', Path(__file__).resolve().parents[1] / 'scripts/firmware-ci.py')
ci = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ci)


class FirmwareDiagnosticsTests(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.root = Path(directory.name)
        self.upstream = self.root / '.local/yocto-superbird'
        self.reports = self.root / 'reports'
        self.reports.mkdir()
        replacements = patch.multiple(ci, ROOT=self.root, UPSTREAM=self.upstream, REPORTS=self.reports)
        replacements.start()
        self.addCleanup(replacements.stop)

    def compile_log(self):
        path = self.upstream / 'build/tmp/work/cortexa53-poky-linux/chromium-ozone-wayland/147-r0/temp/log.do_compile.123'
        path.parent.mkdir(parents=True)
        return path

    def test_progress_follows_growing_logs_and_survives_rm_work(self):
        log = self.compile_log()
        log.write_text('Starting ninja\n[21/500] clang++ first.cc\r[22/500] clang++ second.cc\n')
        os.utime(log, (time.time() - 90, time.time() - 90))
        progress = ci.chromium_progress()
        self.assertEqual((progress['completed'], progress['total']), (22, 500))
        self.assertGreaterEqual(progress['secondsSinceOutput'], 89)
        with log.open('a') as output:
            output.write('[25/500] clang++ third.cc\n')
        progress = ci.chromium_progress()
        self.assertEqual(progress['completed'], 25)
        self.assertLess(progress['secondsSinceOutput'], 2)
        shutil.rmtree(log.parent)
        self.assertIsNone(ci.chromium_progress())
        saved = json.loads((self.reports / 'chromium-progress.json').read_text())
        self.assertEqual(saved['completed'], 25)
        self.assertIn('third.cc', (self.reports / 'chromium-compile.tail.log').read_text())

    def test_large_verbose_log_is_bounded_and_latest_progress_is_retained(self):
        log = self.compile_log()
        log.write_bytes(b'very long compiler command\n' * 100000 + b'[430/500] clang++ latest.cc\n')
        progress = ci.chromium_progress()
        self.assertEqual(progress['completed'], 430)
        self.assertLessEqual((self.reports / 'chromium-compile.tail.log').stat().st_size, ci.LOG_TAIL_BYTES)

    def test_sampler_measures_cpu_delta_without_double_counting_guest_ticks(self):
        proc = self.root / 'proc'
        proc.mkdir()
        (proc / 'meminfo').write_text('MemTotal: 16000 kB\nMemAvailable: 10000 kB\nSwapTotal: 3000 kB\nSwapFree: 2500 kB\n')
        (proc / 'loadavg').write_text('3.75 3.50 3.25 4/500 123\n')
        (proc / 'stat').write_text('cpu 100 10 20 200 5 2 3 10 50 5\ncpu0 0\n')
        first = ci.sample(time.monotonic(), proc)
        self.assertEqual(first['cpuTotalTicks'], 350)
        self.assertEqual(first['memoryAvailableBytes'], 10000 * 1024)
        (proc / 'stat').write_text('cpu 150 10 30 220 10 2 3 25 70 5\n')
        second = ci.sample(time.monotonic(), proc)
        self.assertEqual(ci.cpu_usage(second, first), {'cpuBusyPercent': 60.0, 'cpuIowaitPercent': 5.0, 'cpuStealPercent': 15.0})
        self.assertEqual(ci.cpu_usage(first, None), {})

    def test_separate_collector_recovers_timeout_with_truncated_sample(self):
        log = self.compile_log()
        log.write_text('[800/1000] clang++ still-building.cc\n')
        record = self.root / '.local/release-build.json'
        record.write_text('{"build":"20261027120000"}\n')
        ci.write_json(self.reports / 'status.json', {'stage': 'build', 'result': 'running'})
        sample = {'elapsedSeconds': 60, 'diskFreeBytes': 100, 'memoryAvailableBytes': 50,
                  'swapTotalBytes': 30, 'swapFreeBytes': 30}
        later = dict(sample, elapsedSeconds=90, diskFreeBytes=90, memoryAvailableBytes=45, swapFreeBytes=25)
        (self.reports / 'resources.jsonl').write_text(json.dumps(sample) + '\n' + json.dumps(later) + '\n{"elapsedSec')
        with patch.object(ci.subprocess, 'check_output', return_value='PID PPID STAT %CPU RSS COMMAND\n123 1 R 90 100 clang++\n'), \
                patch.dict(os.environ, {'GITHUB_STEP_SUMMARY': str(self.root / 'summary.md')}), \
                contextlib.redirect_stdout(io.StringIO()):
            summary = ci.collect_diagnostics('failure')
        self.assertEqual(summary['result'], 'failure')
        self.assertEqual(summary['lastStage'], 'build')
        self.assertEqual(summary['sampleCount'], 2)
        self.assertEqual(summary['minimumDiskFreeBytes'], 90)
        self.assertEqual(summary['maximumSwapUsedBytes'], 5)
        self.assertEqual(summary['lastChromiumProgress']['completed'], 800)
        self.assertEqual((self.reports / 'build-inputs.json').read_text(), record.read_text())
        self.assertIn('800/1000', (self.root / 'summary.md').read_text())

    def test_collector_handles_failure_before_build_started(self):
        with patch.object(ci.subprocess, 'check_output', return_value='PID\n'), \
                patch.dict(os.environ, {'GITHUB_STEP_SUMMARY': ''}), contextlib.redirect_stdout(io.StringIO()):
            summary = ci.collect_diagnostics('skipped')
        self.assertEqual(summary['sampleCount'], 0)
        self.assertEqual(summary['lastStage'], 'setup')
        self.assertTrue((self.reports / 'summary.json').exists())


if __name__ == '__main__':
    unittest.main()
