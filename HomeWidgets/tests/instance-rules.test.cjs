const test=require('node:test'),assert=require('node:assert/strict');
const {WidgetRegistry}=require('../src/core/registry');
const {registerBuiltins}=require('../src/widgets');
const {createLayoutStore,DEFAULT_PATH}=require('../src/services/layout');
const {createLayoutEditSession}=require('../src/core/layout-edit-session');
const {showNewWidget}=require('../src/core/widget-instances');
const {Bus}=require('../src/core/lifecycle');
const item=(id,type='banner',patch={})=>({id,type,span:4,settings:{},...patch});
function fixture(){
 const registry=new WidgetRegistry();registerBuiltins(registry);const bus=new Bus();let text=JSON.stringify({version:3,theme:'native',widgets:[]}),queue=Promise.resolve(),writes=0,fail=false;
 const io={read:async()=>text,exists:async()=>true,update:async(path,fn)=>{const next=queue.catch(()=>{}).then(()=>{if(fail)throw Error('write failed');text=fn(text);writes++;});queue=next;await next;}};
 const store=()=>createLayoutStore(io,bus,registry);
 return {registry,bus,io,store,get text(){return text;},get writes(){return writes;},inject:layout=>{text=JSON.stringify(layout);},fail:value=>{fail=value;}};
}
test('hidden singletons reserve a slot, concurrent stores write only one and deletion releases it after save',async()=>{
 const f=fixture(),a=f.store(),b=f.store();const results=await Promise.allSettled([a.add(item('one','banner',{hidden:true})),b.add(item('two'))]);
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(f.writes,1);assert.equal((await b.load()).widgets[0].id,'one');
 const before=f.text;f.fail(true);await assert.rejects(a.remove('one'),/write failed/);assert.equal(f.text,before);f.fail(false);
 await assert.rejects(b.add(item('three')),/单实例/);await a.remove('one');await b.add(item('three'));assert.equal((await a.load()).widgets[0].id,'three');
});
test('tasks and explicitly declared external types allow multiple instances; old cleanup never unregisters a replacement',async()=>{
 const f=fixture(),definition={type:'external',label:'扩展',supportsMultipleInstances:true,defaults:{},mount(){}};
 const old=f.registry.register(definition);await f.store().add(item('task-a','tasks'));await f.store().add(item('task-b','tasks'));
 await f.store().add(item('ext-a','external'));await f.store().add(item('ext-b','external'));old();const next=f.registry.register({...definition});old();assert(f.registry.get('external'));next();
 assert.equal((await f.store().load()).widgets.length,4);await assert.rejects(f.store().add(item('ext-c','external')),/尚未连接/);
 f.registry.register({...definition,supportsMultipleInstances:false});const before=f.text;await assert.rejects(f.store().load(),/单实例组件重复/);assert.equal(f.text,before);
});
test('loading duplicate singletons, removed components or a second layout reports conflicts without dropping data',async()=>{
 const f=fixture();for(const widgets of [[item('a'),item('b','banner',{hidden:true})],[item('old','dataview')],[item('countdown','countdown',{settings:{source:'default'}})]]){
  f.inject({version:3,theme:'native',widgets});const before=f.text;await assert.rejects(f.store().load(),/重复|已移除|日期集合/);assert.equal(f.text,before);assert.equal(f.writes,0);
 }
 assert.throws(()=>createLayoutStore(f.io,f.bus,'Home/ideas.json'),/唯一首页布局/);assert.equal(f.store().path,DEFAULT_PATH);
});
test('drafts cannot replace an unsaved deleted singleton or overwrite a competing window; discard keeps saved instances',async()=>{
 const f=fixture(),first=createLayoutEditSession(f.store()),second=createLayoutEditSession(f.store());
 await first.begin();await second.begin();await first.add(item('a'));await second.add(item('b'));await first.commit();const before=f.text;
 await assert.rejects(second.commit(),/其他位置修改|单实例/);assert.equal(f.text,before);assert.equal(second.active,true);await second.discard();
 await second.begin();await second.remove('a');await assert.rejects(second.add(item('c')),/先保存删除/);await second.discard();assert.equal((await f.store().load()).widgets[0].id,'a');
 await second.begin();await second.remove('a');await second.commit();await second.add(item('c'));assert.equal((await first.load()).widgets[0].id,'c');first.dispose();second.dispose();
});
test('creation rechecks latest persisted slots after the form opened and can restore the hidden instance',async()=>{
 const f=fixture(),store=f.store();let form,located;const forms={show:(title,fields,initial,save)=>{form={title,fields,initial,save};}};
 await showNewWidget(forms,f.registry,store,'banner');const pending=form;await store.add(item('other','banner',{hidden:true}));
 await assert.rejects(pending.save(pending.initial),/单实例/);await showNewWidget(forms,f.registry,store,'banner',{locate:id=>{located=id;}});assert.equal(form.title,'组件已添加');await form.save({});assert.equal(located,'other');assert.equal((await store.load()).widgets[0].hidden,false);
 assert.throws(()=>f.registry.register({type:'invalid',mount(){},supportsMultipleInstances:'true'}),/布尔/);
});

test('a late layout read cannot reopen the creation dialog after its view was closed',async()=>{
 const f=fixture();let resolve,opened=false,active=true;const store={load:()=>new Promise(done=>{resolve=done;})};
 const pending=showNewWidget({show:()=>{opened=true;}},f.registry,store,'banner',{isActive:()=>active});active=false;resolve({widgets:[]});await pending;assert.equal(opened,false);
});
