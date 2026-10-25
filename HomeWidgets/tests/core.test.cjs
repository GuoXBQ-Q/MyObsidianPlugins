const test=require('node:test'),assert=require('node:assert/strict');
const {Bus,Lifetime}=require('../src/core/lifecycle');
const {WidgetRegistry}=require('../src/core/registry');
const {registerBuiltins}=require('../src/widgets');
const {createLayoutStore,validateLayout}=require('../src/services/layout');
const {createTaskService,parseTasks}=require('../src/services/tasks');
const {createIdeaService}=require('../src/services/ideas');
const {daysUntil}=require('../src/services/date');
const {createIntegrations}=require('../src/adapters/integrations');
const {vaultPath}=require('../src/adapters/vault');
const {DEFAULT_TYPOGRAPHY,typographyValues}=require('../src/core/typography');
const {configureInitial,configurePatch}=require('../src/core/schema');
const {createWidgetInstance,showNewWidget,confirmRemoveWidget}=require('../src/core/widget-instances');
function fixture(){const bus=new Bus(),files=new Map(),queues=new Map();const io={exists:async p=>files.has(p),read:async p=>{if(!files.has(p))throw new Error('missing '+p);return files.get(p);},create:async(p,t)=>{assert(!files.has(p));files.set(p,t);bus.changed(p);},update:async(p,fn)=>{const prev=queues.get(p)||Promise.resolve(),job=prev.then(()=>{files.set(p,fn(files.get(p)));bus.changed(p);});queues.set(p,job.catch(()=>{}));await job;},list:async folder=>[...files.keys()].filter(p=>p.startsWith(folder+'/'))};return {bus,files,io};}

test('new instances use isolated type defaults and only creation confirmation adds them',async()=>{
 const {io,files,bus}=fixture(),registry=new WidgetRegistry();registerBuiltins(registry);
 const def={type:'external-list',supportsMultipleInstances:true,label:'外部列表',span:6,defaults:{items:['默认条目'],internal:{enabled:true}},fields:[],mount(){}};
 const unregister=registry.register(def),first=createWidgetInstance(def),second=createWidgetInstance(def);
 first.settings.items.push('第一实例');first.settings.internal.enabled=false;assert.deepEqual(second.settings,def.defaults);assert.notEqual(first.id,second.id);
 const store=createLayoutStore(io,bus);files.set(store.path,JSON.stringify({version:3,theme:'native',widgets:[first]}));
 let form;const forms={show:(title,fields,initial,save)=>{form={initial,save};}};
 await showNewWidget(forms,registry,store,def.type);assert.equal((await store.load()).widgets.length,1);assert.equal(form.initial.title,def.label);
 await form.save({title:'新增列表',span:6,tint:'plain',background:'',widgetHeight:0,cssClasses:''});
 const saved=await store.load();assert.equal(saved.widgets.length,2);assert.deepEqual(saved.widgets[1].settings,def.defaults);assert.deepEqual(saved.widgets[0],first);
 await showNewWidget(forms,registry,store,def.type);unregister();await assert.rejects(form.save(form.initial),/断开/);assert.equal((await store.load()).widgets.length,2);
});

