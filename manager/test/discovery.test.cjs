// SPDX-License-Identifier: GPL-3.0-only
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {EventEmitter} = require('node:events');
const dgram = require('node:dgram');
const dnsPacket = require('dns-packet');
const {startDiscovery, usbEndpoints} = require('../main/discovery.cjs');

const ipv4 = (address, netmask = '255.255.255.248') => ({family: 'IPv4', address, netmask, internal: false});
const turn = () => new Promise(resolve => setImmediate(resolve));

function harness(initial = {}, platform = 'win32') {
  let interfaces = initial, enumerationFails = false, refresh, cancelled = false;
  const entries = [], found = new Map(), logs = [], failCreate = new Set(), failFind = new Set();
  const discovery = startDiscovery({
    platform, onUp: (service, key) => found.set(key, service), onDown: key => found.delete(key),
    getInterfaces: () => {if (enumerationFails) throw Error('Inventory unavailable'); return interfaces;},
    create: (options, fail) => {
      if (failCreate.has(options.interface)) throw Error('Adapter unavailable');
      const browser = new EventEmitter();
      const entry = {options, fail, browser, stops: 0, destroys: 0, queries: 0}; entries.push(entry);
      browser.stop = () => entry.stops++;
      browser.update = () => entry.queries++;
      return {find: (options, up) => {
        assert.deepEqual(options, {type: 'astra-thing'});
        if (failFind.has(entry.options.interface)) throw Error('Browse unavailable');
        browser.on('up', up); browser.update(); return browser;
      }, destroy: () => entry.destroys++};
    },
    log: message => logs.push(message),
    scheduleRefresh: (callback, interval) => {
      assert.equal(interval, 5000); refresh = callback; return () => {cancelled = true;};
    }
  });
  return {discovery, entries, found, logs, failCreate, failFind,
    setInterfaces: next => {interfaces = next;}, failEnumeration: value => {enumerationFails = value;},
    tick: () => {if (!cancelled) refresh();}, stopped: () => cancelled};
}

test('Windows selects each attached Thing subnet despite Wi-Fi, VPN and virtual adapters', t => {
  const interfaces = {
    'Wi-Fi': [ipv4('192.168.1.23', '255.255.255.0')], Tailscale: [ipv4('169.254.83.107', '255.255.0.0')],
    'VMware VMnet8': [ipv4('172.16.188.1', '255.255.255.0')],
    'Ethernet 3': [ipv4('10.42.1.238')], 'Ethernet 4': [ipv4('10.42.1.14')],
    duplicate: [ipv4('10.42.1.238')], loopback: [{...ipv4('10.42.1.6'), internal: true}],
    wrongMask: [ipv4('10.42.1.8', '255.255.255.0')], invalid: [ipv4('10.42.1.999')],
    unassigned: [ipv4('0.0.0.0')], ipv6: [{...ipv4('::1'), family: 'IPv6'}], absent: undefined
  };
  const h = harness(interfaces); t.after(() => h.discovery.stop());
  assert.deepEqual(h.entries.map(e => e.options), ['10.42.1.238', '10.42.1.14'].map(address => ({
    bind: '0.0.0.0', port: 5353, interface: address, loopback: false, reuseAddr: true
  })));
  assert.deepEqual(usbEndpoints(interfaces), [{host: '10.42.1.234', port: 8843}, {host: '10.42.1.10', port: 8843}]);
});

test('USB attachment, address change and reconnection refresh browsers without restarting the manager', t => {
  const h = harness(); t.after(() => h.discovery.stop());
  assert.equal(h.entries.length, 0);
  h.setInterfaces({USB: [ipv4('10.42.1.238')]}); h.tick(); h.tick();
  const first = h.entries[0];
  assert.equal(h.entries.length, 1); assert.equal(first.queries, 2);
  first.browser.emit('up', {fqdn: 'Thing.local', txt: {address: '10.42.1.234'}});
  assert.equal(h.found.size, 1);
  h.setInterfaces({USB: [ipv4('10.42.1.14')]}); h.tick();
  assert.equal(first.stops, 1); assert.equal(first.destroys, 1); assert.equal(h.found.size, 0);
  first.browser.emit('up', {fqdn: 'stale.local'}); assert.equal(h.found.size, 0);
  h.setInterfaces({}); h.tick(); assert.equal(h.entries[1].destroys, 1);
  h.setInterfaces({USB: [ipv4('10.42.1.238')]}); h.tick(); assert.equal(h.entries.length, 3);
  h.discovery.stop(); h.discovery.stop(); h.tick();
  assert.equal(h.stopped(), true); assert.ok(h.entries.every(e => e.stops === 1 && e.destroys === 1));
});

