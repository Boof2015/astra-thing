const {test} = require('node:test');
const assert = require('node:assert/strict');
const {Controller, usbEndpoints, candidatesFor} = require('../main/controller.cjs');
const crypto = require('node:crypto');
test('discovery merges the same USB device without hiding another Thing',()=>{
 const id=crypto.createHash('sha256').update('astra-thing:example').digest('hex').slice(0,32);
 const normal=[{id,mode:'astra',endpoint:{}}];
 const other={id:'1:2',mode:'astra',serial:'second'};
 assert.deepEqual(candidatesFor(normal,[{id:'1:1',mode:'astra',serial:'example'},other]),[...normal,other]);
});
test('USB fallback probes only the device address of an attached BSP subnet',()=>{
 assert.deepEqual(usbEndpoints({usb:[{family:'IPv4',address:'10.42.1.238',netmask:'255.255.255.248',internal:false}],wifi:[{family:'IPv4',address:'192.168.1.8',netmask:'255.255.255.0',internal:false}]}),[{host:'10.42.1.234',port:8843}]);
 assert.deepEqual(usbEndpoints({wrong:[{family:'IPv4',address:'10.42.1.8',netmask:'255.255.255.0',internal:false}]}),[]);
});
function fixture() {const c=new Controller({directory:'/unused',version:'0.3.0',dialogs:{},secureStore:{}});c.persist=async()=>{};return c;}
test('changed discovery records replace stale endpoints without granting access',()=>{
 const c=fixture();
 const service={fqdn:'Thing._astra-thing._tcp.local',port:8843,txt:{profile:'astra-thing-management-v1',modelId:'astra-thing',deviceId:'a'.repeat(32),address:'10.42.1.234'}};
 c.discovered(service,'usb/Thing');assert.equal(c.endpoints.get('usb/Thing').host,'10.42.1.234');
 c.discovered({...service,txt:{...service.txt,address:'10.42.1.10'}},'usb/Thing');assert.equal(c.endpoints.get('usb/Thing').host,'10.42.1.10');
 assert.deepEqual(c.credentials,{});
 c.discovered({...service,port:9999},'usb/Thing');assert.equal(c.endpoints.size,0);
});
const device={id:'a'.repeat(32),mode:'astra',endpoint:{host:'10.42.1.2',port:8843},data:{version:'0.3.0',build:'20260912000000',healthy:true}};
test('same or older releases do not offer an update',()=>{
 const c=fixture();c.current=device;
 for(const manifest of [{version:'0.3.0',build:'20260912000000'},{version:'0.2.0',build:'20260913000000'}]) {c.release={manifest};c.reviewUpdate();assert.equal(c.state.step,'upToDate');}
 c.release={manifest:{version:'0.3.0',build:'20260913000000'}};c.reviewUpdate();assert.equal(c.state.step,'updateReview');
});
test('a development-device screen advances when maintenance becomes available',()=>{const c=fixture();c.state.step='legacy';c.detect(device);assert.equal(c.state.step,'authorize');});
test('unauthorized discovery never confirms successful installation',()=>{
 const c=fixture();c.state.step='reboot';c.expected={version:'0.3.0',build:'20260912000000'};c.detect(device);
 assert.equal(c.state.step,'authorize');assert.ok(c.expected);
 c.credentials[device.id]={token:'private'};c.detect(device);assert.equal(c.state.step,'done');assert.equal(c.expected,null);
});
test('stored access cannot substitute for a successful authenticated status check',()=>{
 const c=fixture();c.state.step='reboot';c.credentials[device.id]={token:'old'};c.expected={version:'0.3.0',build:'20260912000000'};
 c.detect({...device,authenticated:false});assert.ok(c.expected);assert.equal(c.state.step,'authorize');
});
test('update needs the expected device, operation, version, build and healthy startup',()=>{
 const c=fixture();c.state.step='updateRestart';c.credentials[device.id]={token:'private'};c.operation='operation';c.expected={deviceId:device.id,version:'0.3.0',build:'20260912000000'};
 for(const patch of [{operation:{id:'other',phase:'complete'}},{operation:{id:'operation',phase:'installing'}},{operation:{id:'operation',phase:'complete'},healthy:false},{operation:{id:'operation',phase:'complete'},build:'20260911000000'}]) {
  c.detect({...device,data:{...device.data,...patch}});assert.ok(c.expected);
 }
 c.detect({...device,data:{...device.data,operation:{id:'operation',phase:'complete'}}});assert.equal(c.state.step,'manage');assert.equal(c.expected,null);
});
test('authenticated operation status reconciles a lost upload response',()=>{
 const c=fixture();c.state.step='error';c.state.error='Thing connection timed out';c.credentials[device.id]={};c.operation='operation';c.expected={deviceId:device.id,version:'0.3.0',build:'20260912000000'};
 c.detect({...device,data:{...device.data,operation:{id:'operation',phase:'installing',message:'Installing the verified firmware'}}});
 assert.equal(c.state.step,'updateRestart');assert.equal(c.state.error,'');assert.equal(c.state.stage,'Installing the verified firmware');assert.ok(c.expected);
 c.detect({...device,data:{...device.data,operation:{id:'operation',phase:'complete'}}});assert.equal(c.state.step,'manage');assert.equal(c.state.error,'');
});
test('rollback is visible and a backup cannot authorize a new USB session',()=>{
 const c=fixture();c.state.step='updateRestart';c.credentials[device.id]={};c.operation='operation';c.expected={deviceId:device.id,version:'0.3.0',build:'20260912000000'};
 c.detect({...device,data:{...device.data,operation:{id:'operation',phase:'rolled-back',message:'Previous firmware restored'}}});assert.equal(c.state.step,'error');assert.equal(c.state.error,'Previous firmware restored');
 c.backup={directory:'/backup',target:{bus:1,ports:[1]}};c.state.device='recovery';c.state.backup=true;c.state.step='review';c.detect(null);assert.equal(c.backup,null);assert.equal(c.state.backup,false);
});
