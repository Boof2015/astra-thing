// SPDX-License-Identifier: GPL-3.0-only
'use strict';
const {spawnSync} = require('node:child_process');
const path = require('node:path');

// Windows commonly supplies py.exe rather than python3. Never pass arguments
// through a shell: release paths may contain spaces or shell metacharacters.
function main() {
  const args = process.argv.slice(2);
  if (!args.length) throw Error('A Python script or module is required.');
  const isFirmware = args[0].replaceAll('\\', '/').endsWith('scripts/build-astra-image.py');
  if (isFirmware && process.platform === 'win32') throw Error('Build firmware inside WSL2/Linux with Docker and the pinned BSP, or on macOS. The Windows manager builds natively with npm run build:windows. See docs/image-build.md.');
  const candidates = process.platform === 'win32' ? [['py', '-3'], ['python'], ['python3']] : [['python3'], ['python']];
  for (const [command, ...prefix] of candidates) {
    const probe = spawnSync(command, [...prefix, '-c', 'import sys; sys.exit(0 if sys.version_info >= (3, 11) else 1)'], {stdio: 'ignore'});
    if (probe.error || probe.status !== 0) continue;
    const result = spawnSync(command, [...prefix, ...args], {cwd: path.resolve(__dirname, '..'), stdio: 'inherit'});
    if (result.error) throw result.error;
    process.exitCode = result.status ?? 1;
    return;
  }
  throw Error('Python 3.11 or newer was not found. Install Python and add it to PATH (or install the Windows py launcher).');
}
try {main();} catch (error) {console.error(error.message); process.exitCode = 1;}
