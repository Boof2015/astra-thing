const {test} = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const {verifyEnvelope, validate} = require('../main/release.cjs');
const {compareVersion} = require('../main/controller.cjs');
const {privateKey, publicKey} = crypto.generateKeyPairSync('rsa', {modulusLength: 3072});
const trust = {keys: [{id: 'test', publicKey: publicKey.export({format:'pem',type:'spki'})}]};
const manifest = {schema:1, modelId:'astra-thing', version:'0.3.0', minimumManager:'0.3.0', channel:'preview', build:'20260912000000', artifacts:{flash:{file:'firmware.zip',bytes:512,sha256:'0'.repeat(64)},update:{file:'firmware.swu',bytes:512,sha256:'1'.repeat(64)}}};
function envelope(value=manifest) {const payload=Buffer.from(JSON.stringify(value));return {schema:1,keyId:'test',payload:payload.toString('base64url'),signature:crypto.sign('sha256',payload,privateKey).toString('base64url')};}
test('signed release is accepted; changed payload and unknown signer are rejected',()=>{
 const signed=envelope(); assert.deepEqual(verifyEnvelope(signed,trust),manifest);
 assert.throws(()=>verifyEnvelope({...signed,payload:Buffer.from(JSON.stringify({...manifest,version:'9.0.0'})).toString('base64url')},trust),/signature/);
 assert.throws(()=>verifyEnvelope({...signed,keyId:'unknown'},trust),/unknown/);
 assert.throws(()=>verifyEnvelope({...signed,signature:'A'.repeat(9000)},trust),/encoding/);
});
test('valid signature cannot authorize traversal, unsigned HTTP, extra artifacts or unreasonable sizes',()=>{
 for(const patch of [{file:'../firmware.zip'},{file:'a/b.zip'},{bytes:2**40},{url:'http://example.com/file'},{url:'https://secret@example.com/file'}]) {
  assert.throws(()=>verifyEnvelope(envelope({...manifest,artifacts:{...manifest.artifacts,flash:{...manifest.artifacts.flash,...patch}}}),trust));
 }
 assert.throws(()=>validate({...manifest,artifacts:{...manifest.artifacts,script:{}}}));
});
test('minimum manager comparisons handle numeric versions and prereleases',()=>{
 assert.equal(compareVersion('0.3.0','0.3.0'),0);assert.equal(compareVersion('0.10.0','0.9.0'),1);
 assert.equal(compareVersion('0.3.0-preview.10','0.3.0-preview.2'),1);assert.equal(compareVersion('0.3.0-preview','0.3.0'),-1);
});
