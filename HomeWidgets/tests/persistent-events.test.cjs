const test=require('node:test'),assert=require('node:assert/strict');
const {createPluginDataStore}=require('../src/services/plugin-data');
const {createPersistentEventService}=require('../src/services/persistent-events');
const {Bus}=require('../src/core/lifecycle');
const clone=value=>JSON.parse(JSON.stringify(value));
const sample=[{id:'event-project',title:'项目里程碑',date:'2026-11-01',start:'2026-10-01',area:'投稿'},{id:'event-other',title:'纪念日',date:'2027-01-01',start:'',area:'生活'}];
const seed=()=>({homeFile:'homepage.md',countdowns:{version:1,collections:{default:{events:clone(sample)}}}});
function fixture(initial=seed()){
  let disk=clone(initial),writes=0,fail=false;const bus=new Bus(),changes=[];
  bus.on('countdown:default',()=>changes.push(true));
  const create=()=>{const data=createPluginDataStore({load:async()=>clone(disk),save:async value=>{if(fail)throw Error('disk full');disk=clone(value);writes++;}});return {data,events:createPersistentEventService(data,bus)};};
  return {...create(),reload:create,changes,get disk(){return disk;},get writes(){return writes;},setFail:value=>fail=value};
}
test('concurrent first reads initialize one empty JSON collection and preserve plugin settings',async()=>{
  const f=fixture({homeFile:'homepage.md'}),[a,b]=await Promise.all([f.events.list('default'),f.events.list('default')]);
  assert.deepEqual(a,[]);assert.deepEqual(a,b);assert.equal(f.writes,1);assert.equal(f.disk.homeFile,'homepage.md');
  assert.deepEqual(f.disk.countdowns.collections.default,{events:[]});
  await f.reload().events.list('default');assert.equal(f.writes,1);
});

test('existing JSON collections retain dates without rewriting storage on reads',async()=>{
  const f=fixture(),before=clone(f.disk);assert.deepEqual(await f.events.list('default'),sample);assert.equal(f.writes,0);assert.deepEqual(f.disk,before);
});
test('JSON CRUD survives restarts and an emptied collection remains empty',async()=>{
  const f=fixture();await f.events.list('default');await f.events.save('default',{title:'支持 | 字符',date:'2027-02-01',area:'工作'});
  let next=f.reload();let events=await next.events.list('default');assert.equal(events.length,3);const added=events.find(e=>e.title==='支持 | 字符');assert(added);
  await next.events.save('default',{...added,title:'更新标题',date:'2027-02-02'});
  events=await next.events.list('default');assert.equal(events.find(e=>e.id===added.id).title,'更新标题');
  for(const event of events)await next.events.remove('default',event);
  assert.deepEqual(await f.reload().events.list('default'),[]);assert.deepEqual(f.disk.countdowns.collections.default,{events:[]});
});
test('settings updates and concurrent date saves merge without overwriting each other',async()=>{
  const f=fixture();await f.events.list('default');await Promise.all([
    f.data.update(root=>({...root,homeFile:'Home/new-home.md'})),
    f.events.save('default',{title:'日期 A',date:'2027-02-01'}),
    f.events.save('default',{title:'日期 B',date:'2027-03-01'})
  ]);
  assert.equal(f.disk.homeFile,'Home/new-home.md');assert.equal((await f.events.list('default')).length,4);
});
test('failed collection initialization and date writes leave saved data intact and can be retried',async()=>{
  const f=fixture({homeFile:'homepage.md'});f.setFail(true);await assert.rejects(f.events.list('default'),/disk full/);assert.equal(f.disk.countdowns,undefined);assert.equal(f.writes,0);
  f.setFail(false);await f.events.list('default');const previous=clone(f.disk),notifications=f.changes.length;
  f.setFail(true);await assert.rejects(f.events.save('default',{title:'失败日期',date:'2027-01-02'}),/disk full/);assert.deepEqual(f.disk,previous);assert.equal(f.changes.length,notifications);
  f.setFail(false);await f.events.save('default',{title:'重试成功',date:'2027-01-02'});assert.equal((await f.events.list('default')).length,1);
});
test('stale deletion, invalid or duplicate JSON dates and future schema versions never overwrite data',async()=>{
  const f=fixture(),events=await f.events.list('default'),stale=events[0];await f.events.save('default',{...stale,title:'其他视图已改名'});const snapshot=clone(f.disk);
  await assert.rejects(f.events.remove('default',stale),/已变化/);assert.deepEqual(f.disk,snapshot);
  for(const events of [[{...sample[0],date:'2026-02-30'}],[sample[0],sample[0]]]){
    const initial={countdowns:{version:1,collections:{default:{events}}}},bad=fixture(initial);await assert.rejects(bad.events.list('default'),/无效|重复|有效/);assert.deepEqual(bad.disk,initial);assert.equal(bad.writes,0);
  }
  const future=fixture({countdowns:{version:99,collections:{}}});await assert.rejects(future.events.list('default'),/不受支持/);assert.equal(future.writes,0);
});
test('named JSON collections remain independent when dates are added or deleted',async()=>{
  const f=fixture();await f.events.save('personal',{title:'另一集合',date:'2027-02-01'});
  const a=await f.events.list('default'),b=await f.events.list('personal');assert.equal(b[0].title,'另一集合');await f.events.remove('default',a[0]);assert.equal((await f.events.list('personal')).length,1);assert.equal((await f.events.list('default')).length,1);
});

test('note paths are rejected instead of being imported or aliased to a JSON collection',async()=>{
  const f=fixture(),before=clone(f.disk);
  for(const source of ['Home/关键日期.md','dates.md','Home/personal',''])await assert.rejects(f.events.list(source),/不再支持笔记路径/);
  assert.deepEqual(f.disk,before);assert.equal(f.writes,0);
});

test('unsupported plugin, collection and event fields fail without rewriting saved data',async()=>{
  const root=seed(),collection=seed(),event=seed();root.unknownField=true;collection.countdowns.collections.default.unknownField=true;event.countdowns.collections.default.events[0].unknownField=true;
  for(const initial of [root,collection,event]){const f=fixture(initial);await assert.rejects(f.events.list('default'),/字段不受支持/);assert.deepEqual(f.disk,initial);assert.equal(f.writes,0);}
});
