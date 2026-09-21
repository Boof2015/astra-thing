// SPDX-License-Identifier: GPL-3.0-only
'use strict';
const tls = require('node:tls');
const http = require('node:http');
const crypto = require('node:crypto');
const fs = require('node:fs');

function connect(endpoint, expected) {
  if (!/^10\.42\.1\.\d{1,3}$/.test(endpoint.host) || !Number.isInteger(endpoint.port) || endpoint.port !== 8843) {
    return Promise.reject(Error('Expected the Thing USB address'));
  }
  return new Promise((resolve, reject) => {
    const socket = tls.connect({host: endpoint.host, port: endpoint.port, rejectUnauthorized: false, minVersion: 'TLSv1.2'});
    socket.setTimeout(12000, () => socket.destroy(Error('Thing connection timed out')));
    socket.once('error', reject);
    socket.once('secureConnect', () => {
      const raw = socket.getPeerCertificate().raw;
      if (!raw) return socket.destroy(Error('Thing certificate missing'));
      const fingerprint = crypto.createHash('sha256').update(raw).digest('hex');
      if (expected && fingerprint !== expected) return socket.destroy(Error('Thing identity changed. Pair with the manager again.'));
      resolve({socket, fingerprint});
    });
  });
}

async function request(endpoint, fingerprint, method, route, {body, token, filename, bytes, onProgress} = {}) {
  // TLS identity is checked before HTTP exists, so no credentials escape on mismatch.
  const connected = await connect(endpoint, fingerprint);
  const payload = body === undefined ? null : Buffer.from(JSON.stringify(body));
  return new Promise((resolve, reject) => {
    const headers = {Accept: 'application/json', Connection: 'close'};
    if (token) headers.Authorization = 'Bearer ' + token;
    if (payload || filename) {
      headers['Content-Type'] = filename ? 'application/octet-stream' : 'application/json';
      headers['Content-Length'] = filename ? bytes : payload.length;
    }
    // A plain HTTP parser over an already-established TLS socket; no redirect handling.
    const agent = new http.Agent({keepAlive: false});
    agent.createConnection = () => connected.socket;
    const req = http.request({host: endpoint.host, port: endpoint.port, method, path: route, headers, agent}, res => {
      const parts = []; let length = 0;
      res.on('data', block => {length += block.length; if (length > 150000) res.destroy(Error('Oversized Thing response')); else parts.push(block);});
      res.on('error', reject);
      res.on('end', () => {
        agent.destroy();
        try {
          const data = JSON.parse(Buffer.concat(parts).toString('utf8'));
          if (res.statusCode !== 200) {const error = Error(typeof data.error === 'string' ? data.error : 'Thing request failed'); error.status = res.statusCode; throw error;}
          resolve({data, fingerprint: connected.fingerprint});
        } catch (error) {reject(error);}
      });
    });
    let source;
    // Upload completion is followed by hashing the full package on the Thing.
    // Keep stalled transfers bounded, but allow that CPU/storage work to finish.
    if (filename) req.once('finish', () => connected.socket.setTimeout(180000));
    req.on('error', error => {source?.destroy(); agent.destroy(); reject(error);});
    if (filename) {
      let sent = 0;
      source = fs.createReadStream(filename);
      source.on('data', block => {sent += block.length; onProgress?.(sent, bytes);});
      source.on('error', error => req.destroy(error));
      source.pipe(req);
    } else req.end(payload);
  });
}

function pairingRequest(label) {
  const pair = crypto.generateKeyPairSync('ec', {namedCurve: 'prime256v1'});
  const publicKey = pair.publicKey.export({type: 'spki', format: 'der'}).toString('base64url');
  const nonce = crypto.randomBytes(32).toString('base64url');
  return {body: {label, publicKey, nonce}, finish(response, fingerprint, deviceId) {
    if (response.profile !== 'astra-thing-management-v1' || response.deviceId !== deviceId || response.certificate !== fingerprint || response.label !== label || !/^[a-f0-9]{32}$/.test(response.id)) throw Error('Management identity mismatch');
    const transcript = ['astra-thing-management-v1', response.id, deviceId, fingerprint, label, publicKey, nonce, response.publicKey, response.nonce];
    const peer = crypto.createPublicKey({key: Buffer.from(response.publicKey, 'base64url'), format: 'der', type: 'spki'});
    if (peer.asymmetricKeyType !== 'ec' || peer.asymmetricKeyDetails.namedCurve !== 'prime256v1' || Buffer.from(response.nonce, 'base64url').length !== 32) throw Error('Invalid management key');
    const secret = crypto.diffieHellman({privateKey: pair.privateKey, publicKey: peer});
    const encoded = Buffer.from(JSON.stringify(transcript));
    const prk = crypto.createHmac('sha256', crypto.createHash('sha256').update(encoded).digest()).update(secret).digest();
    const key = crypto.createHmac('sha256', prk).update('astra-thing-management-key\x01').digest();
    const mac = label => crypto.createHmac('sha256', key).update(label).update(encoded).digest();
    return {id: response.id, code: String(mac('code').readUInt32BE() % 1000000).padStart(6, '0'), proof: mac('proof').toString('base64url')};
  }};
}
module.exports = {request, pairingRequest, connect};
