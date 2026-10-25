const test=require('node:test'),assert=require('node:assert/strict');
const {Bus}=require('../src/core/lifecycle');
const {createLayoutStore}=require('../src/services/layout');
const {createLayoutEditSession}=require('../src/core/layout-edit-session');
const {parseTasks}=require('../src/services/tasks');
const {confirmRemoveWidget}=require('../src/core/widget-instances');

const source='Home/tasks.md',layoutPath='Home/widgets.json';
const sample='# 待办\r\n- [ ] 工作一 #task #area/work 📅 2026-11-01 ^one\r\n- [x] 已完成 #area/work ✅ 2026-10-18 ^done\r\n- [x] 隐藏任务 #area/work ^hidden\r\n- [ ] 生活 #area/life ^life\r\n```md\r\n- [ ] 示例 #area/work ^example\r\n```\r\n';
function fixture(text=sample){
  const one={id:'work',type:'tasks',title:'工作待办',span:4,settings:{source,area:'work',showCompleted:false,limit:1,hiddenTaskKeys:['hidden']}},peer={...one,id:'peer',title:'同分类副本',hidden:true};
  const original=JSON.stringify({version:3,theme:'native',widgets:[one,peer]}),files=new Map([[source,text],[layoutPath,original]]),writes=[],bus=new Bus();let hook;
  const io={read:async path=>{if(!files.has(path))throw new Error('missing '+path);return files.get(path);},
    update:async(path,fn)=>{if(hook)await hook(path);const next=fn(files.get(path));files.set(path,next);writes.push(path);bus.changed(path);},
    create:async(path,text)=>{assert(!files.has(path));files.set(path,text);}};
  const store=createLayoutStore(io,bus),session=createLayoutEditSession(store);
  return {one,peer,original,files,writes,store,session,setHook:fn=>hook=fn};
}
async function plan(store,id='work',mode='uncategorize'){return {...await store.describeTaskRemoval(id),mode};}

test('dialog counts every category task, warns about shared instances and defaults to retaining tasks',async()=>{
  const f=fixture();let form;
  await confirmRemoveWidget({show:(...args)=>form=args},f.store,f.one);
  assert.equal(form[0],'删除待办组件');assert.equal(form[2].taskAction,'uncategorize');
  assert.match(form[5].description.detail,/全部任务：3 项/);assert.match(form[5].description.detail,/同分类副本/);assert.match(form[5].description.detail,/Home\/tasks.md/);
  assert.equal(f.writes.length,0);await form[3](form[2]);
  assert.deepEqual((await f.store.load()).widgets,[f.peer]);
  const tasks=parseTasks(f.files.get(source),source);assert.equal(tasks.filter(t=>t.area==='uncategorized').length,3);assert.equal(tasks.filter(t=>t.area==='life').length,1);
  assert.equal(f.files.get(source),sample.replace('#area/work 📅','#area/uncategorized 📅').replace('#area/work ✅','#area/uncategorized ✅').replace('#area/work ^hidden','#area/uncategorized ^hidden'));
});

test('retaining an implicit life category marks it unclassified while preserving metadata, CRLF and no final newline',async()=>{
  const text='- [x] 无分类任务 📅 2026-11-01 ✅ 2026-10-18 ^plain\r\n- [ ] 工作 #area/work ^work';
  const f=fixture(text);await f.store.patchWidget('work',{settings:{area:'life'}});const removal=await plan(f.store);
  await f.store.remove('work',removal);
  assert.equal(f.files.get(source),'- [x] 无分类任务 📅 2026-11-01 ✅ 2026-10-18 #area/uncategorized ^plain\r\n- [ ] 工作 #area/work ^work');
  const tasks=parseTasks(f.files.get(source),source);assert.equal(tasks[0].area,'uncategorized');assert.equal(tasks[0].done,true);assert.equal(tasks[0].id,'plain');assert.equal(tasks[0].due,'2026-11-01');
});

test('deleting a category removes its tasks and descriptions but retains differently classified child blocks and code examples',async()=>{
  const prefix='# 待办\r\n',lifeChild='  - [ ] 生活子任务 #area/life ^child\r\n    子任务说明\r\n',suffix='- [ ] 生活 #area/life ^life\r\n```md\r\n- [ ] 示例 #area/work ^example\r\n```\r\n';
  const text=prefix+'- [ ] 工作父任务 #area/work ^parent\r\n  父任务说明\r\n'+lifeChild+'  - [x] 工作子任务 #area/work ^work-child\r\n    工作说明\r\n- [x] 工作已完成 #area/work ^done\r\n'+suffix;
  const f=fixture(text);await f.store.remove('work',await plan(f.store,'work','delete'));
  assert.equal(f.files.get(source),prefix+lifeChild+suffix);assert.equal(parseTasks(f.files.get(source),source).length,2);
});

