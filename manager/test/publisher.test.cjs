// SPDX-License-Identifier: GPL-3.0-only
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const crypto=require('node:crypto');
const {spawnSync}=require('node:child_process');
const {readEnvelope,verifyArtifact}=require('../main/release.cjs');

test('a draft candidate can be signed for stable publication without editing the source channel or exporting its key',async()=>{
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'astra-sign-test-'));
  try{
    for(const folder of ['manager/scripts','manager/main','release'])await fs.mkdir(path.join(directory,folder),{recursive:true});
    for(const name of ['scripts/sign-release.cjs','main/release.cjs'])await fs.copyFile(path.join(__dirname,'..',name),path.join(directory,'manager',name));
    const {privateKey,publicKey}=crypto.generateKeyPairSync('rsa',{modulusLength:3072});
    const id=crypto.createHash('sha256').update(publicKey.export({type:'spki',format:'der'})).digest('hex');
    const trust={keys:[{id,publicKey:publicKey.export({type:'spki',format:'pem'})}]};
    const profile={version:'0.3.0',minimumManager:'0.3.0',channel:'preview',modelId:'astra-thing'};
    await fs.writeFile(path.join(directory,'release/trusted-keys.json'),JSON.stringify(trust));
    await fs.writeFile(path.join(directory,'release/version.json'),JSON.stringify(profile));
    await fs.writeFile(path.join(directory,'private.pem'),privateKey.export({type:'pkcs8',format:'pem'}));
    await fs.writeFile(path.join(directory,'flash.zip'),'flash fixture');
    await fs.writeFile(path.join(directory,'update.swu'),'update fixture');
    await fs.writeFile(path.join(directory,'build.json'),JSON.stringify({version:'0.3.0',build:'20261027000000',upstream:'test',inputs:{'prototype/test':'test'}}));
    const output=path.join(directory,'candidate');
    const args=[path.join(directory,'manager/scripts/sign-release.cjs'),...['private.pem','flash.zip','update.swu','build.json'].map(f=>path.join(directory,f)),output];
    const result=spawnSync(process.execPath,[...args,'stable'],{encoding:'utf8'});
    assert.equal(result.status,0,result.stderr);
    const {manifest}=await readEnvelope(path.join(output,'release.json'),trust);
    assert.equal(manifest.channel,'stable');
    for(const artifact of Object.values(manifest.artifacts))await verifyArtifact(path.join(output,artifact.file),artifact);
    assert.equal(JSON.parse(await fs.readFile(path.join(directory,'release/version.json'))).channel,'preview');
    assert.deepEqual((await fs.readdir(output)).sort(),['astra-thing-0.3.0-20261027000000.swu','astra-thing-0.3.0-20261027000000.zip','build-inputs.json','release.json']);
    assert.notEqual(spawnSync(process.execPath,[...args,'stable']).status,0,'Must not overwrite an existing candidate');
    assert.notEqual(spawnSync(process.execPath,[...args.slice(0,-1),path.join(directory,'bad'),'unknown']).status,0);
  }finally{await fs.rm(directory,{recursive:true,force:true});}
});
