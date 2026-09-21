// SPDX-License-Identifier: GPL-3.0-only
'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const {EventEmitter} = require('node:events');
const {startDiscovery, usbEndpoints} = require('./discovery.cjs');
const {runWorker} = require('./worker.cjs');
const release = require('./release.cjs');
const transport = require('./transport.cjs');
const download = require('./download.cjs');

function compareVersion(a, b) {
  const [av, ap] = a.split('-'), [bv, bp] = b.split('-');
  const aa = av.split('.').map(Number), bb = bv.split('.').map(Number);
  for (let i = 0; i < 3; i++) if (aa[i] !== bb[i]) return Math.sign(aa[i] - bb[i]);
  if (ap === bp) return 0;
  if (!ap || !bp) return !ap ? 1 : -1;
  const ai = ap.split('.'), bi = bp.split('.');
  for (let i = 0; i < Math.max(ai.length, bi.length); i++) {
    if (ai[i] === bi[i]) continue;
    if (ai[i] === undefined || bi[i] === undefined) return ai[i] === undefined ? -1 : 1;
    const an = /^\d+$/.test(ai[i]), bn = /^\d+$/.test(bi[i]);
    if (an && bn) return Math.sign(Number(ai[i]) - Number(bi[i]));
    if (an !== bn) return an ? -1 : 1;
    return ai[i] < bi[i] ? -1 : 1;
  }
  return 0;
}

function candidatesFor(normal, usb) {
  const ids = new Set(normal.map(d => d.id));
  return [...normal, ...usb.filter(d => d.mode !== 'astra' || !d.serial || !ids.has(crypto.createHash('sha256').update('astra-thing:' + d.serial).digest('hex').slice(0, 32)))];
}

