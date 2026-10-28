const test=require('node:test'),assert=require('node:assert/strict');
const {createPluginDataStore}=require('../src/services/plugin-data');
const {createPersistentEventService}=require('../src/services/persistent-events');
const {Bus}=require('../src/core/lifecycle');
const clone=value=>JSON.parse(JSON.stringify(value));
const sample=[{id:'event-project',title:'项目里程碑',date:'2026-11-01',start:'2026-10-01',area:'投稿'},{id:'event-other',title:'纪念日',date:'2027-01-01',start:'',area:'生活'}];
const seed=()=>({homeFile:'homepage.md',countdowns:{version:2,events:clone(sample)}});
function fixture(initial=seed()){
  let disk=clone(initial),writes=0,fail=false;const bus=new Bus(),changes=[];
  bus.on('countdown',()=>changes.push(true));
  const create=()=>{const data=createPluginDataStore({load:async()=>clone(disk),save:async value=>{if(fail)throw Error('disk full');disk=clone(value);writes++;}});return {data,events:createPersistentEventService(data,bus)};};
  return {...create(),reload:create,changes,get disk(){return disk;},get writes(){return writes;},setFail:value=>fail=value};
}
test('concurrent first reads initialize one empty JSON list and preserve plugin settings',async()=>{
  const f=fixture({homeFile:'homepage.md'}),[a,b]=await Promise.all([f.events.list(),f.events.list()]);
  assert.deepEqual(a,[]);assert.deepEqual(a,b);assert.equal(f.writes,1);assert.equal(f.disk.homeFile,'homepage.md');
  assert.deepEqual(f.disk.countdowns,{version:2,events:[]});
  await f.reload().events.list();assert.equal(f.writes,1);
});

test('existing JSON lists retain dates without rewriting storage on reads',async()=>{
  const f=fixture(),before=clone(f.disk);assert.deepEqual(await f.events.list(),sample);assert.equal(f.writes,0);assert.deepEqual(f.disk,before);
});
test('JSON CRUD survives restarts and an emptied list remains empty',async()=>{
  const f=fixture();await f.events.list();await f.events.save({title:'支持 | 字符',date:'2027-02-01',area:'工作'});
  let next=f.reload();let events=await next.events.list();assert.equal(events.length,3);const added=events.find(e=>e.title==='支持 | 字符');assert(added);
  await next.events.save({...added,title:'更新标题',date:'2027-02-02'});
  events=await next.events.list();assert.equal(events.find(e=>e.id===added.id).title,'更新标题');
  for(const event of events)await next.events.remove(event);
  assert.deepEqual(await f.reload().events.list(),[]);assert.deepEqual(f.disk.countdowns,{version:2,events:[]});
});
test('settings updates and concurrent date saves merge without overwriting each other',async()=>{
  const f=fixture();await f.events.list();await Promise.all([
    f.data.update(root=>({...root,homeFile:'Home/new-home.md'})),
    f.events.save({title:'日期 A',date:'2027-02-01'}),
    f.events.save({title:'日期 B',date:'2027-03-01'})
  ]);
  assert.equal(f.disk.homeFile,'Home/new-home.md');assert.equal((await f.events.list()).length,4);
});
test('failed list initialization and date writes leave saved data intact and can be retried',async()=>{
  const f=fixture({homeFile:'homepage.md'});f.setFail(true);await assert.rejects(f.events.list(),/disk full/);assert.equal(f.disk.countdowns,undefined);assert.equal(f.writes,0);
  f.setFail(false);await f.events.list();const previous=clone(f.disk),notifications=f.changes.length;
  f.setFail(true);await assert.rejects(f.events.save({title:'失败日期',date:'2027-01-02'}),/disk full/);assert.deepEqual(f.disk,previous);assert.equal(f.changes.length,notifications);
  f.setFail(false);await f.events.save({title:'重试成功',date:'2027-01-02'});assert.equal((await f.events.list()).length,1);
});
test('stale deletion, invalid or duplicate JSON dates and future schema versions never overwrite data',async()=>{
  const f=fixture(),events=await f.events.list(),stale=events[0];await f.events.save({...stale,title:'其他视图已改名'});const snapshot=clone(f.disk);
  await assert.rejects(f.events.remove(stale),/已变化/);assert.deepEqual(f.disk,snapshot);
  for(const events of [[{...sample[0],date:'2026-02-30'}],[sample[0],sample[0]]]){
    const initial={countdowns:{version:2,events:events}},bad=fixture(initial);await assert.rejects(bad.events.list(),/无效|重复|有效/);assert.deepEqual(bad.disk,initial);assert.equal(bad.writes,0);
  }
  const future=fixture({countdowns:{version:99,collections:{}}});await assert.rejects(future.events.list(),/不受支持/);assert.equal(future.writes,0);
});


