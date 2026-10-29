// SPDX-License-Identifier: GPL-3.0-only
// Uses the installed Manager's anonymous download path. Never contacts hardware.
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const {latest,download}=require('../manager/main/download.cjs');
async function main(){
  const trust=JSON.parse(await fs.readFile(path.join(__dirname,'../release/trusted-keys.json')));
  const selected=await latest(trust),tag=selected.tag;
  if(process.env.EXPECTED_RELEASE_TAG&&process.env.EXPECTED_RELEASE_TAG!==tag)throw Error('This is not the most recently published stable firmware release. Check the firmware tag and publication date.');
  const temporary=await fs.mkdtemp(path.join(os.tmpdir(),'astra-feed-check-'));
  try{
    for(const [kind,artifact] of Object.entries(selected.manifest.artifacts)){
      await download(selected.urls[kind],path.join(temporary,artifact.file),artifact);
      console.log(`Verified public ${kind} download: ${artifact.file}`);
    }
    console.log(`Manager feed passed for ${tag}. No hardware was contacted.`);
  }finally{await fs.rm(temporary,{recursive:true,force:true});}
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
