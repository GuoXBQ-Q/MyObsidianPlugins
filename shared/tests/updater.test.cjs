const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs/promises'), os = require('node:os'), path = require('node:path');
const {inflateRawSync} = require('node:zlib');
const {FILES, readRelease, compareVersions} = require('../update-format');
const {unpackZip} = require('../update-zip');
const {createFileInstaller} = require('../update-files');
const {UpdateController} = require('../update-controller');
const {validateUpgrade} = require('../../scripts/check-plugin-release.cjs');

const {archive, pluginFiles, releaseFor, digest}=require("./fixtures.cjs");
async function fixture(t, {id = 'home-widgets', request, io, timeout} = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(),'obsidian-update-'));
  t.after(() => fs.rm(root,{recursive:true,force:true}));
  const directory = path.join(root,'.custom-config','plugins',id); await fs.mkdir(directory,{recursive:true});
  const old = pluginFiles(id,'0.1.0'), next = pluginFiles(id,'0.2.0'), zip = archive(next), release = releaseFor(id,'0.2.0','1.5.0',zip);
  for (const name of FILES) await fs.writeFile(path.join(directory,name),old[name]);
  await fs.writeFile(path.join(directory,'data.json'),'USER DATA'); await fs.writeFile(path.join(root,'calendar.md'),'USER NOTE');
  const notices = [], requests = [];
  const controller = new UpdateController({id, version:'0.1.0', appVersion:'1.8.0',
    io:io || createFileInstaller(directory), digest, unpack:bytes=>unpackZip(bytes,inflateRawSync), notify:message=>notices.push(message), timeout,
    request:request || (async params => { requests.push(params.url); return params.url.includes('/releases/latest') ? {status:200,json:release} : {status:200,arrayBuffer:zip}; })});
  t.after(() => controller.dispose()); await controller.initialize(false);
  return {controller, root, directory, old, next, zip, release, notices, requests};
}

