const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {runWorker}=require('../main/worker.cjs');
test('a worker error or missing completion cannot become successful progress', {skip:process.platform==='win32'},async()=>{
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'astra-worker-'));
 try {
  for(const [name,body] of [['failed','echo \'{"event":"error","message":"USB disconnected"}\'; exit 1'],['partial','echo \'{"event":"progress","percent":100}\'; exit 0']]) {
   const binary=path.join(directory,name);await fs.writeFile(binary,'#!/bin/sh\ncat >/dev/null\n'+body+'\n',{mode:0o700});
   await assert.rejects(runWorker(binary,{command:'list'}));
  }
 }finally{await fs.rm(directory,{recursive:true,force:true});}
});