test('deleting a hidden instance requires confirmation and preserves peer instances and source data',async()=>{
 const {io,files,bus}=fixture(),store=createLayoutStore(io,bus),source='Home/tasks.md';files.set(source,'- [ ] 保留原待办\n');
 const one={id:'one',type:'tasks',title:'已隐藏',span:4,hidden:true,settings:{source}},two={...one,id:'two',hidden:false};
 files.set(store.path,JSON.stringify({version:3,theme:'native',widgets:[one,two]}));
 let confirm;const forms={show:(title,fields,initial,save)=>{confirm=save;}};
 await confirmRemoveWidget(forms,store,one);assert.deepEqual((await store.load()).widgets,[one,two]);await confirm({taskAction:'uncategorize'});
 assert.deepEqual((await store.load()).widgets,[two]);assert.equal(files.get(source),'- [ ] 保留原待办\n');
});
test('initialization creates only the current empty layout and unsupported formats or fields never write',async()=>{
 const {io,files,bus}=fixture(),store=createLayoutStore(io,bus);assert.deepEqual(await store.initialize(),{version:3,theme:'native',widgets:[]});const saved=files.get(store.path);
 for(const version of [1,2,4])assert.throws(()=>validateLayout({version,theme:'native',widgets:[]}),/version: 3/);
 await assert.rejects(store.page({unknownField:true}),/字段不受支持/);assert.equal(files.get(store.path),saved);
 await store.add({id:'banner',type:'banner',title:'横幅',span:12,settings:{}});const withBanner=files.get(store.path);
 await assert.rejects(store.patchWidget('banner',{unknownField:1}),/字段不受支持/);assert.equal(files.get(store.path),withBanner);
});
test('store supports independent instances, atomic patches, reorder and hide/restore',async()=>{
 const {io,files,bus}=fixture(),store=createLayoutStore(io,bus);await store.initialize();await store.add({id:'banner-main',type:'tasks',title:'主横幅',span:12,settings:{}});
 await store.add({id:'banner-second',type:'tasks',title:'第二横幅',span:6,settings:{image:'another.png'}});
 await Promise.all([store.patchWidget('banner-main',{settings:{heading:'独立标题'}}),store.patchWidget('banner-second',{background:'bg.png'})]);
 let layout=await store.load();assert.equal(layout.widgets[0].settings.heading,'独立标题');assert.equal(layout.widgets.at(-1).settings.image,'another.png');
 await store.before('banner-second','banner-main');assert.equal((await store.load()).widgets[0].id,'banner-second');
 await store.patchWidget('banner-second',{hidden:true});assert.equal((await store.load()).widgets[0].hidden,true);
 await store.patchWidget('banner-second',{hidden:false});assert.equal((await store.load()).widgets[0].hidden,false);
 const saved=files.get('Home/widgets.json');await store.initialize();assert.equal(files.get('Home/widgets.json'),saved);
 assert.throws(()=>validateLayout({version:3,theme:'sage',widgets:[{id:'a',type:'tasks',span:4},{id:'a',type:'tasks',span:4}]}),/重复/);
});
test('registry and event bus isolate unrelated widgets and clean subscriptions',()=>{
 const registry=new WidgetRegistry();registerBuiltins(registry);assert.equal(registry.list().length,9);assert.throws(()=>registry.register(registry.get('banner')),/重复/);
 const bus=new Bus(),life=new Lifetime(),calls=[];life.own(bus.on('file:tasks.md',()=>calls.push('task')));life.own(bus.on('folder:Ideas',()=>calls.push('idea')));bus.changed('tasks.md');assert.deepEqual(calls,['task']);bus.changed('Ideas/one.md');assert.deepEqual(calls,['task','idea']);life.dispose();life.dispose();bus.changed('tasks.md');assert.equal(calls.length,2);assert.equal(bus.topics.size,0);
});
test('tasks preserve duplicate identity, detect stale edits, skip fenced examples and delegate recurrence to Tasks',async()=>{
 const {io,files}=fixture(),source='Home/待办.md';files.set(source,'# 待办\n- [ ] 同名 #area/work ^id-a\n- [ ] 同名 #area/life ^id-b\n```md\n- [ ] 示例 ^example\n```\n');const tasks=createTaskService(io,{taskTransform:()=>null});let list=await tasks.list(source);assert.equal(list.length,2);await tasks.toggle(list[0],true);list=await tasks.list(source);assert(list[0].done);assert(!list[1].done);
 const stale=list[1];files.set(source,files.get(source).replace('同名 #area/life','已修改 #area/life'));await assert.rejects(tasks.toggle(stale,true),/已被修改/);
 files.set(source,'- [ ] 周期 🔁 every day ^repeat\n');await assert.rejects(tasks.toggle((await tasks.list(source))[0],true),/Tasks/);
 let called=0;const integrated=createTaskService(io,{taskTransform:()=>async(line,file)=>{called++;assert.equal(file,source);return line.replace('[ ]','[x]')+'\n'+line;}});await integrated.toggle((await integrated.list(source))[0],true);assert.equal(called,1);const recur=await integrated.list(source);assert.equal(recur.length,2);assert.notEqual(recur[0].id,recur[1].id);assert(recur[0].done);assert(!recur[1].done);
});
test('capture round-trip and archive/restore preserve text, and calendar arithmetic respects leap days',async()=>{
 const {io}=fixture(),ideas=createIdeaService(io);
 const body='新的灵感\n\n<script>只是文字</script>\n中文 "引号"';const p=await ideas.capture('Inbox/Ideas',{body,area:'学习'});assert.equal((await ideas.list('Inbox/Ideas'))[0].body,body);await ideas.archive('Inbox/Ideas',p,true);assert.equal((await ideas.list('Inbox/Ideas'))[0].status,'archived');await ideas.archive('Inbox/Ideas',p,false);assert.equal((await ideas.list('Inbox/Ideas'))[0].status,'inbox');
 assert.equal(daysUntil('2026-11-01',new Date(2026,9,16,23,59)),16);assert.equal(daysUntil('2028-03-01',new Date(2028,1,28)),2);assert.throws(()=>daysUntil('2026-02-30'));
});
test('public Markdown rendering owns its children and required integrations fail independently',async()=>{
 let loaded=0,unloaded=0,text='';class Component{load(){loaded++;}unload(){unloaded++;}}
 const app={plugins:{plugins:{}},commands:{executeCommandById:id=>id==='daily-notes'}};
 const api=createIntegrations(app,{Component,MarkdownRenderer:{render:async(app,value)=>{text=value;}}}),life=new Lifetime();assert.deepEqual(api.status(),{tasks:false,quickadd:false});await api.renderMarkdown('**内容**',{},life,'home.md');assert.equal(text,'**内容**');assert.equal(loaded,1);life.dispose();assert.equal(unloaded,1);
 assert.equal(api.taskTransform(),null);await assert.rejects(api.quickAdd('Capture',{}),/QuickAdd/);await api.command('daily-notes');await assert.rejects(api.command('missing'),/找不到命令/);
});
test('vault paths reject traversal and reserved locations while accepting note paths',()=>{
 for(const bad of ['../secrets','.obsidian/data.json','C:/file','/absolute','Home/../../other'])assert.throws(()=>vaultPath(bad));assert.equal(vaultPath('Home/待办.md'),'Home/待办.md');
});