test('semantic versions compare numerically and reject unsupported forms', () => {
  assert.equal(compareVersions('0.10.0','0.9.9'),1); assert.equal(compareVersions('2.0.0','2.0.0'),0); assert.equal(compareVersions('1.0.0','2.0.0'),-1);
  for (const v of ['01.2.3','1.2','1.2.3-beta','9007199254740992.0.0']) assert.throws(()=>compareVersions(v,'1.0.0'));
});
test('metadata selects only its own plugin and requires stable compatible authenticated-content metadata', () => {
  const release = releaseFor(); assert.equal(readRelease(release,'home-widgets','1.8.0').compatible,true);
  assert.equal(readRelease(release,'home-widgets','1.4.0').compatible,false);
  assert.throws(()=>readRelease(release,'my-calendar','1.8.0'),/缺少插件/);
  for (const patch of [{draft:true},{prerelease:true},{body:'legacy release'},{assets:[]}]) assert.throws(()=>readRelease({...release,...patch},'home-widgets','1.8.0'));
  for (const patch of [{digest:null},{name:'wrong.zip'},{browser_download_url:'https://example.com/file.zip'},{size:40*1024*1024}]) {
    assert.throws(()=>readRelease({...release,assets:[{...release.assets[0],...patch}]},'home-widgets','1.8.0'));
  }
});
test('ZIP decoder accepts stored/deflated files and rejects extra files, traversal, CRC corruption and oversized expansion', () => {
  for (const method of [0,8]) assert.deepEqual(unpackZip(archive(pluginFiles(),method),inflateRawSync),pluginFiles());
  assert.throws(()=>unpackZip(archive({...pluginFiles(),'data.json':Buffer.from('oops')}),inflateRawSync));
  const bad = pluginFiles(); bad['../main.js'] = bad['main.js']; delete bad['main.js'];
  assert.throws(()=>unpackZip(archive(bad),inflateRawSync));
  const corrupt = archive(pluginFiles(),0); corrupt[40] ^= 1; assert.throws(()=>unpackZip(corrupt,inflateRawSync));
  const huge = archive(pluginFiles()), central = huge.indexOf(Buffer.from('504b0102','hex')); huge.writeUInt32LE(40*1024*1024,central+24);
  assert.throws(()=>unpackZip(huge,inflateRawSync),/大小/);
});
test('independent plugins install from a non-default config directory, preserve data and activate after restart', async t => {
  for (const id of ['home-widgets','my-calendar']) {
    const f = await fixture(t,{id}); await f.controller.check();
    assert.equal(f.requests.length,1); assert.equal(f.notices.length,1);
    await f.controller.check(false); assert.equal(f.notices.length,1);
    await Promise.all([f.controller.install(),f.controller.install()]);
    assert.equal(f.requests.filter(url=>url.endsWith('.zip')).length,1);
    assert.equal(f.controller.version,'0.1.0'); assert.equal(f.controller.installedVersion,'0.2.0'); assert(f.controller.pendingRestart);
    for (const name of FILES) { assert.deepEqual(await fs.readFile(path.join(f.directory,name)),f.next[name]); assert.deepEqual(await fs.readFile(path.join(f.directory,'.github-updater','backup',name)),f.old[name]); }
    assert.equal(await fs.readFile(path.join(f.directory,'data.json'),'utf8'),'USER DATA'); assert.equal(await fs.readFile(path.join(f.root,'calendar.md'),'utf8'),'USER NOTE');
    await f.controller.install(); assert.equal(f.requests.length,3);
    f.controller.dispose();
    const restart = new UpdateController({id, version:'0.2.0', appVersion:'1.8.0',io:createFileInstaller(f.directory)});
    await restart.initialize(false); assert.equal(restart.pendingRestart,false); assert.equal(restart.state.notifiedVersion,'0.2.0'); restart.dispose();
  }
});
test('same version, newer local version and incompatible app cannot install', async t => {
  const f = await fixture(t);
  for (const local of ['0.2.0','0.3.0']) { f.controller.installedVersion = local; f.controller.version = local; await f.controller.check(); assert.equal(f.controller.candidate,null); }
  f.controller.version = f.controller.installedVersion = '0.1.0'; f.controller.appVersion = '1.4.0'; await f.controller.check(); assert.equal(f.controller.candidate.compatible,false); await f.controller.install(); assert.equal(f.requests.filter(url=>url.endsWith('.zip')).length,0);
});
test('bad SHA-256 and manifest mismatch leave installed files intact', async t => {
  const f = await fixture(t); f.release.assets[0].digest = 'sha256:'+'0'.repeat(64);
  await f.controller.check(); await f.controller.install(); assert.match(f.controller.status,/校验失败/);
  for (const name of FILES) assert.deepEqual(await fs.readFile(path.join(f.directory,name)),f.old[name]);
  f.release.assets[0].digest = 'sha256:'+digest(f.zip); await f.controller.check(); f.controller.candidate.version = '0.3.0';
  await f.controller.install(); assert.match(f.controller.status,/manifest/);
});
test('network errors and timeout are surfaced; background errors do not notify', async t => {
  for (const status of [403,429,404,500]) {
    const f = await fixture(t,{request:async()=>({status})}); await f.controller.check(false); assert.equal(f.notices.length,0); assert.match(f.controller.status,/失败/); await f.controller.check(); assert.equal(f.notices.length,1);
  }
  const f = await fixture(t,{request:()=>new Promise(()=>{}),timeout:5}); await f.controller.check(); assert.match(f.controller.status,/超时/);
});
test('disposing during a download prevents any installation', async t => {
  let finish; const f = await fixture(t); await f.controller.check();
  f.controller.request = ()=>new Promise(resolve=>{finish=resolve;});
  const installing = f.controller.install(); f.controller.dispose(); finish({status:200,arrayBuffer:f.zip}); await installing;
  assert.deepEqual(await fs.readFile(path.join(f.directory,'main.js')),f.old['main.js']);
});
test('partial replacement failure rolls back all runtime files', async t => {
  const f = await fixture(t); let failed = false;
  const flaky = Object.create(fs); flaky.rename = async (from,to) => {
    if (!failed && from.includes(path.join('stage','manifest.json'))) { failed=true; throw new Error('disk denied'); } return fs.rename(from,to);
  };
  const installer = createFileInstaller(f.directory,flaky); await installer.initialize();
  await assert.rejects(installer.install(f.next,'0.2.0',()=>{}),/已恢复旧版本/);
  for (const name of FILES) assert.deepEqual(await fs.readFile(path.join(f.directory,name)),f.old[name]);
});
test('interrupted transaction is recovered on startup and does not touch user data', async t => {
  const f = await fixture(t), work = path.join(f.directory,'.github-updater'); await fs.mkdir(path.join(work,'backup'),{recursive:true});
  for (const name of FILES) await fs.writeFile(path.join(work,'backup',name),f.old[name]);
  await fs.writeFile(path.join(f.directory,'main.js'),f.next['main.js']); await fs.writeFile(path.join(work,'transaction.json'),JSON.stringify({formatVersion:1,phase:'installing',version:'0.2.0'}));
  const result = await createFileInstaller(f.directory).initialize(); assert(result.recovered);
  for (const name of FILES) assert.deepEqual(await fs.readFile(path.join(f.directory,name)),f.old[name]);
  assert.equal(await fs.readFile(path.join(f.directory,'data.json'),'utf8'),'USER DATA');
});
test('failed recovery retains journal and backup for another startup attempt', async t => {
  const f = await fixture(t), work = path.join(f.directory,'.github-updater'); await fs.mkdir(path.join(work,'backup'),{recursive:true});
  for (const name of FILES) await fs.writeFile(path.join(work,'backup',name),f.old[name]);
  await fs.writeFile(path.join(work,'transaction.json'),JSON.stringify({formatVersion:1,phase:'installing',version:'0.2.0'}));
  const denied = Object.create(fs); denied.rename = async()=>{throw new Error('denied');};
  await assert.rejects(createFileInstaller(f.directory,denied).initialize(),/denied/);
  assert.equal(JSON.parse(await fs.readFile(path.join(work,'transaction.json'))).phase,'installing');
  assert((await createFileInstaller(f.directory).initialize()).recovered);
});
test('installer refuses to overwrite an externally installed newer version', async t => {
  const f = await fixture(t); await fs.writeFile(path.join(f.directory,'manifest.json'),pluginFiles('home-widgets','0.3.0')['manifest.json']);
  await assert.rejects(createFileInstaller(f.directory).install(f.next,'0.2.0',()=>{}),/本地版本已变化/);
});
test('CI version gate allows unchanged packages and rejects changed same-version files or a downgrade',()=>{
  const old = pluginFiles(); validateUpgrade(old,pluginFiles(),'home-widgets'); validateUpgrade(old,pluginFiles('home-widgets','0.3.0'),'home-widgets');
  assert.throws(()=>validateUpgrade(old,{...old,'main.js':Buffer.from('changed')},'home-widgets'),/without a version increase/);
  assert.throws(()=>validateUpgrade(old,pluginFiles('home-widgets','0.1.0'),'home-widgets'),/decrease/);
});