test('removing one interface does not erase a service still discovered by another browser', t => {
  const h = harness({USB: [ipv4('10.42.1.238'), ipv4('10.42.1.14')]}); t.after(() => h.discovery.stop());
  const service = {fqdn: 'Thing._astra-thing._tcp.local', port: 8843};
  for (const entry of h.entries) entry.browser.emit('up', service);
  assert.equal(h.found.size, 2);
  h.setInterfaces({USB: [ipv4('10.42.1.14')]}); h.tick();
  assert.equal(h.found.size, 1);
  h.entries[1].browser.emit('txt-update', {...service, txt: {address: '10.42.1.10'}});
  assert.equal([...h.found.values()][0].txt.address, '10.42.1.10');
  h.entries[1].browser.emit('srv-update', {...service, port: 9999});
  assert.equal([...h.found.values()][0].port, 9999);
  h.entries[1].browser.emit('down', service); assert.equal(h.found.size, 0);
});

test('adapter failures are isolated and retried; enumeration failure preserves live browsers', async t => {
  const h = harness(); t.after(() => h.discovery.stop());
  h.failCreate.add('10.42.1.238');
  h.setInterfaces({USB: [ipv4('10.42.1.238'), ipv4('10.42.1.14')]}); h.tick(); await turn();
  h.tick(); await turn();
  assert.equal(h.entries.length, 1); assert.equal(h.logs.length, 1);
  const unaffected = h.entries[0];
  h.failCreate.clear(); h.failFind.add('10.42.1.238'); h.tick(); await turn();
  assert.equal(h.entries[1].destroys, 1);
  h.failFind.clear(); h.tick(); const failed = h.entries[2];
  failed.browser.emit('up', {fqdn: 'Thing.local'});
  failed.fail(Error('ENETDOWN')); failed.fail(Error('ENETDOWN')); await turn();
  assert.equal(failed.destroys, 1); assert.equal(h.found.size, 0); assert.equal(unaffected.destroys, 0);
  h.tick(); const replacement = h.entries[3];
  failed.fail(Error('Late error')); await turn(); assert.equal(replacement.destroys, 0);
  h.failEnumeration(true); h.tick(); h.tick();
  assert.equal(h.logs.filter(l => l.includes('Could not refresh')).length, 1);
  assert.equal(replacement.destroys, 0);
  replacement.fail(Error('Socket failed')); h.discovery.stop(); await turn(); h.tick();
  assert.equal(h.entries.length, 4); assert.ok(h.entries.every(e => e.destroys === 1));
});

test('macOS and Linux retain the default Bonjour browser plus direct USB fallback', t => {
  for (const platform of ['darwin', 'linux']) {
    const h = harness({}, platform); t.after(() => h.discovery.stop());
    assert.equal(h.entries.length, 1); assert.deepEqual(h.entries[0].options, {});
    h.tick(); assert.equal(h.entries.length, 1); assert.equal(h.entries[0].queries, 2);
  }
});

