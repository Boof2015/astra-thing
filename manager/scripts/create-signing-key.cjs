// SPDX-License-Identifier: GPL-3.0-only
// Explicit publisher tool. Private output must remain outside source control.
const {generateKeyPairSync,createHash}=require('node:crypto');
const fs=require('node:fs');const path=require('node:path');
const [privateFile,trustFile]=process.argv.slice(2);
if(!privateFile||!trustFile)throw Error('Usage: node create-signing-key.cjs PRIVATE_FILE TRUST_FILE');
if(fs.existsSync(privateFile)||fs.existsSync(trustFile))throw Error('Refusing to replace an existing signing identity');
const {privateKey,publicKey}=generateKeyPairSync('rsa',{modulusLength:3072});
const publicPem=publicKey.export({type:'spki',format:'pem'});
const id=createHash('sha256').update(publicKey.export({type:'spki',format:'der'})).digest('hex');
fs.mkdirSync(path.dirname(privateFile),{recursive:true,mode:0o700});
fs.writeFileSync(privateFile,privateKey.export({type:'pkcs8',format:'pem'}),{flag:'wx',mode:0o600});
fs.writeFileSync(trustFile,JSON.stringify({schema:1,keys:[{id,publicKey:publicPem}]},null,2)+'\n',{flag:'wx'});
console.log('Created publisher identity. Only the public key is in the release inputs.');
