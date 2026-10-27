// SPDX-License-Identifier: GPL-3.0-only
'use strict';
const fs=require('node:fs/promises');
const path=require('node:path');
const {execFileSync}=require('node:child_process');
const {checksums}=require('./release.cjs');
const {hashFile}=require('../manager/main/release.cjs');
const repository='Boof2015/astra-thing';
function gh(args){return execFileSync('gh',args,{encoding:'utf8'}).trim();}
function candidate(tag){
  if(!/^v\d+\.\d+\.\d+(?:-[a-z0-9.-]+)?-\d{14}$/.test(tag))throw Error('Invalid release tag');
  // REST's /releases/tags endpoint does not resolve unpublished draft tags.
  const release=JSON.parse(gh(['release','view',tag,'--repo',repository,'--json','isDraft,isPrerelease,targetCommitish']));
  if(!release.isDraft||!/^[a-f0-9]{40}$/.test(release.targetCommitish))throw Error('Expected an unpublished draft targeting an exact source commit');
  return release;
}
async function main(){
  const [command,tag,directory]=process.argv.slice(2), release=candidate(tag);
  if(command==='inspect'){
    await fs.appendFile(process.env.GITHUB_OUTPUT,`commit=${release.targetCommitish}\n`);return;
  }
  if(command==='check'){
    const provenance=JSON.parse(await fs.readFile(path.join(directory,'provenance.json')));
    if(provenance.commit!==release.targetCommitish||tag!==`v${provenance.version}-${provenance.build}`||release.isPrerelease!==(provenance.channel==='preview'))throw Error('Draft metadata and signed candidate disagree');
    return;
  }
  if(command==='finish'){
    const files=await fs.readdir(directory);
    for(const extension of ['.dmg','.exe','.AppImage','.deb'])if(!files.some(f=>f.endsWith(extension)))throw Error('Missing Manager installer: '+extension);
    const audit=JSON.parse(await fs.readFile(path.join(directory,'firmware-audit.json')));
    if(!audit.rootsAndBrandingAudited)throw Error('Firmware audit did not complete');
    // The freshly regenerated source export must equal the local candidate export.
    if(await hashFile(path.join(directory,'project-sources.tar.gz'))!==await hashFile(path.join(directory,'project-sources-ci.tar.gz')))throw Error('Published project sources differ from the release commit');
    await fs.unlink(path.join(directory,'project-sources-ci.tar.gz'));
    await checksums(directory);
    const additions=(await fs.readdir(directory)).filter(f=>f==='SHA256SUMS'||f==='firmware-audit.json'||/\.(dmg|exe|AppImage|deb)$/.test(f));
    // Recheck immediately before mutation. A published release is never overwritten.
    candidate(tag);
    gh(['release','upload',tag,...additions.map(f=>path.join(directory,f)),'--repo',repository,'--clobber']);
    await fs.appendFile(process.env.GITHUB_STEP_SUMMARY,`## Draft ready for hardware testing\n\n[Open ${tag}](https://github.com/${repository}/releases/tag/${tag})\n\nFirmware identity, both first-install roots, update root, boot logos, splash screens, source export and signatures passed. macOS, Windows and Linux Manager installers are attached. Nothing was published. Hardware and platform acceptance checks still apply.\n`);
    return;
  }
  throw Error('Expected inspect, check or finish');
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
