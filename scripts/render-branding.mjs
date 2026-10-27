// Export the supplied vector paths directly; no fonts or image-generation step.
import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const require=createRequire(path.join(root,'tools/branding/package.json'));
const {Resvg}=require('@resvg/resvg-js');
const source=await readFile(path.join(root,'branding/astra-full.svg'),'utf8');
const opening=source.match(/<svg\b[^>]*>/);
const viewBox=opening?.[0].match(/\bviewBox="([^"]+)"/)?.[1].trim().split(/[\s,]+/).map(Number);
if(!viewBox||viewBox.length!==4||!viewBox.every(Number.isFinite)||viewBox[2]<=0||viewBox[3]<=0||/<(?:script|image|text|foreignObject)\b/i.test(source))throw new Error('Expected a path-only Astra lockup with a valid viewBox');
// Preserve the supplied viewBox origin and aspect ratio. New lockups need not
// share the old 1625×182 dimensions or use percentage width/height attributes.
const width=Math.min(520,280*viewBox[2]/viewBox[3]),height=width*viewBox[3]/viewBox[2];
const positioned=opening[0].replace(/\s(?:x|y|width|height)="[^"]*"/g,'')
  .replace(/>$/,` x="${(800-width)/2}" y="${(480-height)/2}" width="${width}" height="${height}">`);
const lockup=source.slice(opening.index).replace(opening[0],positioned);
const frame=`<rect width="800" height="480" fill="#000"/>${lockup}`;
const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="800" height="480">${frame}</svg>`;
const options={font:{loadSystemFonts:false}};
const splash=new Resvg(svg,options).render();
// Rotate the rendered splash, so antialiasing is identical across boot stages.
const portrait=`<svg xmlns="http://www.w3.org/2000/svg" width="480" height="800"><image width="800" height="480" image-rendering="optimizeSpeed" transform="translate(480 0) rotate(90)" href="data:image/png;base64,${splash.asPng().toString('base64')}"/></svg>`;
const boot=new Resvg(portrait,options).render();
// RGB565, positive height/bottom-up rows, BI_BITFIELDS. This matches the
// installed panel's 16-bit boot format and clockwise portrait orientation.
const stride=(boot.width*2+3)&~3,offset=66,pixels=boot.pixels;
const bmp=Buffer.alloc(offset+stride*boot.height);
bmp.write('BM');bmp.writeUInt32LE(bmp.length,2);bmp.writeUInt32LE(offset,10);
bmp.writeUInt32LE(40,14);bmp.writeInt32LE(boot.width,18);bmp.writeInt32LE(boot.height,22);
bmp.writeUInt16LE(1,26);bmp.writeUInt16LE(16,28);bmp.writeUInt32LE(3,30);bmp.writeUInt32LE(stride*boot.height,34);
bmp.writeUInt32LE(0xf800,54);bmp.writeUInt32LE(0x07e0,58);bmp.writeUInt32LE(0x001f,62);
for(let y=0;y<boot.height;y++)for(let x=0;x<boot.width;x++){
  const i=(y*boot.width+x)*4;
  const value=(Math.round(pixels[i]*31/255)<<11)|(Math.round(pixels[i+1]*63/255)<<5)|Math.round(pixels[i+2]*31/255);
  bmp.writeUInt16LE(value,offset+(boot.height-1-y)*stride+x*2);
}
const output=path.join(root,'branding/generated');await mkdir(output,{recursive:true});
await writeFile(path.join(output,'splash.png'),splash.asPng());
await writeFile(path.join(output,'logo.bmp'),bmp);
await mkdir(path.join(root,'.local'),{recursive:true});
await writeFile(path.join(root,'.local/astra-boot-portrait.png'),boot.asPng());
await copyFile(path.join(root,'branding/astra-full.svg'),path.join(root,'prototype/web/assets/astra-full.svg'));
await copyFile(path.join(root,'branding/astra-full.svg'),path.join(root,'manager/renderer/astra-wordmark.svg'));
const sha=data=>createHash('sha256').update(data).digest('hex');
await writeFile(path.join(output,'manifest.json'),JSON.stringify({
  renderer:'@resvg/resvg-js 2.6.2',sourceSha256:sha(source),sourceViewBox:viewBox,
  landscape:{width:800,height:480,lockupWidth:width,lockupHeight:height,background:'#000000'},
  boot:{width:480,height:800,rotation:'90 degrees clockwise',format:'RGB565 BMP'},
  files:{'logo.bmp':sha(bmp),'splash.png':sha(splash.asPng())}
},null,2)+'\n');
console.log(`Exported 800×480 splash and 480×800 RGB565 boot logo; lockup ${width}×${height.toFixed(2)} px.`);