test('automatic checks run once at startup, then respect 24-hour cadence, the toggle and disposal', async () => {
  const day = 86400000; let now = 2 * day, task, calls = 0;
  const controller = new UpdateController({id:'home-widgets',version:'0.2.0',appVersion:'1.8.0', now:()=>now,
    io:{initialize:async()=>({installed:{id:'home-widgets',version:'0.2.0'},state:{formatVersion:1,autoCheck:true,lastCheck:now-23*3600000,notifiedVersion:''}}),saveState:async()=>{}},
    request:async()=>{calls++;return {status:200,json:releaseFor()};},
    setTimer:(callback,delay)=>{task={callback,delay};return task;},cancelTimer:()=>{task=null;}});
  await controller.initialize(); assert.equal(task.delay,15000);
  await task.callback(); assert.equal(calls,1); assert.equal(task.delay,day);
  now += 23*3600000; await task.callback(); assert.equal(calls,1); assert.equal(task.delay,3600000);
  now += 3600000; await task.callback(); assert.equal(calls,2); assert.equal(task.delay,day);
  await controller.setAutoCheck(false); assert.equal(task,null);
  await controller.check(); assert.equal(calls,3); // Disabling automatic checks must keep manual checks available.
  await controller.setAutoCheck(true); await task.callback(); assert.equal(calls,4);
  controller.dispose(); assert.equal(task,null);
});

test('failed checks retain the last successful result without allowing stale installations; retry restores availability', async t => {
  const f = await fixture(t); await f.controller.check();
  const release = f.controller.latestRelease, succeeded = f.controller.lastSuccess;
  f.controller.request = async () => ({status:500}); await f.controller.check(false);
  assert.equal(f.controller.phase,'check-error'); assert.equal(f.controller.checkError,true);
  assert.equal(f.controller.latestRelease,release); assert.equal(f.controller.lastSuccess,succeeded);
  assert.equal(f.controller.canInstall,false); await f.controller.install();
  assert.deepEqual(await fs.readFile(path.join(f.directory,'main.js')),f.old['main.js']);
  f.controller.request = async () => ({status:200,json:f.release}); await f.controller.check();
  assert.equal(f.controller.checkError,false); assert.equal(f.controller.canInstall,true);
  f.release.assets = []; await f.controller.check();
  assert.equal(f.controller.phase,'check-error'); assert.equal(f.controller.latestRelease.version,'0.2.0');
});

