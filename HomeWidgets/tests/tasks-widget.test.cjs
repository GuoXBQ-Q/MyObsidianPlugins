const test=require('node:test'),assert=require('node:assert/strict');
const widget=require('../src/widgets/tasks');
const {Bus}=require('../src/core/lifecycle');
const {createLayoutStore}=require('../src/services/layout');
const {createTaskService}=require('../src/services/tasks');

class Node {
  constructor(tag){this.tag=tag;this.nodeType=1;this.childNodes=[];this.attributes={};this.events={};}
  get children(){return this.childNodes.filter(node=>node.nodeType===1);}
  get childElementCount(){return this.children.length;}
  get textContent(){return (this.text||'')+this.childNodes.map(node=>node.textContent).join('');}
  set textContent(value){this.text=value;this.childNodes=[];}
  append(...nodes){this.childNodes.push(...nodes);}
  setAttribute(name,value){this.attributes[name]=String(value);}
  addEventListener(name,fn){this.events[name]=fn;}
  removeEventListener(name,fn){if(this.events[name]===fn)delete this.events[name];}
  get classList(){return {add:()=>{},remove:()=>{}};}
  focus(){doc.activeElement=this;}
  find(cls){return this.children.flatMap(node=>[...(node.className?.split(' ').includes(cls)?[node]:[]),...node.find(cls)]);}
}
const doc={createElement:tag=>new Node(tag),createElementNS:(ns,tag)=>new Node(tag),createTextNode:text=>({nodeType:3,textContent:text}),addEventListener(){},removeEventListener(){},defaultView:{addEventListener(){},removeEventListener(){}}};
async function fixture(text){
  const source='Home/tasks.md',layoutPath='Home/widgets.json',bus=new Bus(),queues=new Map(),notices=[],dialogs=[];
  const files=new Map([[source,text],[layoutPath,JSON.stringify({version:2,theme:'native',widgets:['work-a','work-b','life'].map(id=>({id,type:'tasks',title:id,span:4,settings:{source,area:id==='life'?'life':'work'}}))})]]);
  const io={read:async path=>files.get(path),update:async(path,fn)=>{
    const job=(queues.get(path)||Promise.resolve()).catch(()=>{}).then(()=>files.set(path,fn(files.get(path))));queues.set(path,job);await job;
  }};
  const store=createLayoutStore(io,bus),service=createTaskService(io),locals=new Map(),controllers=new Map();
  service.onReopen((source,ids)=>store.clearTaskHidden(source,ids));
  async function mount(id='work-a'){
    controllers.get(id)?.abort();const controller=new AbortController();controllers.set(id,controller);
    const saved=(await store.load()).widgets.find(item=>item.id===id),body=new Node('body'),actions=new Node('header');
    if(!locals.has(id))locals.set(id,{});
    const ctx={doc,el:body,actions,config:{...widget.defaults,...saved.settings},local:locals.get(id),signal:controller.signal,
      services:{tasks:service},updateConfig:patch=>store.patchSettings(id,patch),refresh:()=>mount(id),
      forms:{show:(...args)=>dialogs.push({kind:'edit',args}),confirm:(...args)=>dialogs.push({kind:'delete',args})},
      notify:text=>notices.push(text),run:async fn=>{try{return await fn();}catch(e){notices.push(e.message);}}};
    await widget.mount(ctx);return {body,actions,ctx};
  }
  return {source,layoutPath,files,io,service,store,mount,notices,dialogs};
}
const titles=view=>view.body.find('hw-task-title').map(node=>node.textContent);
const hide=view=>view.body.find('hw-task-hide');
const restore=view=>view.actions.find('hw-task-restore')[0];
const sample='- [ ] 进行中 #area/work ^active\n- [x] 完成 A #area/work ^done-a\n- [x] 完成 B #area/work ^done-b\n- [x] 生活事项 #area/life ^life-a\n';

test('completed task hiding persists per instance without deleting notes, and restore reveals completed tasks',async()=>{
  const f=await fixture(sample);let view=await f.mount();assert.equal(hide(view).length,2);assert.equal(restore(view).disabled,true);
  const before=f.files.get(f.source);await hide(view)[0].events.click();view=await f.mount();
  assert.deepEqual(titles(view),['进行中','完成 B']);assert.equal(f.files.get(f.source),before);
  assert.deepEqual(titles(await f.mount('work-b')),['进行中','完成 A','完成 B']);assert.deepEqual(titles(await f.mount('life')),['生活事项']);
  assert.equal(restore(view).find('hw-task-hidden-count')[0].textContent,'1');assert.equal(restore(view).find('hw-task-hidden-count')[0].hidden,false);assert.equal(restore(view).disabled,false);
  await f.store.patchSettings('work-a',{showCompleted:false});view=await f.mount();await restore(view).events.click();view=await f.mount();
  assert.deepEqual(titles(view),['进行中','完成 A','完成 B']);assert.equal(restore(view).disabled,true);
  const settings=(await f.store.load()).widgets[0].settings;assert.deepEqual(settings.hiddenTaskKeys,[]);assert.equal(settings.showCompleted,true);assert.equal(f.files.get(f.source),before);
});

