// SPDX-License-Identifier: GPL-3.0-only
// Publisher tooling only. Private keys never leave the local preparation step.
'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const {spawnSync} = require('node:child_process');
const {parseArgs} = require('node:util');
const {readEnvelope, verifyArtifact, hashFile} = require('../manager/main/release.cjs');
const root = path.resolve(__dirname, '..');
const repository = 'Boof2015/astra-thing';
const json = async file => JSON.parse(await fs.readFile(file, 'utf8'));
function run(command, args, capture = false) {
  const result = spawnSync(command, args, {cwd:root, encoding:'utf8', stdio:capture?['ignore','pipe','pipe']:'inherit'});
  if(result.error)throw result.error;
  if(result.status!==0)throw Error(capture ? result.stderr.trim() || `${command} failed` : `${command} failed; nothing was published`);
  return result.stdout?.trim();
}
const node = args => run(process.execPath,args);
const python = args => node(['scripts/run-python.cjs',...args]);
async function checksums(directory) {
  const files=(await fs.readdir(directory,{withFileTypes:true})).filter(f=>f.isFile()&&f.name!=='SHA256SUMS').map(f=>f.name).sort();
  await fs.writeFile(path.join(directory,'SHA256SUMS'),(await Promise.all(files.map(async name=>`${await hashFile(path.join(directory,name))}  ${name}`))).join('\n')+'\n');
}
async function verify(directory, {audit=false, images=true}={}) {
  const trust=await json(path.join(root,'release/trusted-keys.json'));
  const selected=await readEnvelope(path.join(directory,'release.json'),trust);
  const build=await json(path.join(directory,'build-inputs.json'));
  const provenance=await json(path.join(directory,'provenance.json'));
  const version=await json(path.join(root,'release/version.json'));
  const manifest=selected.manifest;
  if(build.version!==manifest.version||build.build!==manifest.build||version.version!==manifest.version||provenance.build!==build.build||provenance.version!==build.version||provenance.channel!==manifest.channel)throw Error('Release identities disagree');
  if(!/^[a-f0-9]{40}$/.test(provenance.commit)||run('git',['rev-parse','HEAD'],true)!==provenance.commit)throw Error('Check out the exact commit recorded in provenance.json before using this candidate');
  for(const file of ['package.json','manager/package.json'])if((await json(path.join(root,file))).version!==manifest.version)throw Error(`${file} version does not match firmware`);
  if(JSON.stringify(trust)!==JSON.stringify(await json(path.join(root,'prototype/trusted-keys.json'))))throw Error('Manager and firmware publisher keys differ');
  for(const artifact of Object.values(manifest.artifacts))await verifyArtifact(path.join(directory,artifact.file),artifact);
  const files=Object.fromEntries(Object.entries(manifest.artifacts).map(([kind,a])=>[kind,path.join(directory,a.file)]));
  if(images)python(['scripts/verify-release-images.py',files.flash,files.update,path.join(directory,'build-inputs.json'),...(audit?['--audit']:[]),'--report',path.join(directory,audit?'firmware-audit.json':'firmware-verification.json')]);
  return {manifest,provenance,tag:`v${manifest.version}-${manifest.build}`};
}
async function prepare(args) {
  const {values}=parseArgs({args,options:Object.fromEntries(['key','flash','update','build-record','output','channel'].map(name=>[name,{type:'string'}]))});
  if(run('git',['status','--porcelain'],true))throw Error('Commit your release changes first so CI can build exactly the same sources');
  const record=path.resolve(values['build-record']||path.join(root,'.local/release-build.json'));
  const build=await json(record), channel=values.channel||'stable';
  if(!['stable','preview'].includes(channel)||!/^\d+\.\d+\.\d+(?:-[a-z0-9.-]+)?$/.test(build.version)||!/^\d{14}$/.test(build.build))throw Error('Invalid release identity or channel');
  const deploy=path.join(root,'.local/yocto-superbird/build/tmp/deploy/images/superbird');
  const flash=path.resolve(values.flash||path.join(deploy,'astra-thing-image-superbird-flashthing.zip'));
  const update=path.resolve(values.update||path.join(deploy,'astra-thing-update-superbird.swu'));
  const output=path.resolve(values.output||path.join(root,'release-output',`astra-thing-${build.version}-${build.build}-${channel}`));
  const key=path.resolve(values.key||path.join(root,'.local/signing/astra-thing-release-private.pem'));
  // Reject stale artifacts before signing (a failed build can leave old deploy symlinks).
  python(['scripts/verify-release-images.py',flash,update,record]);
  await fs.mkdir(path.dirname(output),{recursive:true});
  node(['manager/scripts/sign-release.cjs',key,flash,update,record,output,channel]);
  python(['scripts/package-sources.py',path.join(output,'project-sources.tar.gz'),'--build-record',record]);
  await fs.writeFile(path.join(output,'provenance.json'),JSON.stringify({schema:1,commit:run('git',['rev-parse','HEAD'],true),version:build.version,build:build.build,channel},null,2)+'\n',{flag:'wx'});
  await verify(output,{images:false});
  await checksums(output);
  console.log(`Prepared ${output}\nNext: npm run release:draft -- "${output}"`);
}
async function draft(directory) {
  if(run('git',['status','--porcelain'],true))throw Error('Commit your release changes before uploading a candidate');
  const {manifest,provenance,tag}=await verify(directory);
  await fs.access(path.join(directory,'project-sources.tar.gz'));
  await checksums(directory);
  // Confirm the exact commit is available remotely before creating anything.
  const remote=JSON.parse(run('gh',['api',`repos/${repository}/commits/${provenance.commit}`],true));
  if(remote.sha!==provenance.commit)throw Error('Push the release commit before creating its draft');
  const workflow=JSON.parse(run('gh',['api',`repos/${repository}/actions/workflows/draft-release.yml`],true));
  if(workflow.state!=='active')throw Error('Push and enable the draft-release workflow first');
  const notes=path.join(directory,'DRAFT-NOTES.md');
  await fs.writeFile(notes,`Astra Thing ${manifest.version} · build ${manifest.build}\n\nThis candidate is a draft. Wait for the **Complete draft release** workflow to pass and attach the Manager installers before publishing.\n\nSource commit: ${provenance.commit}\nChannel: ${manifest.channel}\n\nBefore publication: test the exact firmware on hardware, finish Windows/Linux and stock-device onboarding checks, attach complete corresponding dependency sources/notices, and state the required Astra desktop release. macOS installers are ad-hoc signed; Windows installers are unsigned.\n\nThe Manager discovers only published stable releases in a public repository. It ignores drafts and prereleases.\n`);
  const listed=JSON.parse(run('gh',['release','list','--repo',repository,'--limit','1000','--json','tagName'],true));
  let existing;
  if(listed.some(r=>r.tagName===tag)){
    existing=JSON.parse(run('gh',['release','view',tag,'--repo',repository,'--json','isDraft,targetCommitish,isPrerelease,assets'],true));
    if(!existing.isDraft||existing.targetCommitish!==provenance.commit||existing.isPrerelease!==(manifest.channel==='preview'))throw Error('This tag already belongs to a different candidate or a published release');
  }else{
    run('gh',['release','create',tag,'--repo',repository,'--target',provenance.commit,'--draft','--title',`Astra Thing ${manifest.version} · ${manifest.build}`,'--notes-file',notes,...(manifest.channel==='preview'?['--prerelease']:[])]);
  }
  // Resume an interrupted upload without replacing any firmware. CI owns final checksums.
  const assets=['release.json','build-inputs.json','provenance.json','project-sources.tar.gz','firmware-verification.json','DRAFT-NOTES.md',...Object.values(manifest.artifacts).map(a=>a.file)];
  const temporary=await fs.mkdtemp(path.join(os.tmpdir(),'astra-draft-'));
  try{
    for(const name of assets){
      const remoteAsset=existing?.assets.find(a=>a.name===name);
      if(remoteAsset){
        const copy=path.join(temporary,name);
        run('gh',['release','download',tag,'--repo',repository,'--pattern',name,'--output',copy]);
        if(await hashFile(copy)!==await hashFile(path.join(directory,name)))throw Error('The draft already contains different bytes: '+name);
      }else{
        const current=JSON.parse(run('gh',['release','view',tag,'--repo',repository,'--json','isDraft'],true));
        if(!current.isDraft)throw Error('The release was published during upload; stopping');
        run('gh',['release','upload',tag,path.join(directory,name),'--repo',repository]);
      }
    }
  }finally{await fs.rm(temporary,{recursive:true,force:true});}
  // The workflow generates SHA256SUMS only after all firmware and installers are present.
  run('gh',['workflow','run','draft-release.yml','--repo',repository,'-f',`tag=${tag}`]);
  console.log(`Draft created: https://github.com/${repository}/releases/tag/${tag}\nCI will audit the firmware and attach Manager installers. Publish manually after testing.`);
}
async function main() {
  const [command,...args]=process.argv.slice(2);
  if(command==='prepare')return prepare(args);
  if(command==='draft'&&args.length===1)return draft(path.resolve(args[0]));
  if(command==='verify'&&args[0]&&args.slice(1).every(a=>a==='--audit'))return verify(path.resolve(args[0]),{audit:args.includes('--audit')});
  if(command==='checksums'&&args.length===1)return checksums(path.resolve(args[0]));
  throw Error('Use release:prepare [--key PATH --channel stable|preview], release:draft DIRECTORY, or release:verify DIRECTORY [--audit]');
}
if(require.main===module)main().catch(error=>{console.error(error.message);process.exitCode=1;});
module.exports={verify,checksums};
