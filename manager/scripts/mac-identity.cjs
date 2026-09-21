// SPDX-License-Identifier: GPL-3.0-only
// Packaged Electron launchers otherwise share LC_UUID across unrelated apps.
// Run before signing; never change a signed/distributed application in place.
'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

function assignUuid(input, identity) {
  const bytes = Buffer.from(input);
  const slices = [];
  const magic = bytes.readUInt32BE(0);
  if (magic === 0xcafebabe || magic === 0xcafebabf) {
    const count = bytes.readUInt32BE(4), stride = magic === 0xcafebabf ? 32 : 20;
    if (count < 1 || count > 8 || 8 + count * stride > bytes.length) throw Error('Invalid universal launcher');
    for (let i = 0; i < count; i++) {
      const at = 8 + i * stride;
      const start = stride === 32 ? Number(bytes.readBigUInt64BE(at + 8)) : bytes.readUInt32BE(at + 8);
      const size = stride === 32 ? Number(bytes.readBigUInt64BE(at + 16)) : bytes.readUInt32BE(at + 12);
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(size) || start < 8 + count * stride || size < 32 || start + size > bytes.length) throw Error('Invalid launcher slice');
      slices.push({start, size});
    }
  } else slices.push({start: 0, size: bytes.length});
  for (const {start, size} of slices) {
    if (size < 32 || bytes.readUInt32LE(start) !== 0xfeedfacf) throw Error('Expected a 64-bit Mach-O launcher');
    const count = bytes.readUInt32LE(start + 16), end = start + 32 + bytes.readUInt32LE(start + 20);
    if (count > 1024 || end > start + size) throw Error('Invalid launcher load commands');
    let at = start + 32, uuids = 0;
    for (let i = 0; i < count; i++) {
      if (at + 8 > end) throw Error('Truncated launcher load command');
      const command = bytes.readUInt32LE(at), length = bytes.readUInt32LE(at + 4);
      if (length < 8 || at + length > end) throw Error('Invalid launcher load command');
      if (command === 0x1b) {
        if (length !== 24) throw Error('Invalid build UUID');
        const uuid = crypto.createHash('sha256').update('astra-thing-manager-build-uuid-v1\0').update(identity).update(bytes.subarray(start + 4, start + 12)).update(bytes.subarray(at + 8, at + 24)).digest().subarray(0, 16);
        uuid.copy(bytes, at + 8); uuids++;
      }
      at += length;
    }
    if (uuids !== 1 || at !== end) throw Error('Expected one launcher build UUID');
  }
  return bytes;
}

async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return;
  const app = path.join(context.appOutDir, context.packager.appInfo.productFilename + '.app', 'Contents');
  const main = path.join(app, 'MacOS', context.packager.appInfo.productFilename);
  const sourceHash = crypto.createHash('sha256').update(await fs.readFile(path.join(app, 'Resources/app.asar'))).digest('hex');
  const identity = context.packager.appInfo.id + '\0' + sourceHash;
  await fs.writeFile(main, assignUuid(await fs.readFile(main), identity));
}
module.exports = afterPack;
module.exports.assignUuid = assignUuid;
