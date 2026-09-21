// SPDX-License-Identifier: GPL-3.0-only
'use strict';
const os = require('node:os');
const net = require('node:net');
const {Bonjour} = require('bonjour-service');

function usbInterfaces(interfaces = os.networkInterfaces()) {
  const addresses = new Map();
  for (const [name, entries] of Object.entries(interfaces)) {
    for (const entry of entries || []) {
      if (entry.family !== 'IPv4' || entry.internal || entry.netmask !== '255.255.255.248' || !net.isIPv4(entry.address) || !entry.address.startsWith('10.42.1.')) continue;
      addresses.set(entry.address, name);
    }
  }
  return addresses;
}

function usbEndpoints(interfaces = os.networkInterfaces()) {
  const hosts = new Set();
  for (const address of usbInterfaces(interfaces).keys()) {
    hosts.add('10.42.1.' + ((Number(address.split('.').pop()) & 248) + 2));
  }
  return [...hosts].map(host => ({host, port: 8843}));
}

function createBonjour(options, onError) {
  const bonjour = new Bonjour(options, onError);
  // bonjour-service does not forward multicast-dns transport events publicly.
  // Keep this bridge covered with the real dependency in discovery.test.cjs.
  bonjour.server.mdns.on('error', onError);
  bonjour.server.mdns.on('warning', onError);
  return bonjour;
}

// Adapted from Astra 0c32125: Windows joins multiple adapters but otherwise sends
// queries through the default route. Bind ANY for multicast reception and set
// an explicit outbound interface for each attached Thing USB subnet.
function startDiscovery({onUp, onDown, platform = process.platform, getInterfaces = os.networkInterfaces,
  create = createBonjour, log = console.info, scheduleRefresh = (refresh, interval) => {
    const timer = setInterval(refresh, interval); timer.unref();
    return () => clearInterval(timer);
  }}) {
  const browsers = new Map(), failures = new Map();
  let stopped = false, inventoryError, cancelRefresh;

  const dispose = entry => {
    if (entry.disposed) return;
    entry.disposed = true;
    try {entry.browser?.stop();} catch { /* An unavailable adapter may already be closed. */ }
    try {entry.bonjour?.destroy();} catch { /* Including sockets whose bind failed. */ }
    for (const key of entry.services) onDown(key);
    entry.services.clear();
  };

  const refresh = () => {
    if (stopped) return;
    let addresses;
    try {
      addresses = platform === 'win32' ? usbInterfaces(getInterfaces()) : new Map([['default', 'default']]);
      inventoryError = undefined;
    } catch (error) {
      const message = String(error);
      if (inventoryError !== message) log(`[thing-discovery] Could not refresh interfaces: ${message}`);
      inventoryError = message;
      return;
    }
    for (const [address, entry] of browsers) {
      if (addresses.has(address)) continue;
      browsers.delete(address); dispose(entry);
    }
    for (const address of failures.keys()) if (!addresses.has(address)) failures.delete(address);

    for (const [address, name] of addresses) {
      const existing = browsers.get(address);
      if (existing) {
        // The dependency sends only one initial query. Repeat it so a dropped
        // first query or a freshly rebooted Thing does not require an app restart.
        if (!existing.failed) {try {existing.browser.update();} catch (error) {existing.fail(error);}}
        continue;
      }
      const entry = {services: new Set(), failed: false, disposed: false};
      browsers.set(address, entry);
      const fail = entry.fail = error => {
        if (stopped || entry.disposed || entry.failed) return;
        entry.failed = true;
        const message = String(error);
        if (failures.get(address) !== message) log(`[thing-discovery] ${name} (${address}) failed; retrying in 5s: ${message}`);
        failures.set(address, message);
        // Socket setup may still be creating its timers when a warning fires.
        queueMicrotask(() => {
          if (browsers.get(address) === entry) browsers.delete(address);
          dispose(entry);
        });
      };
      const up = service => {
        if (stopped || entry.disposed || entry.failed) return;
        const key = `${address}/${service.fqdn}`;
        entry.services.add(key);
        onUp(service, key);
      };
      try {
        entry.bonjour = create(platform === 'win32'
          ? {bind: '0.0.0.0', port: 5353, interface: address, loopback: false, reuseAddr: true} : {}, fail);
        if (entry.failed) continue;
        entry.browser = entry.bonjour.find({type: 'astra-thing'}, up);
        entry.browser.on('txt-update', up);
        entry.browser.on('srv-update', up);
        entry.browser.on('down', service => {
          if (stopped || entry.disposed || entry.failed) return;
          const key = `${address}/${service.fqdn}`;
          entry.services.delete(key); onDown(key);
        });
      } catch (error) {fail(error);}
    }
  };

  refresh();
  cancelRefresh = scheduleRefresh(refresh, 5000);
  return {stop() {
    if (stopped) return;
    stopped = true; cancelRefresh();
    for (const entry of browsers.values()) dispose(entry);
    browsers.clear();
  }};
}

module.exports = {startDiscovery, usbInterfaces, usbEndpoints};