test('task handling stays pending during layout editing, discard is inert and commit applies the confirmed choice',async()=>{
  const f=fixture();await f.session.begin();await f.session.remove('work',await plan(f.session));
  assert.equal(f.writes.length,0);assert.equal(f.files.get(source),sample);assert.equal((await f.session.load()).widgets.length,1);
  await f.session.discard();assert.equal(f.files.get(layoutPath),f.original);assert.equal(f.files.get(source),sample);assert.equal(f.writes.length,0);
  await f.session.begin();await f.session.remove('work',await plan(f.session,'work','delete'));await f.session.commit();
  assert.deepEqual((await f.store.load()).widgets,[f.peer]);assert.equal(parseTasks(f.files.get(source),source).filter(t=>t.area==='work').length,0);assert.equal(f.session.active,false);
});

test('external task changes invalidate a confirmed deletion without changing layout or the newer task file',async()=>{
  const f=fixture();await f.session.begin();await f.session.remove('work',await plan(f.session,'work','delete'));
  const changed=sample+'- [ ] 确认后新增 #area/work ^new\r\n';f.files.set(source,changed);
  await assert.rejects(f.session.commit(),/已变化/);assert.equal(f.files.get(layoutPath),f.original);assert.equal(f.files.get(source),changed);assert.equal(f.writes.length,0);assert.equal(f.session.active,true);
});

test('layout conflicts are detected before task writes and unrelated layout changes survive task handling',async()=>{
  const f=fixture();await f.session.begin();await f.session.remove('work',await plan(f.session));await f.store.patchWidget('peer',{title:'外部编辑'});
  const saved=f.files.get(layoutPath);await assert.rejects(f.session.commit(),/其他位置修改/);assert.equal(f.files.get(layoutPath),saved);assert.equal(f.files.get(source),sample);
  await f.session.discard();await f.session.begin();await f.session.remove('work',await plan(f.session));await f.store.page({maxWidth:'full'});await f.session.commit();assert.equal((await f.store.load()).maxWidth,'full');
});

test('a failed layout write rolls task edits back and leaves the deletion draft available for retry',async()=>{
  const f=fixture();await f.session.begin();await f.session.remove('work',await plan(f.session,'work','delete'));
  f.setHook(async path=>{if(path===layoutPath)throw new Error('layout write failed');});
  await assert.rejects(f.session.commit(),/layout write failed/);assert.equal(f.files.get(source),sample);assert.equal(f.files.get(layoutPath),f.original);assert.equal(f.session.active,true);
  f.setHook();await f.session.commit();assert.equal((await f.store.load()).widgets.length,1);assert.equal(parseTasks(f.files.get(source),source).filter(t=>t.area==='work').length,0);
});

test('two deleted instances sharing a category process it once and contradictory choices never write data',async()=>{
  const f=fixture();await f.session.begin();await f.session.remove('work',await plan(f.session));await f.session.remove('peer',await plan(f.session,'peer','delete'));
  await assert.rejects(f.session.commit(),/不同的任务处理方式/);assert.equal(f.files.get(source),sample);assert.equal(f.writes.length,0);
  await f.session.discard();await f.session.begin();await f.session.remove('work',await plan(f.session));await f.session.remove('peer',await plan(f.session,'peer'));await f.session.commit();
  assert.equal(f.writes.filter(path=>path===source).length,1);assert.equal((await f.store.load()).widgets.length,0);
});

test('a later source-file failure restores earlier task files and never changes the layout',async()=>{
  const f=fixture(),second='Home/second.md';f.files.set(second,'- [ ] 第二份任务 #area/study ^s\n');
  await f.store.add({id:'study',type:'tasks',span:4,title:'学习',settings:{source:second,area:'study'}});const layout=f.files.get(layoutPath);
  await f.session.begin();await f.session.remove('work',await plan(f.session,'work','delete'));await f.session.remove('study',await plan(f.session,'study','delete'));
  f.setHook(async path=>{if(path===second)throw new Error('second file failed');});
  await assert.rejects(f.session.commit(),/second file failed/);assert.equal(f.files.get(source),sample);assert.equal(f.files.get(second),'- [ ] 第二份任务 #area/study ^s\n');assert.equal(f.files.get(layoutPath),layout);
});

test('rollback never overwrites an external edit and saves the original text for recovery',async()=>{
  const f=fixture();const removal=await plan(f.store,'work','delete');let newer;
  f.setHook(async path=>{if(path===layoutPath){newer=f.files.get(source)+'外部新内容\n';f.files.set(source,newer);throw new Error('layout unavailable');}});
  await assert.rejects(f.store.remove('work',removal),/原文已备份到 HomeWidgets\/recovery/);
  assert.equal(f.files.get(source),newer);assert.equal(f.files.get(layoutPath),f.original);
  const backup=[...f.files].find(([path])=>path.startsWith('HomeWidgets/recovery/'));assert(backup);assert.equal(JSON.parse(backup[1]).files[0].before,sample);
});