test('finishing a task exposes a separate hide button; hiding does not toggle completion',async()=>{
  const f=await fixture('- [ ] 工作事项 #area/work ^work-one\n');let view=await f.mount();assert.equal(hide(view).length,0);
  const checkbox=view.body.find('hw-task-main')[0].children[0];checkbox.checked=true;await checkbox.events.change();view=await f.mount();
  assert.equal(hide(view).length,1);assert.equal(view.body.find('hw-task')[0].tag,'div');assert.equal(hide(view)[0].tag,'button');
  const completed=f.files.get(f.source);await hide(view)[0].events.click();view=await f.mount();assert.deepEqual(titles(view),[]);assert.match(view.body.textContent,/已隐藏 1 条/);assert.equal(f.files.get(f.source),completed);
  await restore(view).events.click();assert.deepEqual(titles(await f.mount()),['工作事项']);
});

test('rapid hide actions retain every task, and a subsequent restore wins in click order',async()=>{
  const f=await fixture(sample);let view=await f.mount();
  await Promise.all(hide(view).map(button=>button.events.click()));view=await f.mount();assert.deepEqual(titles(view),['进行中']);
  assert.equal((await f.store.load()).widgets[0].settings.hiddenTaskKeys.length,2);
  await restore(view).events.click();view=await f.mount();await hide(view)[0].events.click();view=await f.mount();
  await Promise.all([hide(view)[0].events.click(),restore(view).events.click()]);view=await f.mount();
  assert.deepEqual(titles(view),['进行中','完成 A','完成 B']);assert.deepEqual((await f.store.load()).widgets[0].settings.hiddenTaskKeys,[]);
});

