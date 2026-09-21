// SPDX-License-Identifier: GPL-3.0-only
const fs = require('node:fs/promises');
const {verifyEnvelope, verifyArtifact} = require('./release.cjs');
const REPOSITORY = 'Boof2015/astra-thing';
function allowed(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.hash || !['api.github.com','github.com','release-assets.githubusercontent.com','objects.githubusercontent.com'].includes(url.hostname)) throw Error('Unexpected firmware download address');
  return url;
}
async function response(url) {
  for (let count=0; count<5; count++) {
    allowed(url);
    const result = await fetch(url, {redirect:'manual', headers:{'User-Agent':'Astra-Thing-Manager',Accept:'application/octet-stream'}, signal:AbortSignal.timeout(120000)});
    if ([301,302,303,307,308].includes(result.status)) {await result.body?.cancel();url=new URL(result.headers.get('location'),url).href;continue;}
    if (result.status===404) throw Error('No public firmware release is available yet. You can choose a signed local release for testing.');
    if (!result.ok) throw Error(result.status===403||result.status===429?'Release checks are temporarily limited. Try again later.':'Firmware download failed. Try again.');
    return result;
  }
  throw Error('Too many firmware download redirects');
}
async function readJson(url, maximum) {
  const result=await response(url), chunks=[];let size=0;
  for await (const chunk of result.body) {size+=chunk.length;if(size>maximum)throw Error('Oversized release response');chunks.push(chunk);}
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
async function latest(trust) {
  const info=await readJson(`https://api.github.com/repos/${REPOSITORY}/releases/latest`,1024*1024);
  if(info.draft||info.prerelease||!Array.isArray(info.assets))throw Error('No stable firmware release is available yet');
  const asset=info.assets.find(a=>a.name==='release.json');
  if(!asset)throw Error('This release does not include signed firmware');
  const envelope=await readJson(asset.browser_download_url,150000);
  const manifest=verifyEnvelope(envelope,trust);
  if(manifest.channel!=='stable')throw Error('The latest release is not stable firmware');
  const urls={};
  for(const [kind,artifact] of Object.entries(manifest.artifacts)) {
    const file=info.assets.find(a=>a.name===artifact.file&&a.size===artifact.bytes);
    if(!file)throw Error('Release artifacts are incomplete');
    allowed(file.browser_download_url);urls[kind]=file.browser_download_url;
  }
  return {envelope,manifest,urls};
}
async function download(url, filename, artifact, onProgress) {
  const result=await response(url), handle=await fs.open(filename,'wx',0o600);
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