// Use real bonjour-service/multicast-dns and DNS packets over a fake datagram
// transport, so socket configuration, queries and transport errors are tested
// on every CI host without needing a physical Windows USB adapter.
class Datagram extends EventEmitter {
  constructor() {super(); this.closed = false; this.packets = [];}
  bind(port, address, callback) {
    this.bound = {port, address};
    queueMicrotask(() => {this.emit('listening'); callback();});
  }
  addMembership(_group, address) {if (this.failMembership) throw Error('Membership unavailable'); this.membership = address;}
  dropMembership() {}
  setMulticastInterface(address) {this.outgoing = address;}
  setMulticastTTL() {}
  setMulticastLoopback(value) {this.loopback = value;}
  send(buffer, _offset, _length, port, address, callback) {
    assert.equal(this.closed, false); assert.equal(port, 5353); assert.equal(address, '224.0.0.251');
    this.packets.push(dnsPacket.decode(buffer)); queueMicrotask(() => callback(null));
  }
  close(callback) {this.closed = true; callback?.();}
  receive(packet) {this.emit('message', dnsPacket.encode(packet), {address: '10.42.1.234', port: 5353, family: 'IPv4'});}
}

test('real Bonjour sends USB-scoped queries, receives a Thing and handles its goodbye', async t => {
  const sockets = [], found = new Map(); let refresh;
  t.mock.method(dgram, 'createSocket', options => {
    assert.equal(options.reuseAddr, true);
    const socket = new Datagram(); sockets.push(socket); return socket;
  });
  const discovery = startDiscovery({platform: 'win32',
    getInterfaces: () => ({WiFi: [ipv4('192.168.1.23', '255.255.255.0')], USB: [ipv4('10.42.1.238')]}),
    onUp: (service, key) => found.set(key, service), onDown: key => found.delete(key),
    scheduleRefresh: callback => {refresh = callback; return () => {};}
  });
  t.after(() => discovery.stop()); await turn();
  assert.equal(sockets.length, 1); const socket = sockets[0];
  assert.deepEqual(socket.bound, {port: 5353, address: '0.0.0.0'});
  assert.equal(socket.membership, '10.42.1.238'); assert.equal(socket.outgoing, '10.42.1.238');
  assert.equal(socket.loopback, false);
  assert.deepEqual(socket.packets[0].questions, [{name: '_astra-thing._tcp.local', type: 'PTR', class: 'IN'}]);
  refresh(); await turn(); assert.equal(socket.packets.length, 2);
  const name = 'Thing._astra-thing._tcp.local';
  const ptr = {name: '_astra-thing._tcp.local', type: 'PTR', ttl: 120, data: name};
  socket.receive({type: 'response', answers: [ptr], additionals: [
    {name, type: 'SRV', ttl: 120, data: {port: 8843, target: 'Thing.local', priority: 0, weight: 0}},
    {name, type: 'TXT', ttl: 120, data: ['profile=astra-thing-management-v1', 'modelId=astra-thing', 'address=10.42.1.234'].map(s => Buffer.from(s))},
    {name: 'Thing.local', type: 'A', ttl: 120, data: '10.42.1.234'}
  ]});
  assert.equal(found.size, 1); assert.equal([...found.values()][0].txt.address, '10.42.1.234');
  socket.receive({type: 'response', answers: [{...ptr, ttl: 0}]}); assert.equal(found.size, 0);
  discovery.stop(); assert.equal(socket.closed, true);
});

test('real transport setup warnings and asynchronous bind errors close sockets and retry', async t => {
  const sockets = []; let refresh;
  t.mock.method(dgram, 'createSocket', () => {
    const socket = new Datagram(); socket.failMembership = sockets.length === 0; sockets.push(socket); return socket;
  });
  const discovery = startDiscovery({platform: 'win32', getInterfaces: () => ({USB: [ipv4('10.42.1.238')]}),
    onUp: () => {}, onDown: () => {}, log: () => {},
    scheduleRefresh: callback => {refresh = callback; return () => {};}
  });
  t.after(() => discovery.stop()); await turn(); assert.equal(sockets[0].closed, true);
  refresh(); await turn();
  assert.doesNotThrow(() => sockets[1].emit('error', Object.assign(Error('Address in use'), {code: 'EADDRINUSE'})));
  await turn(); assert.equal(sockets[1].closed, true);
  refresh(); await turn(); assert.equal(sockets.length, 3); assert.equal(sockets[2].closed, false);
  discovery.stop(); assert.ok(sockets.every(s => s.closed));
});
