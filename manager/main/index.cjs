// SPDX-License-Identifier: GPL-3.0-only
'use strict';
const {app, BrowserWindow, ipcMain, dialog, safeStorage, powerSaveBlocker} = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const {pathToFileURL} = require('node:url');
const {Controller} = require('./controller.cjs');
app.setName('Astra Thing Manager');
let window, controller, blocker;
if (!app.requestSingleInstanceLock()) app.quit();
else app.whenReady().then(async () => {
  const directory = app.getPath('userData');
  const root = path.resolve(__dirname, '..');
  const resource = app.isPackaged ? process.resourcesPath : root;
  const binary = path.join(resource, app.isPackaged ? 'worker' : 'resources/worker', 'astra-thing-worker' + (process.platform === 'win32' ? '.exe' : ''));
  const trust = JSON.parse(await fs.readFile(app.isPackaged ? path.join(resource, 'trusted-keys.json') : path.join(root, '../release/trusted-keys.json'), 'utf8'));
  const filename = path.join(directory, 'managers.json');
  const secureStore = {
    async load() {try {const record = JSON.parse(await fs.readFile(filename, 'utf8')); return JSON.parse(record.encrypted ? safeStorage.decryptString(Buffer.from(record.data, 'base64')) : record.data);} catch (error) {if (error.code === 'ENOENT') return {}; throw error;}},
    async save(value) {
      const encrypted = safeStorage.isEncryptionAvailable() && (process.platform !== 'linux' || safeStorage.getSelectedStorageBackend() !== 'basic_text');
      const text = JSON.stringify(value), data = encrypted ? safeStorage.encryptString(text).toString('base64') : text;
      await fs.writeFile(filename + '.new', JSON.stringify({encrypted, data}), {mode: 0o600}); await fs.rename(filename + '.new', filename);
    }
  };
  const choose = async options => {const result = await dialog.showOpenDialog(window, options); return result.canceled ? null : result.filePaths[0];};
  controller = new Controller({directory, binary, trust, version: app.getVersion(), secureStore, dialogs: {
    release: () => choose({title: 'Choose the signed Astra Thing release', properties: ['openFile'], filters: [{name: 'Signed release', extensions: ['json']}]}),
    folder: () => choose({title: 'Keep your Car Thing backup here', properties: ['openDirectory', 'createDirectory']}),
    diagnostics: async () => {const result = await dialog.showSaveDialog(window, {defaultPath: 'astra-thing-diagnostics.json'}); return result.canceled ? null : result.filePath;},
    restart: async () => (await dialog.showMessageBox(window, {type: 'question', message: 'Restart your Thing?', detail: 'Your pairing and settings will be kept.', buttons: ['Cancel', 'Restart'], defaultId: 0, cancelId: 0})).response === 1
  }});
  window = new BrowserWindow({width: 1160, height: 840, minWidth: 700, minHeight: 620, backgroundColor: '#0f0f0f', title: 'Astra Thing Manager', autoHideMenuBar: true, webPreferences: {preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false, webSecurity: true}});
  const renderer = path.join(root, 'renderer/index.html'), expected = pathToFileURL(renderer).href;
  window.webContents.setWindowOpenHandler(() => ({action: 'deny'}));
  window.webContents.on('will-navigate', event => event.preventDefault());
  window.webContents.session.setPermissionRequestHandler((_, __, callback) => callback(false));
  window.webContents.session.setPermissionCheckHandler(() => false);
  const authorized = event => event.sender === window.webContents && event.senderFrame === window.webContents.mainFrame && event.senderFrame.url === expected;
  ipcMain.handle('thing:snapshot', event => {if (!authorized(event)) throw Error('Untrusted request'); return controller.state;});
  ipcMain.handle('thing:action', async (event, action, id) => {
    if (!authorized(event) || typeof action !== 'string' || action.length > 40 || id !== undefined && (typeof id !== 'string' || id.length > 100)) throw Error('Invalid request');
    try {await controller.action(action, id); return {ok: true};} catch (error) {controller.publish({error: error.message}); return {ok: false};}
  });
  controller.on('state', state => {
    if (!window.isDestroyed()) window.webContents.send('thing:state', state);
    const busy = state.busy || ['updateRestart', 'reboot'].includes(state.step);
    if (busy && blocker === undefined) blocker = powerSaveBlocker.start('prevent-app-suspension');
    if (!busy && blocker !== undefined) {powerSaveBlocker.stop(blocker); blocker = undefined;}
  });
  window.on('close', event => {if (controller.state.busy) {event.preventDefault(); dialog.showMessageBox(window, {message: 'Wait for this operation to finish.', detail: 'Keep the manager open and your Thing connected while files are being transferred or written.'});}});
  await window.loadFile(renderer);
  await controller.start();
}).catch(error => {dialog.showErrorBox('Astra Thing Manager could not start', error.message); app.quit();});
app.on('window-all-closed', () => app.quit());
app.on('before-quit', () => {if (!controller?.state.busy) controller?.close();});
app.on('second-instance', () => {if (window) {if (window.isMinimized()) window.restore(); window.focus();}});