test('default typography and concurrent updates preserve other layout data',async()=>{
 const {io,files,bus}=fixture();const layout={version:3,theme:'native',widgets:[{id:'tasks-work',type:'tasks',span:4,settings:{hiddenTaskKeys:['retained'],source:'Home/tasks.md'}}],maxWidth:'full'};
 files.set('Home/widgets.json',JSON.stringify(layout));const store=createLayoutStore(io,bus);assert.deepEqual(typographyValues((await store.load()).typography),DEFAULT_TYPOGRAPHY);const initial=files.get(store.path);await store.load();assert.equal(files.get(store.path),initial);
 await Promise.all([store.typography({font:'custom',customFont:'Microsoft YaHei'}),store.typography({fontSize:18}),store.typography({lineHeight:1.9})]);
 const saved=await store.load();assert.deepEqual(saved.typography,{font:'custom',customFont:'Microsoft YaHei',fontSize:18,lineHeight:1.9});assert.deepEqual(saved.widgets,layout.widgets);assert.equal(saved.maxWidth,'full');assert.equal(saved.theme,'native');
 await store.page({typography:undefined});assert.equal((await store.load()).typography,undefined);assert.deepEqual(typographyValues(),DEFAULT_TYPOGRAPHY);
});

test('typography rejects invalid fonts and dimensions without altering saved layouts',async()=>{
 const {io,files,bus}=fixture(),store=createLayoutStore(io,bus);files.set(store.path,JSON.stringify({version:3,theme:'native',widgets:[]}));const original=files.get(store.path);
 for(const patch of [{font:'unknown'},{fontSize:11},{fontSize:25},{fontSize:15.5},{lineHeight:1},{lineHeight:3},{lineHeight:NaN},{customFont:'bad\nfont'},{customFont:'x'.repeat(101)},{unknownField:true}]){
  await assert.rejects(store.typography(patch));assert.equal(files.get(store.path),original);
 }
 for(const typography of [null,[],5])assert.throws(()=>validateLayout({version:3,theme:'native',widgets:[],typography}));
 assert.deepEqual(typographyValues({fontSize:undefined}),DEFAULT_TYPOGRAPHY);
});

test('instance CSS classes stay independent of widget settings and survive normal layout changes',async()=>{
 const {io,files,bus}=fixture(),store=createLayoutStore(io,bus),widgets=['work','life'].map(id=>({id,type:'tasks',title:id,span:4,settings:{source:'Home/tasks.md',area:id,hiddenTaskKeys:['saved']}}));
 files.set(store.path,JSON.stringify({version:3,theme:'native',widgets}));
 const patch=configurePatch(widgets[0],{}, {title:'工作',span:4,tint:'plain',background:'',widgetHeight:380,cssClasses:'work-focus  compact work-focus',source:'Home/tasks.md',area:'work'});
 assert.equal(patch.cssClasses,'work-focus compact');assert.equal(Object.hasOwn(patch.settings,'cssClasses'),false);
 await store.patchWidget('work',patch);await store.patchWidget('work',{hidden:true});const saved=await store.load();
 assert.equal(saved.widgets[0].cssClasses,'work-focus compact');assert.equal(saved.widgets[1].cssClasses,undefined);assert.deepEqual(saved.widgets[0].settings.hiddenTaskKeys,['saved']);
 assert.equal(configureInitial(saved.widgets[0],{}).cssClasses,'work-focus compact');
});

test('invalid CSS classes cannot replace host layout or interaction classes',async()=>{
 const {io,files,bus}=fixture(),store=createLayoutStore(io,bus);files.set(store.path,JSON.stringify({version:3,theme:'native',widgets:[{id:'task',type:'tasks',span:4}]}));const original=files.get(store.path);
 for(const cssClasses of ['.work-focus','2column','hw-widget','is-dragging','home-widgets-test','work; color:red',[]]){
  await assert.rejects(store.patchWidget('task',{cssClasses}));assert.equal(files.get(store.path),original);
 }
});

