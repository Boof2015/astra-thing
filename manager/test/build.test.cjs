// SPDX-License-Identifier: GPL-3.0-only
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {buildTarget} = require('../scripts/build.cjs');

test('installer builds cannot silently bundle a USB worker for a different OS or architecture', () => {
  for (const [platform, target] of [['darwin', 'mac'], ['win32', 'win'], ['linux', 'linux']]) {
    for (const arch of ['arm64', 'x64']) {
      assert.deepEqual(buildTarget(undefined, platform, arch), {target, arch});
      assert.deepEqual(buildTarget(target, platform, arch), {target, arch});
      for (const other of ['mac', 'win', 'linux'].filter(t => t !== target)) {
        assert.throws(() => buildTarget(other, platform, arch), /native USB worker/);
      }
    }
    assert.throws(() => buildTarget(target, platform, 'ia32'), /Unsupported build host/);
  }
  assert.throws(() => buildTarget('invalid', 'win32', 'x64'), /Expected build target/);
});
