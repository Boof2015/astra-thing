// SPDX-License-Identifier: GPL-3.0-only
const crypto=require('node:crypto');
const fs=require('node:fs/promises');
const path=require('node:path');
const VERSION=/^(0|[1-9]\d{0,3})\.(0|[1-9]\d{0,3})\.(0|[1-9]\d{0,3})(?:-[a-z0-9.-]{1,40})?$/;
function decode(value,maximum){if(typeof value!=='string'||value.length>maximum*2||!/^[A-Za-z0-9_-]+$/.test(value))throw Error('Invalid release encoding');const bytes=Buffer.from(value,'base64url');if(bytes.length>maximum||bytes.toString('base64url')!==value)throw Error('Invalid release encoding');return bytes}
function validate(manifest){
 if(!manifest||manifest.schema!==1||manifest.modelId!=='astra-thing'||!VERSION.test(manifest.version)||!VERSION.test(manifest.minimumManager)||!['stable','preview'].includes(manifest.channel)||!/^\d{14}$/.test(manifest.build))throw Error('Unsupported firmware release');
 const artifacts=manifest.artifacts;
 if(!artifacts||Object.keys(artifacts).sort().join(',')!=='flash,update')throw Error('Incomplete firmware release');
 for(const [kind,a] of Object.entries(artifacts)){
  if(!a||typeof a.file!=='string'||!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,150}$/.test(a.file)||!a.file.endsWith(kind==='flash'?'.zip':'.swu')||!Number.isSafeInteger(a.bytes)||a.bytes<=0||a.bytes>(kind==='flash'?4*1024**3:600*1024**2)||!/^[a-f0-9]{64}$/.test(a.sha256))throw Error('Invalid firmware artifact');
  if(a.url){const u=new URL(a.url);if(u.protocol!=='https:'||u.username||u.password||u.hash)throw Error('Firmware download must use HTTPS')}
 }
 return manifest;
}
function verifyEnvelope(envelope,trust){
 if(!envelope||envelope.schema!==1||typeof envelope.keyId!=='string')throw Error('Invalid signed release');
 const key=trust.keys?.find(k=>k.id===envelope.keyId);if(!key)throw Error('Firmware was signed by an unknown publisher');
 const publicKey=crypto.createPublicKey(key.publicKey);
 if(publicKey.asymmetricKeyType!=='rsa'||publicKey.asymmetricKeyDetails.modulusLength<3072)throw Error('Unsupported publisher key');
 const payload=decode(envelope.payload,65536),signature=decode(envelope.signature,1024);
 if(!crypto.verify('sha256',payload,{key:publicKey,padding:crypto.constants.RSA_PKCS1_PADDING},signature))throw Error('Firmware signature verification failed');
 return validate(JSON.parse(payload.toString('utf8')));
}
async function readEnvelope(filename,trust){const stat=await fs.stat(filename);if(stat.size>150000)throw Error('Release file is too large');const envelope=JSON.parse(await fs.readFile(filename,'utf8'));return {envelope,manifest:verifyEnvelope(envelope,trust),directory:path.dirname(filename)}}
async function hashFile(filename){const handle=await fs.open(filename,'r');const hash=crypto.createHash('sha256');try{for await(const chunk of handle.createReadStream({autoClose:false}))hash.update(chunk);return hash.digest('hex')}finally{await handle.close()}}
async function verifyArtifact(filename,artifact){const info=await fs.stat(filename);if(!info.isFile()||info.size!==artifact.bytes||await hashFile(filename)!==artifact.sha256)throw Error('Firmware download is incomplete or has changed');return filename}
module.exports={validate,verifyEnvelope,readEnvelope,verifyArtifact,hashFile,decode};
