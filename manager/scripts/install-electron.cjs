// SPDX-License-Identifier: GPL-3.0-only
'use strict';
const {spawnSync} = require('node:child_process');
// Electron 42 ships an explicit installer rather than an npm postinstall.
// Pin the runtime to Node's host/architecture, also when Node runs under Rosetta,
// so development, installer notices and the USB worker use the same build.
const result = spawnSync(process.execPath, [require.resolve('electron/install.js')], {
  stdio: 'inherit', env: {...process.env, ELECTRON_INSTALL_PLATFORM: process.platform,
    ELECTRON_INSTALL_ARCH: process.arch, npm_config_arch: process.arch}
});
if (result.error) console.error(result.error.message);
process.exitCode = result.status ?? 1;
