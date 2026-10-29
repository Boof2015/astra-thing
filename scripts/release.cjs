// SPDX-License-Identifier: GPL-3.0-only
// Publisher tooling only. Private keys never leave the local preparation step.
'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const {parseArgs} = require('node:util');
const {readEnvelope, verifyArtifact, hashFile} = require('../manager/main/release.cjs');
const root = path.resolve(__dirname, '..');
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
  const manifest=selected.manifest;
  if(build.version!==manifest.version||build.build!==manifest.build||provenance.build!==build.build||provenance.version!==build.version||provenance.channel!==manifest.channel)throw Error('Release identities disagree');
  if(!/^[a-f0-9]{40}$/.test(provenance.commit))throw Error('Invalid firmware source commit');
  if(JSON.stringify(trust)!==JSON.stringify(await json(path.join(root,'prototype/trusted-keys.json'))))throw Error('Manager and firmware publisher keys differ');
  for(const artifact of Object.values(manifest.artifacts))await verifyArtifact(path.join(directory,artifact.file),artifact);
  const files=Object.fromEntries(Object.entries(manifest.artifacts).map(([kind,a])=>[kind,path.join(directory,a.file)]));
  if(images)python(['scripts/verify-release-images.py',files.flash,files.update,path.join(directory,'build-inputs.json'),...(audit?['--audit']:[]),'--report',path.join(directory,audit?'firmware-audit.json':'firmware-verification.json')]);
  return {manifest,provenance,tag:`firmware-v${manifest.version}-${manifest.build}`};
}
async function prepare(args) {
  const {values}=parseArgs({args,options:Object.fromEntries(['key','flash','update','build-record','output','channel'].map(name=>[name,{type:'string'}]))});
  if(run('git',['status','--porcelain'],true))throw Error('Commit your changes first so the firmware source archive has a recorded revision');
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
  console.log(`Prepared ${output}\nCreate a GitHub firmware release tagged firmware-v${build.version}-${build.build}.\nUpload release.json and the ZIP/SWU from this directory, plus the source archive and build records. Publish when ready.`);
}
async function main() {
  const [command,...args]=process.argv.slice(2);
  if(command==='prepare')return prepare(args);
  if(command==='verify'&&args[0]&&args.slice(1).every(a=>a==='--audit'))return verify(path.resolve(args[0]),{audit:args.includes('--audit')});
  if(command==='checksums'&&args.length===1)return checksums(path.resolve(args[0]));
  throw Error('Use release:prepare [--key PATH --channel stable|preview], release:verify DIRECTORY [--audit]');
}
if(require.main===module)main().catch(error=>{console.error(error.message);process.exitCode=1;});
module.exports={verify,checksums};
