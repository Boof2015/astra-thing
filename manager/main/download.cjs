// SPDX-License-Identifier: GPL-3.0-only
const fs = require('node:fs/promises');
const {verifyEnvelope, verifyArtifact} = require('./release.cjs');
const REPOSITORY = 'Boof2015/astra-thing';
function allowed(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.hash || !['api.github.com','github.com','release-assets.githubusercontent.com','objects.githubusercontent.com'].includes(url.hostname)) throw Error('Unexpected firmware download address');
  return url;
}
async function response(url, accept = 'application/octet-stream', timeoutMs = 120000) {
  for (let count=0; count<5; count++) {
    allowed(url);
    const result = await fetch(url, {redirect:'manual', headers:{'User-Agent':'Astra-Thing-Manager',Accept:accept}, signal:AbortSignal.timeout(timeoutMs)});
    if ([301,302,303,307,308].includes(result.status)) {
      await result.body?.cancel();
      const location=result.headers.get('location');
      if(!location)throw Error('Firmware download redirect is missing its address');
      url=new URL(location,url).href;continue;
    }
    if (result.status===404) throw Error('No public firmware release is available yet. You can choose a signed local release for testing.');
    if (!result.ok) throw Error(result.status===403||result.status===429?'Release checks are temporarily limited. Try again later.':'Firmware download failed. Try again.');
    return result;
  }
  throw Error('Too many firmware download redirects');
}
async function readJson(url, maximum) {
  const result=await response(url,'application/json'), chunks=[];let size=0;
  for await (const chunk of result.body) {size+=chunk.length;if(size>maximum)throw Error('Oversized release response');chunks.push(chunk);}
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
async function latest(trust) {
  // Manager releases can be newer than firmware. Scan the paginated release
  // list and use publication time, independent of GitHub's "latest" badge.
  let info;
  for(let page=1; ; page++) {
    if(page>10)throw Error('Too many releases to check. Try a signed local firmware release.');
    const releases=await readJson(`https://api.github.com/repos/${REPOSITORY}/releases?per_page=100&page=${page}`,5*1024*1024);
    if(!Array.isArray(releases))throw Error('Invalid firmware release listing');
    for(const item of releases) {
      if(!item||item.draft||item.prerelease||!/^firmware-v\d+\.\d+\.\d+-\d{14}$/.test(item.tag_name)||!Number.isFinite(Date.parse(item.published_at)))continue;
      if(!info||Date.parse(item.published_at)>Date.parse(info.published_at))info=item;
    }
    if(releases.length<100)break;
  }
  if(!info)throw Error('No stable firmware release is available yet. You can choose a signed local release for testing.');
  if(!Array.isArray(info.assets))throw Error('Release artifacts are incomplete');
  const asset=info.assets.find(a=>a.name==='release.json'&&a.state==='uploaded'&&a.size>0&&a.size<=150000);
  if(!asset)throw Error('This release does not include signed firmware');
  const envelope=await readJson(asset.browser_download_url,150000);
  const manifest=verifyEnvelope(envelope,trust);
  if(manifest.channel!=='stable')throw Error('The latest release is not stable firmware');
  if(info.tag_name!==`firmware-v${manifest.version}-${manifest.build}`)throw Error('Firmware release tag does not match its signed version and build');
  const urls={};
  for(const [kind,artifact] of Object.entries(manifest.artifacts)) {
    const file=info.assets.find(a=>a.name===artifact.file&&a.state==='uploaded'&&a.size===artifact.bytes);
    if(!file)throw Error('Release artifacts are incomplete');
    allowed(file.browser_download_url);urls[kind]=file.browser_download_url;
  }
  return {envelope,manifest,urls,tag:info.tag_name};
}
async function download(url, filename, artifact, onProgress) {
  // The ~400 MB first-install archive needs longer than a metadata request on slower connections.
  const result=await response(url,'application/octet-stream',30*60*1000), handle=await fs.open(filename,'wx',0o600);
  let size=0;
  try {
    for await(const chunk of result.body) {
      size+=chunk.length;if(size>artifact.bytes)throw Error('Firmware download exceeds its signed size');
      await handle.writeFile(chunk);onProgress?.(size,artifact.bytes);
    }
    await handle.sync();
  } finally {await handle.close();}
  await verifyArtifact(filename,artifact);
}
module.exports={latest,download,allowed};
