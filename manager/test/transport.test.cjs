const {test} = require('node:test');
const assert = require('node:assert/strict');
const https = require('node:https');
const tls = require('node:tls');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const {execFileSync} = require('node:child_process');
const {request} = require('../main/transport.cjs');
test('pin mismatch sends no HTTP request or credential; a matching pin reaches the test device',async()=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'astra-transport-'));
 const cert=path.join(directory,'cert.pem'),key=path.join(directory,'key.pem');
 execFileSync('openssl',['req','-x509','-newkey','ec','-pkeyopt','ec_paramgen_curve:P-256','-nodes','-days','1','-subj','/CN=Test','-keyout',key,'-out',cert],{stdio:'ignore'});
 let requests=0,authorization;
 const server=https.createServer({key:fs.readFileSync(key),cert:fs.readFileSync(cert)},(req,res)=>{requests++;authorization=req.headers.authorization;if(req.method==='POST'){req.resume();req.on('end',()=>setTimeout(()=>res.end('{"ok":true}'),350));}else res.end('{"ok":true}');});
 const original=tls.connect;
 try {
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  tls.connect=options=>original({...options,host:'127.0.0.1',port:server.address().port});
  await assert.rejects(request({host:'10.42.1.2',port:8843},'0'.repeat(64),'GET','/v1/status',{token:'test-private-token'}),/identity/);
  assert.equal(requests,0);
  const fingerprint=crypto.createHash('sha256').update(new crypto.X509Certificate(fs.readFileSync(cert)).raw).digest('hex');
  const result=await request({host:'10.42.1.2',port:8843},fingerprint,'GET','/v1/status',{token:'test-private-token'});
  assert.deepEqual(result.data,{ok:true});assert.equal(requests,1);assert.equal(authorization,'Bearer test-private-token');
  // Scale idle/verification timeouts to keep this real delayed-server regression fast.
  tls.connect=options=>{const socket=original({...options,host:'127.0.0.1',port:server.address().port});const set=socket.setTimeout.bind(socket);socket.setTimeout=(ms,callback)=>set(ms===180000?2500:150,callback);return socket;};
  const upload=path.join(directory,'firmware.swu');fs.writeFileSync(upload,'test upload');
  const verified=await request({host:'10.42.1.2',port:8843},fingerprint,'POST','/v1/update/example',{token:'test-private-token',filename:upload,bytes:11});
  assert.deepEqual(verified.data,{ok:true});assert.equal(requests,2);
 } finally {tls.connect=original;server.closeAllConnections();await new Promise(resolve=>server.close(resolve));fs.rmSync(directory,{recursive:true,force:true});}
});
