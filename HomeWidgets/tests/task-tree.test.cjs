const test=require('node:test'),assert=require('node:assert/strict');
const {createTaskService,parseTasks,leafTasks,groupError,groupFor}=require('../src/services/tasks');
const {createLayoutStore}=require('../src/services/layout');
const {createLayoutEditSession}=require('../src/core/layout-edit-session');
const {createActivityService,calendarRange}=require('../src/services/activity');
const {localDay}=require('../src/services/date');
const {Bus}=require('../src/core/lifecycle');
const source='tasks.md',layoutPath='layout.json',key=id=>JSON.stringify([source,id]);
function fixture(text,integrations){
  const files=new Map([[source,text],[layoutPath,JSON.stringify({version:2,theme:'native',widgets:['visible','unmounted'].map(id=>({id,type:'tasks',span:4,hidden:id==='unmounted',settings:{source,hiddenTaskKeys:[key('p'),key('a'),key('b')]}}))})]]),queues=new Map();
  const io={exists:async p=>files.has(p),read:async p=>files.get(p),update:async(p,fn)=>{const next=(queues.get(p)||Promise.resolve()).catch(()=>{}).then(()=>files.set(p,fn(files.get(p))));queues.set(p,next);await next;}};
  const store=createLayoutStore(io,new Bus(),layoutPath),service=createTaskService(io,integrations);service.onReopen((p,ids)=>store.clearTaskHidden(p,ids));
  return {files,io,store,service,list:()=>service.list(source),get:async id=>(await service.list(source)).find(task=>task.id===id)};
}
const group='- [ ] 父项 #area/work ^p\n  说明\n  - [x] A ^a\n  - [ ] B 📅 2026-11-01 ^b\n- [x] 已完成独立项 #area/work ^done\n- [ ] 另一主项 #area/work ^other\n';

