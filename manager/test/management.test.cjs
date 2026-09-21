const {test} = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const {spawnSync} = require('node:child_process');
const path = require('node:path');
const {pairingRequest} = require('../main/transport.cjs');
test('Node manager and Python device derive the same code and proof; no access before physical approval',()=>{
 const initial=pairingRequest('Test computer');
 const script = `import json,sys,tempfile\nfrom pathlib import Path\nsys.path.insert(0,sys.argv[1])\nfrom management_core import Pairing\nwith tempfile.TemporaryDirectory() as d:\n p=Pairing(Path(d)/'managers.json','a'*32,'b'*64)\n response=p.request(json.loads(sys.argv[2]))\n print(json.dumps({'response':response,'code':p.pending['code'],'proof':p.pending['proof']}))\n`;
 const result=spawnSync('python3',['-c',script,path.resolve(__dirname,'../../prototype'),JSON.stringify(initial.body)],{encoding:'utf8'});
 assert.equal(result.status,0,result.stderr);const device=JSON.parse(result.stdout);
 const actual=initial.finish(device.response,'b'.repeat(64),'a'.repeat(32));
 assert.equal(actual.code,device.code);assert.equal(actual.proof,device.proof);
 assert.throws(()=>initial.finish(device.response,'c'.repeat(64),'a'.repeat(32)),/identity/);
 assert.throws(()=>initial.finish({...device.response,label:'other'},'b'.repeat(64),'a'.repeat(32)),/identity/);
});