test('plain Markdown tasks get stable IDs so hiding survives line insertions and identical titles',async()=>{
  const text='- [x] 同名 #area/work\r\n- [x] 同名 #area/work\r\n';
  const f=await fixture(text);let view=await f.mount();await hide(view)[0].events.click();
  const saved=f.files.get(f.source);assert.match(saved,/^- \[x\] 同名 #area\/work \^hw-[\w-]+\r\n- \[x\] 同名 #area\/work\r\n$/);
  f.files.set(f.source,'# 插入标题\r\n'+saved);view=await f.mount();assert.deepEqual(titles(view),['同名']);assert.equal(restore(view).find('hw-task-hidden-count')[0].textContent,'1');
  await restore(view).events.click();assert.deepEqual(titles(await f.mount()),['同名','同名']);
});

test('failed visibility saves keep tasks visible and permit retry',async()=>{
  const f=await fixture(sample),update=f.io.update;let fail=true;
  f.io.update=async(path,fn)=>{if(fail&&path===f.layoutPath)throw new Error('模拟保存失败');return update(path,fn);};
  let view=await f.mount();await hide(view)[0].events.click();view=await f.mount();assert.deepEqual(titles(view),['进行中','完成 A','完成 B']);assert(f.notices.includes('模拟保存失败'));
  fail=false;await hide(view)[0].events.click();assert.deepEqual(titles(await f.mount()),['进行中','完成 B']);
});

test('atomic settings updaters merge simultaneous edits and hide keys include the source file',async()=>{
  const f=await fixture(sample);
  await Promise.all(['done-a','done-b'].map(id=>f.store.patchSettings('work-a',current=>({hiddenTaskKeys:[...(current.hiddenTaskKeys||[]),JSON.stringify([f.source,id])]}))));
  assert.equal((await f.store.load()).widgets[0].settings.hiddenTaskKeys.length,2);
  f.files.set('Home/other.md','- [x] 另一篇的待办 #area/work ^done-a\n');await f.store.patchSettings('work-a',{source:'Home/other.md'});
  assert.deepEqual(titles(await f.mount()),['另一篇的待办']);
});

test('editing keeps completion, block identity, metadata and child content while updating or clearing the date',async()=>{
  const prefix='# 项目\r\n\r\n',child='  任务说明\r\n',sibling='- [ ] 其他事项 #area/work ^other\r\n';
  const f=await fixture(prefix+'* [X] 原标题 #project/alpha 🔁 every day #task #area/work 📅 2026-10-20 ^line-custom\r\n'+child+sibling);
  let task=(await f.service.list(f.source,'work'))[0];
  await f.service.edit(task,{title:task.title.replace('原标题','新标题'),due:'2026-11-08'});
  assert.equal(f.files.get(f.source),prefix+'* [X] 新标题 #project/alpha 🔁 every day #task #area/work 📅 2026-11-08 ^line-custom\r\n'+child+sibling);
  task=(await f.service.list(f.source,'work'))[0];assert.equal(task.done,true);assert.equal(task.id,'line-custom');assert.equal(task.recurring,true);
  await f.service.edit(task,{title:task.title,due:''});assert(!f.files.get(f.source).includes('📅'));assert(f.files.get(f.source).endsWith(child+sibling));
});

test('editing and deleting plain duplicate tasks affect only the chosen occurrence',async()=>{
  const original='- [ ] 同名 #area/work\n- [ ] 同名 #area/work\n';const f=await fixture(original);
  await f.service.edit((await f.service.list(f.source,'work'))[1],{title:'修正后的任务',due:''});
  assert.match(f.files.get(f.source),/^- \[ \] 同名 #area\/work\n- \[ \] 修正后的任务 #area\/work \^hw-[\w-]+\n$/);
  await f.service.remove((await f.service.list(f.source,'work'))[0]);assert.equal((await f.service.list(f.source,'work')).length,1);assert.equal((await f.service.list(f.source,'work'))[0].title,'修正后的任务');
  f.files.set(f.source,original);await f.service.remove((await f.service.list(f.source,'work'))[1]);assert.equal(f.files.get(f.source),'- [ ] 同名 #area/work\n');
});

test('deleting a task removes its child block and keeps siblings, headings and fenced examples',async()=>{
  const prefix='# 笔记\r\n```md\r\n- [ ] 示例 ^parent\r\n```\r\n',sibling='\r\n- [ ] 同级任务 #area/work ^sibling\r\n# 其他内容\r\n';
  const f=await fixture(prefix+'- [ ] 父任务 #area/work ^parent\r\n  说明文字\r\n  - [ ] 子任务 #area/work ^child\r\n    子任务说明\r\n'+sibling);
  await f.service.remove((await f.service.list(f.source,'work'))[0]);assert.equal(f.files.get(f.source),prefix+sibling);
  const remaining=(await f.service.list(f.source,'work'))[0];assert.equal(remaining.id,'sibling');
});

test('invalid edits and stale task or child content never overwrite the source',async()=>{
  const f=await fixture(sample),task=(await f.service.list(f.source,'work'))[0];
  await assert.rejects(f.service.edit(task,{title:' ',due:''}),/请填写任务/);await assert.rejects(f.service.edit(task,{title:'新内容',due:'2026-02-30'}));assert.equal(f.files.get(f.source),sample);
  const changed=sample.replace('进行中','外部已修改');f.files.set(f.source,changed);
  await assert.rejects(f.service.edit(task,{title:'旧编辑器保存',due:''}),/已被修改/);await assert.rejects(f.service.remove(task),/已被修改/);assert.equal(f.files.get(f.source),changed);
  f.files.set(f.source,'- [ ] 父任务 #area/work ^parent\n  原始说明\n');const parent=(await f.service.list(f.source,'work'))[0];
  const childChange='- [ ] 父任务 #area/work ^parent\n  新说明\n';f.files.set(f.source,childChange);await assert.rejects(f.service.remove(parent),/子项已被修改/);assert.equal(f.files.get(f.source),childChange);
});

test('row edit and delete controls open forms and require confirmation before changing data',async()=>{
  const f=await fixture(sample),view=await f.mount();assert.equal(view.body.find('hw-task-edit').length,3);assert.equal(view.body.find('hw-task-delete').length,3);
  view.body.find('hw-task-edit')[0].events.click();const edit=f.dialogs.pop();assert.equal(edit.kind,'edit');assert.deepEqual(edit.args[2],{title:'进行中',due:''});assert.equal(f.files.get(f.source),sample);
  await edit.args[3]({title:'已修正的任务',due:'2026-12-01'});let fresh=await f.mount();assert.deepEqual(titles(fresh),['已修正的任务','完成 A','完成 B']);
  const edited=f.files.get(f.source);fresh.body.find('hw-task-delete')[0].events.click();const confirm=f.dialogs.pop();assert.equal(confirm.kind,'delete');assert.equal(confirm.args[1].content,'已修正的任务');assert.equal(f.files.get(f.source),edited);
  await confirm.args[2]();fresh=await f.mount();assert.deepEqual(titles(fresh),['完成 A','完成 B']);assert.deepEqual(titles(await f.mount('work-b')),['完成 A','完成 B']);assert.deepEqual(titles(await f.mount('life')),['生活事项']);
});

test('invalid cross-category child groups show a warning in both categories instead of disappearing',async()=>{
  const f=await fixture('- [ ] 工作父项 #area/work ^parent\n  - [ ] 生活子项 #area/life ^child\n');
  for(const id of ['work-a','life']){const view=await f.mount(id);assert.deepEqual(titles(view),['工作父项','生活子项']);assert.match(view.body.textContent,/同一分类/);assert(view.body.find('hw-task-main').every(main=>main.children[0].disabled));}
});
