// SPDX-License-Identifier: GPL-3.0-only
// Shows every manager screen with sample data and no device, worker or network access.
// Jump with the Screens menu, or step with CmdOrCtrl+] and CmdOrCtrl+[.
'use strict';
const path = require('node:path');
if (!process.versions.electron) {
  const {spawn} = require('node:child_process');
  const env = {...process.env}; delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(require('electron'), [__filename, ...process.argv.slice(2)], {env, stdio: 'inherit'});
  child.on('error', error => {console.error(error.message); process.exitCode = 1;});
  child.on('exit', code => {process.exitCode = code ?? 1;});
} else {
  const {app, BrowserWindow, ipcMain, Menu} = require('electron');
  const root = path.resolve(__dirname, '..');
  const folder = path.join(app.getPath('documents'), 'Astra Thing backups');
  const devices = [{id: '20-1.4', mode: 'stock', name: 'Car Thing'}, {id: '9f2c4e71a0b35d86c1e47f09ab2d63c5', mode: 'astra', name: 'Astra Thing'}];
  const screens = [
    ['First install', [
      ['Connect', {step: 'connect'}],
      ['Choose a device', {step: 'choose', device: 'stock', devices}],
      ['Car Thing connected', {step: 'welcome', device: 'stock'}],
      ['Unplug', {step: 'unplug', device: 'stock'}],
      ['Hold 1 + 4', {step: 'hold'}],
      ['Recovery found', {step: 'recoveryReady', device: 'recovery'}],
      ['Backup folder', {step: 'backupChoice', device: 'recovery', folder}],
      ['Backup progress', {step: 'backupProgress', device: 'recovery', folder, busy: true, stage: 'Reading partitions', progress: 42}],
      ['Backup verified', {step: 'backupReady', device: 'recovery', backup: true, backupFolder: path.join(folder, 'Car Thing 2026-10-25')}],
      ['Review', {step: 'review', device: 'recovery', backup: true, releaseVersion: '0.3.1'}],
      ['Install progress', {step: 'installProgress', device: 'recovery', backup: true, releaseVersion: '0.3.1', busy: true, stage: 'Writing system partition', progress: 67}],
      ['Reconnect', {step: 'reboot', device: 'recovery'}],
      ['Connect this computer', {step: 'authorize', device: 'astra'}],
      ['Pairing code', {step: 'pair', device: 'astra', code: '482913'}],
      ['Install complete', {step: 'done', device: 'astra'}]
    ]],
    ['Device manager', [
      ['My device', {step: 'manage', device: 'astra', version: '0.3.0'}],
      ['Up to date', {step: 'upToDate', device: 'astra', version: '0.3.0'}],
      ['Update review', {step: 'updateReview', device: 'astra', version: '0.3.0', releaseVersion: '0.3.1'}],
      ['Update progress', {step: 'updateProgress', device: 'astra', version: '0.3.0', releaseVersion: '0.3.1', busy: true, stage: 'Sending verified firmware', progress: 58}],
      ['Update restart', {step: 'updateRestart', stage: 'Installing firmware; waiting for a verified restart'}],
      ['Earlier firmware', {step: 'legacy', device: 'astra'}]
    ]],
    ['Problems', [
      ['Backup failed', {step: 'backupError', error: 'The USB connection was lost before the backup could be verified.'}],
      ['Operation interrupted', {step: 'error', error: 'The worker stopped before the write finished (exit code 1).'}],
      ['Unconfirmed operation', {step: 'recover', error: 'The previous operation has not been confirmed. Reconnect your Thing normally so we can check it.'}]
    ]]
  ];
  const list = screens.flatMap(([, items]) => items);
  // Buttons move to the screen the real controller would show next. Dialog-only actions do nothing.
  const next = {start: 'unplug', 'restart-guide': 'unplug', repair: 'hold', select: 'welcome', 'backup-choice': 'backupChoice', backup: 'backupProgress', review: 'review', install: 'installProgress', pair: 'pair', 'pair-cancel': 'authorize', manage: 'manage', 'check-release': 'updateReview', 'update-review': 'updateReview', update: 'updateProgress', recover: 'recover'};
  let window, index = 0, platform = process.platform, menu;
  const state = () => ({step: 'connect', device: 'none', devices: [], backup: false, folder: '', progress: null, stage: '', platform, version: '', releaseVersion: '', error: '', busy: false, ...list[index][1]});
  const show = i => {
    index = (i + list.length) % list.length;
    window.webContents.send('thing:state', state()); window.setTitle(`Preview · ${list[index][0]} (${index + 1}/${list.length})`);
    // Separators split radio groups, so the marks are kept in sync here.
    list.forEach((_, j) => {menu.getMenuItemById('screen-' + j).checked = j === index;});
  };
  const build = () => Menu.buildFromTemplate([
    ...process.platform === 'darwin' ? [{role: 'appMenu'}] : [],
    {label: 'Screens', submenu: [
      {label: 'Next screen', accelerator: 'CmdOrCtrl+]', click: () => show(index + 1)},
      {label: 'Previous screen', accelerator: 'CmdOrCtrl+[', click: () => show(index - 1)},
      ...screens.flatMap(([group, items]) => [{type: 'separator'}, {label: group, enabled: false}, ...items.map(([label]) => {const i = list.findIndex(entry => entry[0] === label); return {id: 'screen-' + i, label, type: 'checkbox', checked: i === index, click: () => show(i)};})])
    ]},
    {label: 'Platform', submenu: [['darwin', 'macOS'], ['win32', 'Windows'], ['linux', 'Linux']].map(([id, label]) => ({label, type: 'radio', checked: id === platform, click: () => {platform = id; show(index);}}))},
    {role: 'viewMenu'}
  ]);
  app.setName('Astra Thing Manager Preview');
  app.whenReady().then(async () => {
    menu = build(); Menu.setApplicationMenu(menu);
    window = new BrowserWindow({width: 1160, height: 840, minWidth: 700, minHeight: 620, backgroundColor: '#0f0f0f', webPreferences: {preload: path.join(root, 'main/preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false, webSecurity: true}});
    window.on('page-title-updated', event => event.preventDefault());
    ipcMain.handle('thing:snapshot', state);
    ipcMain.handle('thing:action', (_, action) => {const i = list.findIndex(([, patch]) => patch.step === next[action]); if (i >= 0) show(i); return {ok: true};});
    await window.loadFile(path.join(root, 'renderer/index.html'));
    show(index);
  });
  app.on('window-all-closed', () => app.quit());
}