test('indentation creates task parents, inherits categories and excludes fenced examples without joining across headings',()=>{
  const text='- [ ] 父 #area/work ^p\n  ```md\n  - [ ] 示例 ^fake\n  ```\n  - [ ] 子 ^a\n# 新章节\n  - [ ] 独立缩进项 ^b\n';
  const tasks=parseTasks(text,source);assert.deepEqual(tasks.map(t=>[t.id,t.parentId,t.area]),[['p',null,'work'],['a','p','work'],['b',null,'life']]);
  assert.deepEqual(leafTasks(tasks).map(t=>t.id),['a','b']);
});
test('parent toggle is atomic, preserves child order and moves the group to its status section end',async()=>{
  const f=fixture(group);await f.service.toggle(await f.get('p'),true);let tasks=await f.list();
  assert(tasks.filter(t=>['p','a','b'].includes(t.id)).every(t=>t.done));assert.deepEqual(tasks.filter(t=>t.parentLine===null&&t.done).map(t=>t.id),['done','p']);
  await f.service.toggle(await f.get('p'),false);tasks=await f.list();assert(tasks.filter(t=>['p','a','b'].includes(t.id)).every(t=>!t.done));
  assert.deepEqual(tasks.filter(t=>t.parentLine===null&&!t.done).map(t=>t.id),['other','p']);assert.deepEqual(tasks.filter(t=>t.parentId==='p').map(t=>t.id),['a','b']);
  assert(f.files.get(source).includes('  说明\n'));assert(!tasks.find(t=>t.id==='p').raw.includes('✅'));
});
test('the last child completes its parent and reopening one child preserves other completions',async()=>{
  const f=fixture(group);await f.service.toggle(await f.get('b'),true);assert((await f.get('p')).done);
  await f.service.toggle(await f.get('a'),false);assert(!(await f.get('p')).done);assert(!(await f.get('a')).done);assert((await f.get('b')).done);
  for(const widget of (await f.store.load()).widgets)assert.deepEqual(widget.settings.hiddenTaskKeys,[key('b')]);
});
test('adding children reopens a completed parent, preserves existing checks, metadata and CRLF',async()=>{
  const original='- [x] 父 #area/work ✅ 2026-10-01 ^p\r\n  说明\r\n  - [x] A ^a\r\n- [ ] 邻居 #area/work ^other\r\n',f=fixture(original);
  const result=await f.service.addChild(await f.get('p'),{title:'新子项',due:'2026-12-01'}),tasks=await f.list(),child=tasks.find(t=>t.id===result.id);
  assert.equal(result.parentId,'p');assert.equal(child.parentId,'p');assert.equal(child.area,'work');assert.equal(child.due,'2026-12-01');assert(!(await f.get('p')).done);assert((await f.get('a')).done);
  assert(!/(?<!\r)\n/.test(f.files.get(source)));assert(f.files.get(source).includes('  说明\r\n'));
  for(const widget of (await f.store.load()).widgets)assert(!widget.settings.hiddenTaskKeys.includes(key('p')));
});
test('deleting children recalculates the parent and deleting the last child retains its state',async()=>{
  const f=fixture(group);await f.service.remove(await f.get('b'));assert((await f.get('p')).done);assert((await f.get('a')).done);
  await f.service.remove(await f.get('a'));assert((await f.get('p')).done);assert.equal((await f.get('p')).childCount,0);
  const before=f.files.get(source);assert(before.includes('说明'));await f.service.remove(await f.get('p'));assert(!f.files.get(source).includes('说明'));assert(await f.get('other'));
});
test('same-level sorting moves full Markdown blocks and rejects cross-parent or cross-status moves',async()=>{
  const f=fixture(group+'- [ ] 第二组 #area/work ^second\n  - [ ] C ^c\n');
  await f.service.move(await f.get('p'),await f.get('other'),true);let tasks=await f.list();assert.deepEqual(tasks.filter(t=>t.parentLine===null&&!t.done).map(t=>t.id),['other','p','second']);
  assert(f.files.get(source).includes('^p\n  说明\n  - [x] A ^a\n  - [ ] B 📅 2026-11-01 ^b'));
  await f.service.move(await f.get('b'),await f.get('a'),false);assert.deepEqual((await f.list()).filter(t=>t.parentId==='p').map(t=>t.id),['b','a']);
  const before=f.files.get(source);await assert.rejects(f.service.move(await f.get('a'),await f.get('c')),/同一父项/);await assert.rejects(f.service.move(await f.get('p'),await f.get('done')),/同一父项/);assert.equal(f.files.get(source),before);
});
test('stale child changes reject add, toggle, move and deletion without overwriting a newer note',async()=>{
  const f=fixture(group),parent=await f.get('p'),target=await f.get('other'),newer=group.replace('  说明','  外部已改说明');f.files.set(source,newer);
  for(const operation of [()=>f.service.addChild(parent,{title:'新子项'}),()=>f.service.toggle(parent,true),()=>f.service.move(parent,target),()=>f.service.remove(parent)])await assert.rejects(operation(),/子项已被修改/);
  assert.equal(f.files.get(source),newer);
});
test('API preparation failure, invalid API output and file save failure never partially complete a group',async()=>{
  let count=0;const f=fixture(group,{taskTransform:()=>async raw=>{if(++count===2)throw Error('API failed');return raw.replace('[ ]','[x]');}});
  await assert.rejects(f.service.toggle(await f.get('p'),true),/API failed/);assert.equal(f.files.get(source),group);
  const malformed=fixture(group,{taskTransform:()=>async raw=>raw+'\n- [ ] unexpected'});await assert.rejects(malformed.service.toggle(await malformed.get('p'),true),/无效/);assert.equal(malformed.files.get(source),group);
  const failed=fixture(group);failed.io.update=async()=>{throw Error('磁盘写入失败');};await assert.rejects(failed.service.toggle(await failed.get('p'),true),/写入失败/);assert.equal(failed.files.get(source),group);
});
test('repeat groups and deeper levels reject linkage while standalone repeats retain their Tasks API behavior',async()=>{
  for(const text of ['- [ ] 重复 🔁 every day ^p\n  - [ ] 子 ^a\n','- [ ] 父 ^p\n  - [ ] 子 🔁 every day ^a\n','- [ ] 父 ^p\n  - [ ] 子 ^a\n    - [ ] 孙 ^b\n','- [ ] 父 #area/work ^p\n  - [ ] 子 #area/life ^a\n']){
    const f=fixture(text),parent=await f.get('p');assert(groupError(groupFor(await f.list(),parent)));await assert.rejects(f.service.toggle(parent,true));assert.equal(f.files.get(source),text);
  }
  const f=fixture('- [ ] 重复 🔁 every day ^p\n');await assert.rejects(f.service.addChild(await f.get('p'),{title:'子'}),/重复/);assert.equal((await f.list()).length,1);
});
test('reopen clears hidden records of unmounted instances, survives layout discard and blocks on failed cleanup',async()=>{
  const f=fixture('- [x] 父 #area/work ^p\n  - [x] A ^a\n  - [x] B ^b\n'),session=createLayoutEditSession(f.store),off=f.service.onReopen((p,ids)=>session.clearTaskHidden(p,ids));
  await session.begin();await session.patchWidget('visible',{span:8});await f.service.toggle(await f.get('a'),false);await session.discard();off();
  await f.service.toggle(await f.get('a'),true);for(const widget of (await f.store.load()).widgets)assert.deepEqual(widget.settings.hiddenTaskKeys,[key('b')]);
  const fail=fixture('- [x] 父 #area/work ^p\n'),update=fail.io.update;fail.io.update=async(p,fn)=>{if(p===layoutPath)throw Error('layout save failed');return update(p,fn);};
  await assert.rejects(fail.service.toggle(await fail.get('p'),false),/layout save failed/);assert((await fail.get('p')).done);
});
test('heatmap counts leaf completions once and excludes the completed group container',async()=>{
  const f=fixture(group);await f.service.toggle(await f.get('p'),true);
  const result=await createActivityService(f.io).query('tasks',{taskSource:source},calendarRange('month'));
  // A was already completed without a date, B was completed today; parent is excluded.
  assert.equal(result.days.get(localDay()),1);assert.match(result.note,/2 项/);
});

test('using an existing stable identity never rewrites or reorganizes a note just to hide it',async()=>{
  const text='<!-- home-widgets:tasks -->\n## 工作\n### 已完成\n- [x] 已完成 #area/work ^p\n<!-- /home-widgets:tasks -->\n',f=fixture(text);let writes=0;const update=f.io.update;
  f.io.update=async(p,fn)=>{if(p===source)writes++;return update(p,fn);};
  assert.equal(await f.service.ensureId(await f.get('p')),'p');assert.equal(writes,0);assert.equal(f.files.get(source),text);
});