class Controller extends EventEmitter {
  constructor({directory, binary, trust, version, dialogs, secureStore}) {
    super(); Object.assign(this, {directory, binary, trust, version, dialogs, secureStore});
    this.state = {step: 'connect', device: 'none', devices: [], backup: false, folder: '', progress: null, stage: '', platform: process.platform, version: '', releaseVersion: '', error: '', busy: false};
    this.endpoints = new Map(); this.usb = []; this.credentials = {}; this.running = true;
  }
  publish(patch = {}) {Object.assign(this.state, patch); this.emit('state', this.state);}
  async persist() {
    const record = {schema: 1, step: this.state.step, backup: this.backup, expected: this.expected, operation: this.operation};
    const temporary = path.join(this.directory, 'operation.new');
    await fs.writeFile(temporary, JSON.stringify(record), {mode: 0o600});
    await fs.rename(temporary, path.join(this.directory, 'operation.json'));
  }
  async start() {
    await fs.mkdir(this.directory, {recursive: true, mode: 0o700});
    try {this.credentials = await this.secureStore.load();} catch {this.publish({error: 'Saved management access could not be opened. Approve this computer again.'});}
    try {
      const record = JSON.parse(await fs.readFile(path.join(this.directory, 'operation.json'), 'utf8'));
      this.expected = record.expected; this.operation = record.operation;
      if (['backupProgress', 'installProgress', 'reboot', 'updateProgress', 'updateRestart'].includes(record.step)) this.publish({step: 'recover', error: 'The previous operation has not been confirmed. Reconnect your Thing normally so we can check it.'});
      // An old backup is retained on disk, but cannot authorize a new USB target/session.
    } catch (error) {if (error.code !== 'ENOENT') this.publish({step: 'recover', error: 'The previous operation record could not be read. Check the device before installing.'});}
    this.discovery = startDiscovery({onUp: (service, key) => this.discovered(service, key), onDown: key => this.endpoints.delete(key)});
    this.loop();
  }
  discovered(service, key = service.fqdn) {
    this.endpoints.delete(key);
    const txt = service.txt || {};
    if (txt.profile !== 'astra-thing-management-v1' || txt.modelId !== 'astra-thing' || !/^[a-f0-9]{32}$/.test(txt.deviceId) || !/^10\.42\.1\.\d{1,3}$/.test(txt.address) || service.port !== 8843) return;
    this.endpoints.set(key, {host: txt.address, port: service.port, id: txt.deviceId});
  }
  async loop() {
    if (!this.running) return;
    try {
      if (!this.workerBusy) this.usb = await runWorker(this.binary, {command: 'list'});
      // Native USB network addresses also work when mDNS was bound before a hotplug.
      // Probe only the device address of an attached BSP /29 link, never a LAN range.
      const endpoints = [...new Map([...this.endpoints.values(), ...usbEndpoints()].map(e => [e.host, e])).values()];
      const normal = [];
      this.state.connectionIssue = '';
      const issue = error => {this.state.connectionIssue = error.code || (error.message.includes('identity changed') ? 'IDENTITY_CHANGED' : error.message.includes('timed out') ? 'TIMEOUT' : error.status ? 'HTTP_' + error.status : 'UNAVAILABLE');};
      for (const endpoint of endpoints) {
        try {
          let result = await transport.request(endpoint, null, 'GET', '/v1/identity');
          let data = result.data;
          if (data.profile !== 'astra-thing-management-v1' || data.modelId !== 'astra-thing' || !/^[a-f0-9]{32}$/.test(data.deviceId) || endpoint.id && data.deviceId !== endpoint.id) continue;
          endpoint.id = data.deviceId;
          const credential = this.credentials[data.deviceId];
          let authenticated = false;
          if (credential) {
            try {
              result = await transport.request(endpoint, credential.fingerprint, 'GET', '/v1/status', {token: credential.token});
              data = result.data;
              if (data.deviceId !== endpoint.id) continue;
              authenticated = true;
            } catch (error) {
              issue(error);
              if (error.status === 401) {delete this.credentials[endpoint.id]; await this.secureStore.save(this.credentials);}
            }
          }
          normal.push({id: data.deviceId, mode: 'astra', name: data.name, endpoint, fingerprint: result.fingerprint, data, authenticated});
        } catch (error) {
          issue(error);
        }
      }
      this.normal = normal;
      const candidates = candidatesFor(normal, this.usb);
      const devices = candidates.map(d => ({id: d.id, mode: d.mode, name: d.name || (d.mode === 'astra' ? 'Astra Thing · earlier firmware' : 'Car Thing'), accessible: d.accessible !== false}));
      this.state.devices = devices;
      if (candidates.length > 1 && !this.selectedId && !this.state.busy) this.publish({step: 'choose'});
      const selected = this.selectedId ? candidates.find(d => d.id === this.selectedId) : candidates.length === 1 ? candidates[0] : null;
      this.current = selected || null;
      if (!this.workerBusy) this.detect(selected);
      if (this.pair && selected?.endpoint) await this.finishPair(selected);
      this.publish();
    } catch (error) {
      this.publish({error: error.message});
    } finally {if (this.running) this.timer = setTimeout(() => this.loop(), 2000);}
  }
  detect(device) {
    const previous = this.state.device;
    this.state.device = device?.mode || 'none';
    if (!device) {
      if (this.state.step === 'unplug') this.state.step = 'hold';
      if (['manage', 'authorize', 'pair'].includes(this.state.step)) {this.pair = null; this.state.step = 'connect';}
      if (previous !== 'none' && this.backup && !['installProgress', 'reboot'].includes(this.state.step)) {
        this.backup = null; this.state.backup = false;
      }
      return;
    }
    if (device.mode === 'astra' && device.endpoint) {
      this.state.version = device.data.version;
      this.state.build = device.data.build;
      this.state.healthy = device.data.healthy === true;
      const operation = device.data.operation;
      this.state.deviceOperation = operation ? {phase: operation.phase, version: operation.version, build: operation.build, message: operation.message} : null;
      if (this.expected) {
        const expected = this.expected;
        // The first observed new device still needs physical manager approval before confirmation.
        if (!expected.deviceId) expected.deviceId = device.id;
        if (expected.deviceId !== device.id) return;
        if (this.credentials[device.id] && device.authenticated !== false) {
          const operation = device.data.operation;
          if (operation && operation.id === this.operation && ['failed', 'interrupted', 'rolled-back'].includes(operation.phase)) {
            this.state.error = operation.message; this.state.step = 'error'; this.expected = null; this.state.busy = false; this.persist(); return;
          }
          if (device.data.healthy && device.data.version === expected.version && device.data.build === expected.build && (!this.operation || operation?.id === this.operation && operation.phase === 'complete')) {
            this.state.step = this.operation ? 'manage' : 'done'; this.state.stage = 'Firmware startup confirmed'; this.state.busy = false; this.state.error = '';
            this.expected = null; this.operation = null; this.persist(); return;
          }
          if (operation?.id === this.operation && ['checking', 'installing', 'restarting'].includes(operation.phase) && !this.state.busy) {
            this.state.step = 'updateRestart'; this.state.stage = operation.message; this.state.error = '';
          }
        }
      }
      if (device.authenticated === false && this.state.step === 'manage') this.state.step = 'authorize';
      if (['connect', 'welcome', 'recover', 'reboot', 'choose', 'legacy'].includes(this.state.step)) this.state.step = this.credentials[device.id] && device.authenticated !== false ? this.expected ? 'updateRestart' : 'manage' : 'authorize';
    } else if (device.mode === 'astra') {
      if (['connect', 'welcome', 'choose'].includes(this.state.step)) this.state.step = 'legacy';
    } else if (device.mode === 'recovery' && ['hold', 'connect', 'welcome', 'choose'].includes(this.state.step)) this.state.step = 'recoveryReady';
    else if (device.mode === 'stock' && ['connect', 'choose'].includes(this.state.step)) this.state.step = 'welcome';
    else if (device.mode === 'fastboot' && this.state.step === 'connect') this.state.step = 'recover';
  }
  async busy(step, work) {
    if (this.state.busy) throw Error('Wait for the current operation to finish');
    this.publish({busy: true, step, error: '', progress: null}); await this.persist();
    try {return await work();}
    catch (error) {this.publish({step: step === 'backupProgress' ? 'backupError' : 'error', error: error.message}); throw error;}
    finally {this.workerBusy = false; this.publish({busy: false}); await this.persist();}
  }
  async artifact(kind) {
    if (!this.release) throw Error('Choose a signed firmware release first');
    const a = this.release.manifest.artifacts[kind];
    const directory = await fs.mkdtemp(path.join(this.directory, 'package-')); await fs.chmod(directory, 0o700);
    const destination = path.join(directory, a.file);
    try {
      const space=await fs.statfs(directory);
      if(space.bavail*space.bsize<a.bytes+64*1024**2)throw Error('Not enough free computer storage for this firmware');
      if(this.release.urls) await download.download(this.release.urls[kind],destination,a,(sent,total)=>this.publish({stage:'Downloading firmware',progress:Math.floor(sent/total*100)}));
      else {await fs.copyFile(path.join(this.release.directory,a.file), destination, require('node:fs').constants.COPYFILE_EXCL); await fs.chmod(destination, 0o600); await release.verifyArtifact(destination, a);}
    }
    catch (error) {await fs.rm(directory, {recursive: true, force: true}); throw error;}
    return {path: destination, sha256: a.sha256, bytes: a.bytes, scratch: path.join(directory, 'verified.wic')};
  }
  async selectRelease() {
    const filename = await this.dialogs.release(); if (!filename) return;
    const selected = await release.readEnvelope(filename, this.trust);
    if (compareVersion(this.version, selected.manifest.minimumManager) < 0) throw Error('Update Thing Manager before using this firmware');
    this.release = selected;
    this.publish({releaseVersion: selected.manifest.version, releaseBuild: selected.manifest.build, error: ''});
    return true;
  }
  reviewUpdate() {
    const installed = this.current?.data;
    const candidate = this.release?.manifest;
    if (!installed || !candidate) throw Error('Connect your Thing and choose a release first');
    this.publish({step: candidate.build <= installed.build || compareVersion(candidate.version, installed.version) < 0 ? 'upToDate' : 'updateReview'});
  }
  async action(action, id) {
    if (this.actionBusy) return;
    this.actionBusy = true;
    try {
      if (this.state.busy && !['pair', 'pair-cancel', 'diagnostics'].includes(action)) throw Error('Wait for the device operation to finish');
      const device = this.current;
      switch (action) {
        case 'select': if (!this.state.devices.some(d => d.id === id)) throw Error('That device is no longer connected'); this.selectedId = id; this.publish({step: 'connect'}); break;
        case 'home': this.publish({step: device?.endpoint ? this.credentials[device.id] ? 'manage' : 'authorize' : 'connect', error: ''}); break;
        case 'start': case 'restart-guide': case 'repair': this.publish({step: device ? 'unplug' : 'hold'}); break;
        case 'recover': this.publish({step: 'recover', error: ''}); break;
        case 'backup-choice': if (device?.mode !== 'recovery') throw Error('Connect in recovery first'); this.publish({step: 'backupChoice'}); break;
        case 'choose-folder': {const folder = await this.dialogs.folder(); if (folder) {this.backupParent = folder; this.publish({folder});} break;}
        case 'release': await this.selectRelease(); break;
        case 'check-release': {
          const selected=await download.latest(this.trust);
          if(compareVersion(this.version,selected.manifest.minimumManager)<0)throw Error('Update Thing Manager before using this firmware');
          this.release=selected;this.publish({releaseVersion:selected.manifest.version,releaseBuild:selected.manifest.build,error:''});
          if(this.state.step==='manage')this.reviewUpdate();
          break;
        }
        case 'backup': {
          if (!this.backupParent || device?.mode !== 'recovery' || device.accessible === false) throw Error('Choose a backup folder and connect an accessible recovery device');
          const target = device.target;
          await this.busy('backupProgress', async () => {
            this.workerBusy = true;
            const directory = path.join(this.backupParent, 'Car-Thing-' + new Date().toISOString().replace(/[:.]/g, '-') + '-' + crypto.randomBytes(3).toString('hex'));
            await runWorker(this.binary, {command: 'backup', target, directory}, event => this.progress(event));
            this.backup = {directory, target}; this.publish({step: 'backupReady', backup: true, backupFolder: directory});
          }); break;
        }
        case 'review': if (!this.backup || JSON.stringify(this.backup.target) !== JSON.stringify(device?.target)) throw Error('Create a verified backup for this connected device first'); this.publish({step: 'review'}); break;
        case 'install': {
          if (!this.backup || device?.mode !== 'recovery' || JSON.stringify(this.backup.target) !== JSON.stringify(device.target)) throw Error('Backup does not belong to this device session');
          await this.busy('installProgress', async () => {
            this.workerBusy = true; this.publish({stage: 'Verifying signed firmware'});
            const artifact = await this.artifact('flash');
            try {
              this.expected = {version: this.release.manifest.version, build: this.release.manifest.build}; await this.persist();
              await runWorker(this.binary, {command: 'install', ...artifact, target: device.target, backup: this.backup.directory, confirmation: 'install-astra-thing'}, event => this.progress(event));
              this.selectedId = null; this.publish({step: 'reboot', progress: null});
            } finally {await fs.rm(path.dirname(artifact.path), {recursive: true, force: true});}
          }); break;
        }
        case 'manage': this.publish({step: 'manage'}); break;
        case 'pair': {
          if (!device?.endpoint || this.pair) throw Error('Select the Thing to authorize');
          const initial = transport.pairingRequest(os.hostname().slice(0, 80));
          const response = await transport.request(device.endpoint, device.fingerprint, 'POST', '/v1/pair/request', {body: initial.body});
          this.pair = {...initial.finish(response.data, response.fingerprint, device.id), deviceId: device.id, fingerprint: response.fingerprint, expires: Date.now() + 90000};
          this.publish({step: 'pair', code: this.pair.code}); break;
        }
        case 'pair-cancel': {
          const pending = this.pair; this.pair = null;
          if (pending && device?.endpoint) await transport.request(device.endpoint, pending.fingerprint, 'POST', '/v1/pair/cancel', {body: {id: pending.id, proof: pending.proof}}).catch(() => {});
          this.publish({step: 'authorize', code: ''}); break;
        }
        case 'update-review': if (await this.selectRelease()) this.reviewUpdate(); break;
        case 'update': {
          const credential = this.credentials[device?.id];
          if (!credential || !device?.endpoint || !this.release) throw Error('Authorize the Thing and choose a signed release first');
          if (this.release.manifest.build <= device.data.build || compareVersion(this.release.manifest.version, device.data.version) < 0) throw Error('Choose a newer firmware release');
          await this.busy('updateProgress', async () => {
            const artifact = await this.artifact('update');
            try {
              const prepared = await transport.request(device.endpoint, credential.fingerprint, 'POST', '/v1/update', {token: credential.token, body: this.release.envelope});
              this.operation = prepared.data.id; this.expected = {deviceId: device.id, version: this.release.manifest.version, build: this.release.manifest.build}; await this.persist();
              await transport.request(device.endpoint, credential.fingerprint, 'POST', '/v1/update/' + this.operation, {token: credential.token, filename: artifact.path, bytes: artifact.bytes, onProgress: (sent, total) => this.publish({stage: 'Sending verified firmware', progress: Math.floor(sent / total * 100)})});
              this.publish({step: 'updateRestart', stage: 'Installing firmware; waiting for a verified restart', progress: null});
            } finally {await fs.rm(path.dirname(artifact.path), {recursive: true, force: true});}
          }); break;
        }
        case 'restart': {
          const credential = this.credentials[device?.id]; if (!credential || !device?.endpoint || this.expected) throw Error('Device is not ready to restart');
          if (!await this.dialogs.restart()) break;
          await transport.request(device.endpoint, credential.fingerprint, 'POST', '/v1/restart', {token: credential.token, body: {confirmation: 'restart'}}); this.publish({step: 'recover'}); break;
        }
        case 'diagnostics': {
          const filename = await this.dialogs.diagnostics(); if (!filename) break;
          await fs.writeFile(filename, JSON.stringify({manager: this.version, platform: process.platform, architecture: process.arch, step: this.state.step, mode: this.state.device, connectionIssue: this.state.connectionIssue, installed: this.state.version, build: this.state.build, healthy: this.state.healthy, deviceOperation: this.state.deviceOperation, operation: this.operation ? {id: this.operation, expected: {version: this.expected?.version, build: this.expected?.build}} : null}, null, 2), {mode: 0o600}); break;
        }
        default: throw Error('Unknown manager action');
      }
    } finally {this.actionBusy = false;}
  }
  progress(event) {this.publish({stage: event.stage || this.state.stage, progress: Number.isFinite(event.percent) ? Math.max(0, Math.min(100, event.percent)) : null});}
  async finishPair(device) {
    const pending = this.pair; if (!pending || pending.deviceId !== device.id) return;
    if (Date.now() > pending.expires) {this.pair = null; this.publish({step: 'authorize', error: 'That code expired. Try connecting again.'}); return;}
    try {
      const response = await transport.request(device.endpoint, pending.fingerprint, 'POST', '/v1/pair/finish', {body: {id: pending.id, proof: pending.proof}});
      if (this.pair !== pending) return;
      if (response.data.deviceId !== device.id || !/^[A-Za-z0-9_-]{43}$/.test(response.data.token)) throw Error('Invalid management credential');
      this.credentials[device.id] = {...response.data, fingerprint: pending.fingerprint}; await this.secureStore.save(this.credentials);
      this.pair = null; this.publish({step: this.expected ? 'updateRestart' : 'manage', code: '', error: ''});
    } catch (error) {if (error.status !== 409) {this.pair = null; this.publish({step: 'authorize', error: error.message});}}
  }
  close() {this.running = false; clearTimeout(this.timer); this.discovery?.stop();}
}
module.exports = {Controller, compareVersion, usbEndpoints, candidatesFor};