test('legacy collection arguments and storage formats are rejected without writing',async()=>{
 const f=fixture(),before=clone(f.disk);for(const options of ['default','dates.md',{collection:'default'}])await assert.rejects(f.events.list(options));assert.deepEqual(f.disk,before);assert.equal(f.writes,0);
 const legacy={countdowns:{version:1,collections:{default:{events:sample}}}},old=fixture(legacy);await assert.rejects(old.events.list(),/不受支持/);assert.deepEqual(old.disk,legacy);assert.equal(old.writes,0);
});

test('unsupported plugin, countdown and event fields fail without rewriting saved data',async()=>{
  const root=seed(),collection=seed(),event=seed();root.unknownField=true;collection.countdowns.unknownField=true;event.countdowns.events[0].unknownField=true;
  for(const initial of [root,collection,event]){const f=fixture(initial);await assert.rejects(f.events.list(),/字段不受支持/);assert.deepEqual(f.disk,initial);assert.equal(f.writes,0);}
});

test('archive hides a date without losing data, survives reloads, and restore retains its identity',async()=>{
  const f=fixture(),before=clone(f.disk),event=(await f.events.list())[0];
  await f.events.archive(event);
  assert.deepEqual(await f.events.list(),[sample[1]]);
  const all=await f.reload().events.list({includeArchived:true});assert.equal(all.length,2);
  assert.deepEqual(all[0],{...event,archived:true});assert.equal(f.disk.homeFile,before.homeFile);
  assert.equal(f.changes.length,1);assert.deepEqual(await f.reload().events.list(),[sample[1]]);
  const next=f.reload();await next.events.restore(all[0]);
  assert.deepEqual(await f.reload().events.list(),sample);assert.equal(f.changes.length,2);
});

test('archive and restore reject stale edits and status changes without overwriting records',async()=>{
  const f=fixture(),event=(await f.events.list())[0];await f.events.save({...event,title:'已改名'});
  await assert.rejects(f.events.archive(event),/已变化/);
  const latest=(await f.events.list())[0];await f.events.archive(latest);const snapshot=clone(f.disk);
  await assert.rejects(f.events.remove(latest),/已变化/);
  await assert.rejects(f.events.archive(latest),/已变化/);
  await assert.rejects(f.events.save({...latest,title:'旧编辑器内容'}),/已归档/);
  assert.deepEqual(f.disk,snapshot);
  const archived=(await f.events.list({includeArchived:true}))[0];await f.events.restore(archived);
  const restored=clone(f.disk);await assert.rejects(f.events.restore(archived),/已变化/);assert.deepEqual(f.disk,restored);
});

test('archive and restore failures preserve storage and notifications and permit retry',async()=>{
  const f=fixture(),event=(await f.events.list())[0],before=clone(f.disk);
  f.setFail(true);await assert.rejects(f.events.archive(event),/disk full/);assert.deepEqual(f.disk,before);assert.equal(f.changes.length,0);
  f.setFail(false);await f.events.archive(event);const snapshot=clone(f.disk),archived=(await f.events.list({includeArchived:true}))[0];
  f.setFail(true);await assert.rejects(f.events.restore(archived),/disk full/);assert.deepEqual(f.disk,snapshot);assert.equal(f.changes.length,1);
  f.setFail(false);await f.events.restore(archived);assert.deepEqual(await f.events.list(),sample);
});

test('concurrent archival, new dates and settings preserve each other',async()=>{
  const f=fixture();
  await Promise.all([f.events.archive(sample[0]),f.events.save({title:'新日期',date:'2027-03-01'}),f.data.update(root=>({...root,homeFile:'Home/new.md'}))]);
  assert.equal((await f.events.list()).length,2);assert.equal((await f.events.list({includeArchived:true})).length,3);
  assert.equal(f.disk.homeFile,'Home/new.md');
});

test('invalid archive flags never rewrite saved data',async()=>{
  for(const archived of ['true',1,null]){
    const initial=seed();initial.countdowns.events[0].archived=archived;
    const f=fixture(initial);await assert.rejects(f.events.list(),/归档状态无效/);assert.deepEqual(f.disk,initial);assert.equal(f.writes,0);
  }
});
