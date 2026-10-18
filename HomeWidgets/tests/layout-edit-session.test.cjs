const test=require('node:test'),assert=require('node:assert/strict');
const {Bus}=require('../src/core/lifecycle');
const {createLayoutStore}=require('../src/services/layout');
const {createLayoutEditSession}=require('../src/core/layout-edit-session');
const initial={version:2,theme:'native',widgets:[{id:'one',type:'tasks',title:'工作',span:4,settings:{area:'work'}},{id:'two',type:'countdown',title:'日期',span:5,settings:{upcoming:0}}]};
function fixture(){
  let text=JSON.stringify(initial),writes=0,fail=false;const bus=new Bus();
  const io={read:async()=>text,update:async(path,fn)=>{if(fail)throw Error('write failed');const next=fn(text);text=next;writes++;bus.changed(path);}};
  const persisted=createLayoutStore(io,bus),session=createLayoutEditSession(persisted);
  return {session,persisted,get writes(){return writes;},get data(){return JSON.parse(text);},setFail:value=>fail=value};
}
test('layout edits preview together without writing, then persist once on explicit save',async()=>{
  const f=fixture();await f.session.begin();await f.session.move('two',-1);await f.session.patchWidget('one',{span:7,height:420,hidden:true});await f.session.patchSettings('two',{upcoming:4});
  assert.equal(f.writes,0);assert.deepEqual(f.data,initial);assert.equal((await f.session.load()).widgets[0].id,'two');
  await f.session.commit();assert.equal(f.writes,1);assert.equal(f.session.active,false);assert.equal(f.data.widgets[0].settings.upcoming,4);assert.equal(f.data.widgets[1].span,7);assert.equal(f.data.widgets[1].hidden,true);
});
test('discard restores persisted layout including additions, ordering and size without writes',async()=>{
  const f=fixture();await f.session.begin();await f.session.add({id:'new',type:'summary',title:'新增',span:12});await f.session.before('two','one');await f.session.patchWidget('one',{span:8});
  await f.session.discard();assert.equal(f.writes,0);assert.deepEqual(await f.session.load(),initial);assert.equal(f.session.active,false);
  await f.session.begin();assert.deepEqual(await f.session.load(),initial);
});
test('save waits for queued edits, and a failed write retains the draft for retry',async()=>{
  const f=fixture();await f.session.begin();const a=f.session.patchWidget('one',{span:8}),b=f.session.patchWidget('two',{span:3}),save=f.session.commit();await Promise.all([a,b,save]);
  assert.deepEqual(f.data.widgets.map(w=>w.span),[8,3]);
  await f.session.begin();await f.session.patchWidget('one',{title:'新标题'});f.setFail(true);await assert.rejects(f.session.commit(),/write failed/);
  assert.equal(f.session.active,true);assert.equal((await f.session.load()).widgets[0].title,'新标题');assert.equal(f.data.widgets[0].title,'工作');
  f.setFail(false);await f.session.commit();assert.equal(f.data.widgets[0].title,'新标题');
});
test('concurrent unrelated settings survive save, while conflicting changes remain untouched',async()=>{
  const f=fixture();await f.session.begin();await f.session.patchWidget('one',{span:8});await f.persisted.page({maxWidth:'full'});await f.session.commit();assert.equal(f.data.maxWidth,'full');assert.equal(f.data.widgets[0].span,8);
  await f.session.begin();await f.session.patchWidget('one',{span:6});await f.persisted.patchWidget('one',{span:2});
  await assert.rejects(f.session.commit(),/已在其他位置修改/);assert.equal(f.data.widgets[0].span,2);assert.equal(f.session.active,true);
  await f.session.discard();assert.equal((await f.session.load()).widgets[0].span,2);
});
test('normal operations still persist outside edit mode and subscriptions are cleaned up',async()=>{
  const f=fixture();let changes=0;const off=f.session.subscribe(()=>changes++);
  await f.session.patchWidget('one',{span:5});assert.equal(f.writes,1);
  await f.session.begin();await f.session.patchWidget('one',{span:7});assert(changes>=3);off();const previous=changes;await f.session.discard();assert.equal(changes,previous);
  f.session.dispose();await assert.rejects(f.session.begin(),/首页已关闭/);assert.equal(f.data.widgets[0].span,5);
});

test('instance creation and deletion share the draft, discard restores both and save persists only the chosen instance',async()=>{
  const f=fixture(),added={id:'three',type:'tasks',title:'新待办',span:4,settings:{area:'life'}};
  await f.session.begin();await f.session.remove('one');await f.session.add(added);
  assert.equal(f.writes,0);assert.deepEqual((await f.session.load()).widgets.map(w=>w.id),['two','three']);
  await f.session.discard();assert.deepEqual(await f.session.load(),initial);assert.equal(f.writes,0);
  await f.session.begin();await f.session.remove('one');await f.session.add(added);f.setFail(true);
  await assert.rejects(f.session.commit(),/write failed/);assert.deepEqual(f.data,initial);assert.equal(f.session.active,true);
  f.setFail(false);await f.session.commit();assert.deepEqual(f.data.widgets,[initial.widgets[1],added]);assert.equal(f.writes,1);
});
