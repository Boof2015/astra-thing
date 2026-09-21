// SPDX-License-Identifier: GPL-3.0-only
const {spawn} = require('node:child_process');
const path = require('node:path');
const env = {...process.env}; delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(require('electron'), [path.resolve(__dirname, '..'), ...process.argv.slice(2)], {env, stdio: 'inherit'});
child.on('error', error => {console.error(error.message); process.exitCode = 1;});
child.on('exit', code => {process.exitCode = code ?? 1;});
