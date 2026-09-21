const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const crypto=require('node:crypto');
const {allowed,download}=require('../main/download.cjs');
test('download addresses stay on HTTPS release hosts',()=>{
 assert.equal(allowed('https://github.com/Boof2015/astra-thing/releases/download/v1/file').hostname,'github.com');
 for(const url of ['http://github.com/file','https://evil.example/file','https://secret@github.com/file','file:///tmp/package'])assert.throws(()=>allowed(url));
});
test('a download must have the signed length and hash',async()=>{
 const original=global.fetch,directory=await fs.mkdtemp(path.join(os.tmpdir(),'astra-download-'));
 try {
  const bytes=Buffer.from('signed contents'),artifact={bytes:bytes.length,sha256:crypto.createHash('sha256').update(bytes).digest('hex')};
  global.fetch=async()=>new Response(bytes,{status:200});
  await download('https://github.com/file',path.join(directory,'good'),artifact);
  global.fetch=async()=>new Response(Buffer.from('changed content'),{status:200});
  await assert.rejects(download('https://github.com/file',path.join(directory,'bad'),artifact));
  global.fetch=async()=>new Response(Buffer.alloc(100),{status:200});
  await assert.rejects(download('https://github.com/file',path.join(directory,'long'),artifact),/signed size/);
 }finally{global.fetch=original;await fs.rm(directory,{recursive:true,force:true});}
});