test('an equal release is retained as the latest version, but an initial error never reports latest', async t => {
  const f = await fixture(t,{request:async()=>({status:500})}); await f.controller.check();
  assert.equal(f.controller.latestRelease,null); assert.equal(f.controller.phase,'check-error'); assert.equal(f.controller.canInstall,false);
  f.controller.version = f.controller.installedVersion = '0.2.0';
  f.controller.request = async()=>({status:200,json:f.release}); await f.controller.check();
  assert.equal(f.controller.latestRelease.version,'0.2.0'); assert.equal(f.controller.phase,'latest'); assert.equal(f.controller.canInstall,false);
});

test('automatic checks only detect releases, and failed toggle persistence restores the saved preference', async () => {
  let task, downloads = 0, denySave = false;
  const controller = new UpdateController({id:'home-widgets',version:'0.1.0',appVersion:'1.8.0',
    io:{initialize:async()=>({installed:{id:'home-widgets',version:'0.1.0'},state:{formatVersion:1,autoCheck:false,lastCheck:0,notifiedVersion:''}}),
      saveState:async()=>{if(denySave)throw new Error('disk full');}},
    request:async params=>{if(!params.url.endsWith('/latest'))downloads++;return {status:200,json:releaseFor()};},
    setTimer:(callback,delay)=>task={callback,delay},cancelTimer:()=>{task=null;}});
  await controller.initialize(); assert.equal(task,null);
  await controller.setAutoCheck(true); assert.equal(task.delay,15000); await task.callback();
  assert.equal(controller.phase,'available'); assert.equal(downloads,0);
  denySave=true; await controller.setAutoCheck(false); assert.equal(controller.state.autoCheck,true); assert(task);
  controller.dispose(); assert.equal(task,null);
});

test('release notes exclude updater metadata and remain plain content', () => {
  const release = releaseFor(); release.body = release.body.replace('notes', '## 更新内容\n修复已知问题。\n<script>unsafe</script>');
  const result = readRelease(release,'home-widgets','1.8.0');
  assert.equal(result.notes,'## 更新内容\n修复已知问题。\n<script>unsafe</script>');
  assert(!result.notes.includes('formatVersion'));
});
test('browser timers initialize, check and dispose without an illegal receiver', async () => {
  const vm = require('node:vm'), callbacks = new Map(); let nextTimer = 0;
  // Browser Window timers reject calls bound to an UpdateController. Node timers do not.
  function browserSetTimeout(callback) {
    'use strict';
    if (this !== undefined) throw new TypeError('Illegal invocation');
    const id = ++nextTimer; callbacks.set(id, callback); return id;
  }
  function browserClearTimeout(id) {
    'use strict';
    if (this !== undefined) throw new TypeError('Illegal invocation');
    callbacks.delete(id);
  }
  const sandbox = {module:{exports:{}}, require:()=>require('../update-format'), setTimeout:browserSetTimeout, clearTimeout:browserClearTimeout};
  vm.runInNewContext(await fs.readFile(path.join(__dirname,'../update-controller.js'),'utf8'), sandbox);
  const BrowserController = sandbox.module.exports.UpdateController;
  let requests = 0;
  const controller = new BrowserController({id:'home-widgets',version:'0.2.0',appVersion:'1.8.0',
    io:{initialize:async()=>({installed:{id:'home-widgets',version:'0.2.0'}}),saveState:async()=>{}},
    request:async()=>{requests++;return {status:200,json:releaseFor()};}});
  try {
    await controller.initialize(); assert.equal(controller.blocked,false,controller.status); assert.equal(callbacks.size,1);
    const [timer, tick] = [...callbacks][0]; callbacks.delete(timer); await tick();
    assert.equal(requests,1); assert.equal(controller.status,'已是最新版本'); assert.equal(callbacks.size,1);
    controller.dispose(); assert.equal(callbacks.size,0);
  } finally { if (!controller.blocked) controller.dispose(); }
});
test('concurrent installers cannot overwrite each other or replace the successful backup', async t => {
  const f = await fixture(t), first = createFileInstaller(f.directory), second = createFileInstaller(f.directory);
  const results = await Promise.allSettled([first.install(f.next,'0.2.0',()=>{}),second.install(f.next,'0.2.0',()=>{})]);
  assert.equal(results[0].status,'fulfilled'); assert.equal(results[1].status,'rejected');
  assert.deepEqual(await fs.readFile(path.join(f.directory,'.github-updater','backup','manifest.json')),f.old['manifest.json']);
});
