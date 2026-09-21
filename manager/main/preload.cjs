// SPDX-License-Identifier: GPL-3.0-only
const {contextBridge, ipcRenderer} = require('electron');
contextBridge.exposeInMainWorld('thing', {
  snapshot: () => ipcRenderer.invoke('thing:snapshot'),
  action: (action, id) => ipcRenderer.invoke('thing:action', action, id),
  subscribe: callback => {const listener = (_, state) => callback(state); ipcRenderer.on('thing:state', listener); return () => ipcRenderer.removeListener('thing:state', listener);}
});
