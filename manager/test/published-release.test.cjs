// SPDX-License-Identifier: GPL-3.0-only
const {test} = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {latest} = require('../main/download.cjs');
const {Controller} = require('../main/controller.cjs');
const transport = require('../main/transport.cjs');
const {privateKey, publicKey} = crypto.generateKeyPairSync('rsa', {modulusLength:3072});
const trust = {keys:[{id:'test',publicKey:publicKey.export({format:'pem',type:'spki'})}]};
const api = 'https://api.github.com/repos/Boof2015/astra-thing/releases/latest';
const base = 'https://github.com/Boof2015/astra-thing/releases/download/v0.3.0-20261027000000/';

function fixture() {
  const files = {'firmware.zip':Buffer.from('test first-install image'),'firmware.swu':Buffer.from('test update image')};
  const artifacts = Object.fromEntries(Object.entries(files).map(([file, bytes]) => [file.endsWith('.zip')?'flash':'update',
    {file,bytes:bytes.length,sha256:crypto.createHash('sha256').update(bytes).digest('hex')}]));
  const manifest = {schema:1,modelId:'astra-thing',version:'0.3.0',minimumManager:'0.3.0',build:'20261027000000',channel:'stable',artifacts};
  const info = {draft:false,prerelease:false,assets:[]};
  function sign() {
    const payload = Buffer.from(JSON.stringify(manifest));
    files['release.json'] = Buffer.from(JSON.stringify({schema:1,keyId:'test',payload:payload.toString('base64url'),signature:crypto.sign('sha256',payload,privateKey).toString('base64url')}));
    info.assets = Object.entries(files).map(([name, data]) => ({name,size:data.length,state:'uploaded',browser_download_url:base+name}));
  }
  sign();
  const calls = [];
  async function fetch(url, options) {
    calls.push({url,options});
    if(url===api) {assert.equal(options.headers.Accept,'application/json');return Response.json(info);}
    assert.ok(url.startsWith(base), 'Unexpected request: '+url);
    const file = files[url.slice(base.length)];
    return new Response(file||'',{status:file?200:404});
  }
  return {files,manifest,info,sign,fetch,calls};
}

test('published release downloads both verified artifacts and hands the update to the authorized Thing',async()=>{
  const f=fixture(), originalFetch=global.fetch, originalRequest=transport.request;
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'astra-published-'));
  try {
    global.fetch=f.fetch;
    const c=new Controller({directory,version:'0.3.0',dialogs:{},secureStore:{}});
    c.persist=async()=>{};c.trust=trust;
    c.current={id:'thing',mode:'astra',endpoint:{host:'10.42.1.234',port:8843},data:{version:'0.3.0',build:'20260912000000'}};
    c.credentials.thing={token:'test-token',fingerprint:'test-fingerprint'};
    c.state.step='manage';
    await c.action('check-release');
    assert.equal(c.state.step,'updateReview');
    const flash=await c.artifact('flash');
    assert.deepEqual(await fs.readFile(flash.path),f.files['firmware.zip']);
    const requests=[];
    transport.request=async(endpoint,fingerprint,method,url,options)=>{
      requests.push(url);
      assert.equal(options.token,'test-token');assert.equal(fingerprint,'test-fingerprint');
      if(url==='/v1/update') {assert.deepEqual(options.body,c.release.envelope);return {data:{id:'test-operation'}};}
      assert.equal(url,'/v1/update/test-operation');
      assert.deepEqual(await fs.readFile(options.filename),f.files['firmware.swu']);
      return {data:{}};
    };
    await c.action('update');
    assert.deepEqual(requests,['/v1/update','/v1/update/test-operation']);
    assert.equal(c.state.step,'updateRestart');
    assert.equal(c.expected.build,f.manifest.build);
    // A finished upload is not treated as a verified device boot.
    assert.equal(c.operation,'test-operation');
  } finally {global.fetch=originalFetch;transport.request=originalRequest;await fs.rm(directory,{recursive:true,force:true});}
});

test('drafts, prereleases, unsigned changes and incomplete uploads cannot become the latest firmware',async()=>{
  const original=global.fetch;
  try {
    for(const mutate of [
      f=>{f.info.draft=true;}, f=>{f.info.prerelease=true;},
      f=>{f.manifest.channel='preview';f.sign();},
      f=>{f.info.assets=f.info.assets.filter(a=>a.name!=='firmware.swu');},
      f=>{f.info.assets.find(a=>a.name==='firmware.zip').size++;},
      f=>{f.info.assets.find(a=>a.name==='firmware.zip').state='starter';},
      f=>{f.info.assets.find(a=>a.name==='firmware.zip').browser_download_url='https://example.com/firmware.zip';},
      f=>{const envelope=JSON.parse(f.files['release.json']);envelope.signature='A'.repeat(envelope.signature.length);f.files['release.json']=Buffer.from(JSON.stringify(envelope));}
    ]) {
      const f=fixture();mutate(f);global.fetch=f.fetch;await assert.rejects(latest(trust));
    }
  } finally {global.fetch=original;}
});

test('a corrupt update is removed before any request to the Thing',async()=>{
  const f=fixture(), original=global.fetch, originalRequest=transport.request;
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'astra-corrupt-'));
  try {
    global.fetch=f.fetch;
    const c=new Controller({directory,version:'0.3.0',dialogs:{},secureStore:{}});
    c.persist=async()=>{};c.release=await latest(trust);
    c.current={id:'thing',endpoint:{},data:{version:'0.3.0',build:'20260912000000'}};c.credentials.thing={};
    f.files['firmware.swu']=Buffer.alloc(f.files['firmware.swu'].length);
    let requests=0;transport.request=async()=>{requests++;throw Error('Must not contact device');};
    await assert.rejects(c.action('update'),/incomplete or has changed/);
    assert.equal(requests,0);assert.deepEqual(await fs.readdir(directory),[]);
  } finally {global.fetch=original;transport.request=originalRequest;await fs.rm(directory,{recursive:true,force:true});}
});

test('release checks handle missing public releases, throttling and unsafe redirects',async()=>{
  const original=global.fetch;
  try {
    for(const [status,message] of [[404,/No public firmware/],[403,/limited/],[429,/limited/]]) {
      global.fetch=async()=>new Response('',{status});await assert.rejects(latest(trust),message);
    }
    let calls=0;
    global.fetch=async()=>{calls++;return new Response('',{status:302,headers:{Location:'https://example.com/file'}});};
    await assert.rejects(latest(trust),/Unexpected firmware download/);assert.equal(calls,1);
    global.fetch=async()=>new Response('',{status:302});await assert.rejects(latest(trust),/missing its address/);
    global.fetch=async()=>new Response('x'.repeat(1024*1024+1));await assert.rejects(latest(trust),/Oversized/);
  } finally {global.fetch=original;}
});
