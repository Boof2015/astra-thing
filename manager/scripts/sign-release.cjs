// SPDX-License-Identifier: GPL-3.0-only
// Publisher utility. Never invoked by the installed manager.
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const {hashFile, validate, verifyEnvelope} = require('../main/release.cjs');
async function main() {
  const [keyFile, flashFile, updateFile, buildFile, output] = process.argv.slice(2);
  if (!output) throw Error('Usage: node sign-release.cjs PRIVATE_KEY FLASH_ZIP UPDATE_SWU BUILD_RECORD OUTPUT_DIRECTORY');
  const root = path.resolve(__dirname, '../..');
  const release = JSON.parse(await fs.readFile(path.join(root, 'release/version.json'), 'utf8'));
  const build = JSON.parse(await fs.readFile(buildFile, 'utf8'));
  if (build.version !== release.version || !/^\d{14}$/.test(build.build) || !build.upstream || !Object.keys(build.inputs || {}).length) throw Error('Build identity is incomplete');
  const manifest = {...release, schema: 1, build: build.build, artifacts: {}};
  for (const [kind, file, extension] of [['flash',flashFile,'zip'],['update',updateFile,'swu']]) {
    const stat = await fs.stat(file);
    manifest.artifacts[kind] = {file: `astra-thing-${release.version}-${build.build}.${extension}`, bytes: stat.size, sha256: await hashFile(file)};
  }
  validate(manifest);
  const privateKey = crypto.createPrivateKey(await fs.readFile(keyFile));
  const publicKey = crypto.createPublicKey(privateKey);
  const keyId = crypto.createHash('sha256').update(publicKey.export({type:'spki',format:'der'})).digest('hex');
  const payload = Buffer.from(JSON.stringify(manifest));
  const envelope = {schema:1,keyId,payload:payload.toString('base64url'),signature:crypto.sign('sha256',payload,{key:privateKey,padding:crypto.constants.RSA_PKCS1_PADDING}).toString('base64url')};
  verifyEnvelope(envelope, JSON.parse(await fs.readFile(path.join(root, 'release/trusted-keys.json'), 'utf8')));
  await fs.mkdir(output, {recursive: false});
  for (const [kind, source] of [['flash',flashFile],['update',updateFile]]) await fs.copyFile(source, path.join(output, manifest.artifacts[kind].file), require('node:fs').constants.COPYFILE_EXCL);
  await fs.writeFile(path.join(output, 'release.json'), JSON.stringify(envelope, null, 2)+'\n', {flag:'wx'});
  await fs.copyFile(buildFile, path.join(output, 'build-inputs.json'), require('node:fs').constants.COPYFILE_EXCL);
  console.log('Signed release staged at ' + output + '. Nothing published.');
}
main().catch(error => {console.error(error.message); process.exitCode = 1;});
