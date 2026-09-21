// SPDX-License-Identifier: GPL-3.0-only
const {spawnSync} = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const {buildTarget} = require('./build.cjs');
try {buildTarget();} catch (error) {console.error(error.message); process.exit(1);}
const target = {
  darwin: {arm64: 'aarch64-apple-darwin', x64: 'x86_64-apple-darwin'},
  win32: {arm64: 'aarch64-pc-windows-msvc', x64: 'x86_64-pc-windows-msvc'},
  linux: {arm64: 'aarch64-unknown-linux-gnu', x64: 'x86_64-unknown-linux-gnu'}
}[process.platform][process.arch];
const targetDir = path.join(root, 'native', 'target');
const result = spawnSync('cargo', ['build', '--release', '--locked', '--target', target, '--target-dir', targetDir,
  '--manifest-path', path.join(root, 'native', 'Cargo.toml')], {stdio: 'inherit'});
if (result.error || result.status !== 0) {
  console.error(result.error?.code === 'ENOENT'
    ? 'Cargo was not found. Install Rust and the native C build tools; see manager/README.md.'
    : `Worker build failed for ${target}. Check Rust target support and the native C build tools.`);
  process.exit(result.status || 1);
}
const name = 'astra-thing-worker' + (process.platform === 'win32' ? '.exe' : '');
fs.mkdirSync(path.join(root, 'resources', 'worker'), {recursive: true});
fs.copyFileSync(path.join(targetDir, target, 'release', name), path.join(root, 'resources', 'worker', name));
fs.chmodSync(path.join(root, 'resources', 'worker', name), 0o755);
