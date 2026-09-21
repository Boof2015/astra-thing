const {test} = require('node:test');
const assert = require('node:assert/strict');
const {assignUuid} = require('../scripts/mac-identity.cjs');
test('packaged applications receive distinct build identities without changing executable code',()=>{
 const original=Buffer.alloc(80,0);original.writeUInt32LE(0xfeedfacf,0);original.writeUInt32LE(0x100000c,4);original.writeUInt32LE(1,16);original.writeUInt32LE(24,20);original.writeUInt32LE(0x1b,32);original.writeUInt32LE(24,36);original.fill(0xaa,40,56);original.fill(0xcc,56);
 const a=assignUuid(original,'app-a'),b=assignUuid(original,'app-b');
 assert.notDeepEqual(a.subarray(40,56),original.subarray(40,56));assert.notDeepEqual(a,b);assert.deepEqual(assignUuid(original,'app-a'),a);
 assert.deepEqual(a.subarray(0,40),original.subarray(0,40));assert.deepEqual(a.subarray(56),original.subarray(56));
 const broken=Buffer.from(original);broken.writeUInt32LE(300,36);assert.throws(()=>assignUuid(broken,'app-a'),/command/);
});
