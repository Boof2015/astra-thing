// SPDX-License-Identifier: GPL-3.0-only
'use strict';
const {spawnSync} = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

function buildTarget(requested, platform = process.platform, arch = process.arch) {
  const host = {darwin: 'mac', win32: 'win', linux: 'linux'}[platform];
  if (!host || !['x64', 'arm64'].includes(arch)) throw Error(`Unsupported build host: ${platform}/${arch}`);
  const target = requested || host;
  if (!['mac', 'win', 'linux'].includes(target)) throw Error('Expected build target: mac, win, or linux');
  if (target !== host) throw Error(`Build ${target} on that operating system so the native USB worker matches the installer. This host builds ${host}/${arch}.`);
  return {target, arch};
}

function main() {
  const args = process.argv.slice(2);
  if (args.length > 1) throw Error('Use build, build:mac, build:windows, or build:linux. Builds use the current Node architecture.');
  const {target, arch} = buildTarget(args[0]);
  const cwd = path.resolve(__dirname, '..');
  for (const name of ['LICENSE', 'LICENSES.chromium.html']) {
    if (!fs.existsSync(path.join(cwd, 'node_modules', 'electron', 'dist', name))) {
      throw Error('Electron runtime/license files are missing. Run npm install (or npm run postinstall from manager/) before building.');
    }
  }
  const run = args => {
    const result = spawnSync(process.execPath, args, {cwd, stdio: 'inherit'});
    if (result.error) throw result.error;
    if (result.status !== 0) process.exit(result.status || 1);
  };
  run([path.join(__dirname, 'build-worker.cjs')]);
  run([require.resolve('electron-builder/cli.js'), `--${target}`, `--${arch}`, '--publish', 'never']);
}

if (require.main === module) {
  try {main();} catch (error) {console.error(error.message); process.exitCode = 1;}
}
module.exports = {buildTarget};
