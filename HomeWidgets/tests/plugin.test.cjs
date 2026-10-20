const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');

test('native plugin JSON persistence preserves dates when settings are saved and across reloads',async()=>{
 let disk={homeFile:'homepage.md',countdowns:{version:1,collections:{default:{events:[]}}}};
 class Component{constructor(){this.cleanup=[];}register(fn){this.cleanup.push(fn);}unload(){for(const fn of this.cleanup.splice(0).reverse())fn();}}
 class Plugin extends Component{constructor(app){super();this.app=app;}async loadData(){return JSON.parse(JSON.stringify(disk));}async saveData(value){disk=JSON.parse(JSON.stringify(value));}registerMarkdownCodeBlockProcessor(){}registerEvent(){}addRibbonIcon(){}addCommand(){}addSettingTab(){}}
 const obsidian={Plugin,Component,MarkdownRenderChild:Component,MarkdownRenderer:{},PluginSettingTab:class{},Setting:class{},Notice:class{},parseYaml:()=>({})};
 const sandbox={module:{exports:{}},require:()=>obsidian,AbortController,crypto,console,setTimeout,clearTimeout,setInterval,clearInterval,queueMicrotask};
 vm.runInNewContext(fs.readFileSync(path.resolve(__dirname,'../build/main.js'),'utf8'),sandbox);
 const app={plugins:{plugins:{}},vault:{on:()=>({})},workspace:{}},PluginClass=sandbox.module.exports,plugin=new PluginClass(app);await plugin.onload();
 plugin.settings.homeFile='Home/新首页.md';await Promise.all([plugin.saveSettings(),plugin.services.events.save('default',{title:'JSON 日期',date:'2027-01-01',area:'生活'})]);
 assert.equal(disk.homeFile,'Home/新首页.md');assert.equal(disk.countdowns.collections.default.events.length,1);plugin.unload();
 const reloaded=new PluginClass(app);await reloaded.onload();assert.equal(reloaded.settings.homeFile,'Home/新首页.md');assert.equal((await reloaded.services.events.list('default'))[0].title,'JSON 日期');reloaded.unload();
});
test('built plugin loads through the Obsidian entry contract and unregisters owned renderers',async()=>{
 class Component{constructor(){this.cleanup=[];}load(){return this.onload?.();}register(fn){this.cleanup.push(fn);}unload(){for(const fn of this.cleanup.splice(0).reverse())fn();}}
 class Plugin extends Component{constructor(app){super();this.app=app;this.processors={};this.commands=[];}async loadData(){return null;}registerMarkdownCodeBlockProcessor(type,fn){this.processors[type]=fn;}registerEvent(){}addRibbonIcon(){}addCommand(command){this.commands.push(command);}addSettingTab(){}async saveData(){}}
 class MarkdownRenderChild extends Component{constructor(el){super();this.containerEl=el;}}
 const obsidian={Plugin,MarkdownRenderChild,Component,MarkdownRenderer:{render:async()=>{}},PluginSettingTab:class{},Setting:class{},Notice:class{},parseYaml:()=>({})};
 const sandbox={module:{exports:{}},require:name=>{assert.equal(name,'obsidian');return obsidian;},AbortController,crypto,console,setTimeout,clearTimeout,setInterval,clearInterval,queueMicrotask};
 vm.runInNewContext(fs.readFileSync(path.resolve(__dirname,'../build/main.js'),'utf8'),sandbox);
 const app={plugins:{plugins:{}},vault:{on:()=>({}),getName:()=> 'test'},workspace:{openLinkText:()=>{}}};
 const plugin=new sandbox.module.exports(app);await plugin.onload();assert.equal(typeof plugin.processors['home-widgets'],'function');assert.equal(plugin.registry.list().length,12);assert(plugin.commands.some(c=>c.id==='open-home'));
 const definition={type:'test-quote',label:'测试',defaults:{},mount(){}};assert.equal(plugin.api.version,2);assert.throws(()=>plugin.api.registerWidget(definition),/组件来源必须为对象/);assert.throws(()=>plugin.api.registerWidget(definition,{pluginId:'test'}),/pluginId 和 pluginName/);
 const source={pluginId:'test-plugin',pluginName:'测试插件'};assert.throws(()=>plugin.api.registerWidget({...definition,unknownField:true},source),/字段不受支持/);
 const remove=plugin.api.registerWidget(definition,source);assert.equal(plugin.api.listWidgetTypes().length,13);remove();assert.equal(plugin.api.listWidgetTypes().length,12);
 let unloaded=0;plugin.renders.add({unload(){unloaded++;}});plugin.unload();assert.equal(unloaded,1);assert.equal(plugin.renders.size,0);
});

// A small DOM double for the settings lifecycle; no widget rendering is involved.
class SettingsElement {
 constructor(doc,tag='div',options={}){
  this.ownerDocument=doc;this.tagName=tag;this.children=[];this.dataset={};this.events={};this.hidden=false;
  this.className=typeof options==='string'?options:options.cls||'';this.textContent=options.text||'';
  this.style={values:{},setProperty:(name,value)=>{this.style.values[name]=value;}};
  this.classList={toggle:(name,on)=>{const names=new Set(this.className.split(' ').filter(Boolean));on?names.add(name):names.delete(name);this.className=[...names].join(' ');}};
 }
 createEl(tag,options={}){const el=new SettingsElement(this.ownerDocument,tag,options);this.append(el);return el;}
 createDiv(options={}){return this.createEl('div',options);}
 append(...items){for(const item of items){item.remove();item.parentNode=this;this.children.push(item);}}
 remove(){if(this.parentNode){const p=this.parentNode;p.children.splice(p.children.indexOf(this),1);this.parentNode=null;}}
 empty(){for(const el of [...this.children])el.remove();this.textContent='';}
 replaceChildren(...items){this.empty();this.append(...items);}
 addEventListener(name,fn){(this.events[name]??=[]).push(fn);}
 setAttribute(name,value){(this.attributes??={})[name]=String(value);}
 click(){for(const fn of this.events.click||[])fn({stopPropagation(){}});}
 find(cls){return this.children.flatMap(el=>[...(el.className.split(' ').includes(cls)?[el]:[]),...el.find(cls)]);}
}
async function settingsFixture(read){
 const doc={createElement:tag=>new SettingsElement(doc,tag),createElementNS:(ns,tag)=>new SettingsElement(doc,tag)},dropdowns=[],texts=[],buttons=[];
 class Component{constructor(){this.cleanups=[];}register(fn){this.cleanups.push(fn);}unload(){for(const fn of this.cleanups.splice(0).reverse())fn();}}
 class Plugin extends Component{constructor(app){super();this.app=app;}async loadData(){return null;}registerMarkdownCodeBlockProcessor(){}registerEvent(){}addRibbonIcon(){}addCommand(){}addSettingTab(tab){this.settingsTab=tab;}async saveData(){throw new Error('opening settings must not save');}}
 class PluginSettingTab{constructor(app){this.app=app;this.containerEl=doc.createElement('div');}}
 class Setting{
  constructor(parent){this.settingEl=parent.createDiv('setting-item');}
  setName(name){this.name=name;return this;}setDesc(){return this;}
  addText(fn){const inputEl=doc.createElement('input'),text={name:this.name,inputEl,setValue:v=>{inputEl.value=v;return text;},getValue:()=>inputEl.value||'',setPlaceholder:()=>text,setDisabled:v=>{inputEl.disabled=v;return text;},onChange:f=>{text.change=f;return text;}};texts.push(text);fn(text);return this;}
  addButton(fn){const button={setButtonText:v=>{button.text=v;return button;},setDisabled:v=>{button.disabled=v;return button;},onClick:f=>{button.click=f;return button;}};buttons.push(button);fn(button);return this;}
  addDropdown(fn){const dd={name:this.name,selectEl:doc.createElement('select'),value:'',disabled:false,sets:0,addOption:()=>dd,setValue:v=>{dd.value=v;dd.sets++;return dd;},setDisabled:v=>{dd.disabled=v;return dd;},onChange:f=>{dd.change=f;return dd;}};dropdowns.push(dd);fn(dd);return this;}
 }
 const errors=[],obsidian={Plugin,Component,PluginSettingTab,Setting,MarkdownRenderChild:Component,MarkdownRenderer:{},Notice:class{},parseYaml:()=>({})};
 const sandbox={module:{exports:{}},require:()=>obsidian,AbortController,crypto,console:{...console,error:(...args)=>errors.push(args)},setTimeout,clearTimeout,setInterval,clearInterval,queueMicrotask};
 vm.runInNewContext(fs.readFileSync(path.resolve(__dirname,'../build/main.js'),'utf8'),sandbox);
 const plugin=new sandbox.module.exports({plugins:{plugins:{}},vault:{on(){}},workspace:{}});await plugin.onload();
 let writes=0;plugin.io={read,update:async()=>{writes++;}};
 return {plugin,tab:plugin.settingsTab,dropdowns,texts,buttons,errors,get widths(){return dropdowns.filter(dd=>dd.name==='页面最大宽度');},get writes(){return writes;}};
}
const settingsLayout=(patch={})=>JSON.stringify({version:2,theme:'native',maxWidth:'full',widgets:[{id:'banner',type:'banner',title:'Banner',span:12,settings:{}}],...patch});
const settleSettings=()=>new Promise(resolve=>setImmediate(resolve));

test('opening settings is read-only and keeps component cards inside their tab',async()=>{
 let reads=0;const f=await settingsFixture(async()=>{reads++;return settingsLayout();});f.tab.display();await settleSettings();
 assert.equal(f.errors.length,0);assert.equal(reads,1);assert.equal(f.writes,0);assert.equal(f.dropdowns[0].value,'full');assert.equal(f.dropdowns[0].disabled,false);
 const root=f.tab.containerEl;assert.equal(root.find('hw-home').length,0);assert.equal(root.find('hw-set-card').length,0);
 root.find('hw-set-tab')[1].click();const cards=root.find('hw-set-cards')[0];assert.equal(cards.children.length,1);assert.equal(cards.children[0].parentNode,cards);
 root.find('hw-set-tab')[0].click();assert.equal(root.find('hw-set-panel')[1].hidden,true);
 f.tab.hide();assert.equal(f.plugin.bus.topics.size,0);f.plugin.unload();
});

test('late layout reads cannot update a closed or reopened settings page',async()=>{
 const pending=[];const f=await settingsFixture(()=>new Promise(resolve=>pending.push(resolve)));
 f.tab.display();f.tab.hide();f.tab.display();
 pending[0](settingsLayout({maxWidth:1600}));await settleSettings();assert.equal(f.widths[0].sets,0);assert.equal(f.widths[1].sets,0);
 pending[1](settingsLayout());await settleSettings();assert.equal(f.widths[1].value,'full');assert.equal(f.errors.length,0);
 f.plugin.unload();assert.equal(f.plugin.bus.topics.size,0);
});

test('the update tab survives layout and integration refreshes without writing settings',async()=>{
 const pending=[];const f=await settingsFixture(()=>new Promise(resolve=>pending.push(resolve)));
 f.tab.display();const root=f.tab.containerEl,tabs=root.find('hw-set-tab');
 const updateTab=tabs.find(el=>el.textContent==='更新');assert(updateTab);updateTab.click();
 const updatePanel=root.find('hw-set-panel').find(el=>el.id==='hw-settings-updates');
 const card=updatePanel.find('plugin-update-card')[0];assert(card);assert.equal(updatePanel.hidden,false);
 assert.equal(root.find('hw-set-panel')[0].find('plugin-update-card').length,0);
 pending.shift()(settingsLayout());await settleSettings();
 f.plugin.bus.emit('registry');f.plugin.bus.emit('integrations');f.plugin.bus.emit('layout:Home/widgets.json');
 pending.shift()(settingsLayout({maxWidth:1600}));await settleSettings();
 assert.equal(updatePanel.find('plugin-update-card')[0],card);assert.equal(updatePanel.find('hw-set-subtabs').length,0);
 tabs[1].click();assert.equal(updatePanel.hidden,true);assert(root.find('hw-set-card').length>0);
 updateTab.click();assert.equal(updatePanel.find('plugin-update-card')[0],card);assert.equal(f.errors.length,0);assert.equal(f.writes,0);
 f.plugin.unload();assert.equal(f.plugin.bus.topics.size,0);
});

test('bursts of layout notifications serialize reads and stop on settings teardown',async()=>{
 const pending=[];let reads=0;const f=await settingsFixture(()=>{reads++;return new Promise(resolve=>pending.push(resolve));});f.tab.display();
 for(let i=0;i<10;i++){f.plugin.bus.changed('Home/widgets.json');f.plugin.bus.emit('layout:Home/widgets.json');}
 assert.equal(reads,1);pending[0](settingsLayout());await settleSettings();assert.equal(reads,2);
 f.tab.hide();pending[1](settingsLayout());await settleSettings();assert.equal(reads,2);assert.equal(f.plugin.bus.topics.size,0);assert.equal(f.errors.length,0);
});

test('settings separate builtins from plugin registrations and retain disconnected extension instances',async()=>{
 const widget={id:'calendar-one',type:'my-calendar',title:'我的日历',span:12,settings:{showLunar:true}};
 const f=await settingsFixture(async()=>settingsLayout({widgets:[{id:'banner',type:'banner',title:'Banner',span:12,settings:{}},widget]}));
 const unregister=f.plugin.api.registerWidget({type:'my-calendar',label:'MyCalendar 日历',defaults:{},fields:[],mount(){}},{pluginId:'my-calendar',pluginName:'MyCalendar'});
 assert.equal(f.plugin.registry.source('dataview').kind,'builtin');assert.equal(f.plugin.registry.source('my-calendar').kind,'external');
 assert.equal(f.plugin.registry.source('my-calendar').pluginName,'MyCalendar');
 f.tab.display();await settleSettings();const root=f.tab.containerEl;
 root.find('hw-set-tab')[1].click();assert(root.find('hw-set-subtab').some(el=>el.textContent==='Dataview 查询'));assert(!root.find('hw-set-subtab').some(el=>el.textContent==='MyCalendar 日历'));
 root.find('hw-set-tab')[2].click();const external=root.find('hw-set-panel')[2];assert.equal(external.find('hw-set-subtab').length,1);assert.equal(external.find('hw-set-subtab')[0].textContent,'MyCalendar 日历');assert.equal(external.find('hw-set-card').length,1);
 unregister();assert.equal(f.plugin.registry.source('my-calendar'),undefined);assert.equal(external.find('hw-set-card').length,1);assert.equal(external.find('hw-set-warning').length,1);
 assert.equal(f.writes,0);f.plugin.unload();
});

test('instance switches persist visibility without changing widget settings',async()=>{
 let saved=settingsLayout();const f=await settingsFixture(async()=>saved);let updates=0;
 f.plugin.io.update=async(path,fn)=>{updates++;saved=fn(saved);};f.tab.display();await settleSettings();f.tab.containerEl.find('hw-set-tab')[1].click();
 const toggle=f.tab.containerEl.find('hw-set-switch')[0].children[0];assert.equal(toggle.checked,true);
 toggle.checked=false;await toggle.events.change[0]();await settleSettings();assert.equal(JSON.parse(saved).widgets[0].hidden,true);assert.equal(updates,1);assert.deepEqual(JSON.parse(saved).widgets[0].settings,{});
 const restore=f.tab.containerEl.find('hw-set-switch')[0].children[0];assert.equal(restore.checked,false);restore.checked=true;await restore.events.change[0]();await settleSettings();assert.equal(JSON.parse(saved).widgets[0].hidden,false);f.plugin.unload();
});

test('typography controls persist edits across settings reopening and reset to plugin defaults',async()=>{
 let saved=settingsLayout();const originalWidgets=JSON.parse(saved).widgets;const f=await settingsFixture(async()=>saved);f.plugin.io.update=async(path,fn)=>{saved=fn(saved);};
 f.tab.display();await settleSettings();const control=name=>f.dropdowns.filter(dd=>dd.name===name).at(-1);
 assert.equal(control('首页字体').value,'noto-sans-sc');assert.equal(control('正文字号').value,'15');assert.equal(control('正文行距').value,'1.75');
 control('首页字体').change('custom');control('正文字号').change('18');control('正文行距').change('1.9');
 const custom=f.texts.find(text=>text.name==='自定义字体名称');custom.inputEl.value='Microsoft YaHei';custom.inputEl.events.change[0]();await settleSettings();
 assert.deepEqual(JSON.parse(saved).typography,{font:'custom',fontSize:18,lineHeight:1.9,customFont:'Microsoft YaHei'});assert.deepEqual(JSON.parse(saved).widgets,originalWidgets);
 f.tab.hide();f.tab.display();await settleSettings();assert.equal(control('正文字号').value,'18');assert.equal(control('首页字体').value,'custom');
 assert.equal(f.texts.filter(text=>text.name==='自定义字体名称').at(-1).getValue(),'Microsoft YaHei');
 f.buttons.filter(button=>button.text==='恢复默认排版').at(-1).click();await settleSettings();assert.equal(JSON.parse(saved).typography,undefined);assert.equal(control('正文字号').value,'15');assert.equal(control('正文行距').value,'1.75');assert.equal(control('首页字体').value,'noto-sans-sc');assert.equal(f.errors.length,0);f.plugin.unload();
});

test('settings can create a default instance beside a customized one and delete a hidden instance only after confirmation',async()=>{
 let saved=settingsLayout({widgets:[{id:'banner',type:'banner',title:'原横幅',span:8,hidden:true,settings:{heading:'自定义标题',image:'custom.png'}}]}),form,writes=0;
 const f=await settingsFixture(async()=>saved);f.plugin.io.update=async(path,fn)=>{saved=fn(saved);writes++;};
 f.tab.display();await settleSettings();
 // Replace only the dialog surface while exercising real buttons and storage.
 f.tab.forms={show:(title,fields,initial,save)=>{form={title,fields,initial,save};},dispose(){}};
 const root=f.tab.containerEl;root.find('hw-set-tab')[1].click();root.find('hw-set-add')[0].click();
 assert.equal(writes,0);assert.equal(form.initial.heading,'HOME');assert.equal(form.initial.image,'Home/assets/home-cozy-banner.png');assert.equal(form.initial.span,12);
 const values=Object.fromEntries(form.fields.map(field=>[field.key,form.initial[field.key]??(field.type==='number'?0:field.type==='checkbox'?false:'')]));
 values.title='新横幅';await form.save(values);await settleSettings();
 const widgets=JSON.parse(saved).widgets;assert.equal(widgets.length,2);assert.notEqual(widgets[0].id,widgets[1].id);assert.equal(widgets[0].settings.heading,'自定义标题');assert.equal(widgets[1].settings.heading,'HOME');
 root.find('hw-set-delete')[0].click();assert.equal(form.title,'删除组件实例');assert.equal(JSON.parse(saved).widgets.length,2);assert.equal(writes,1);
 await form.save({});await settleSettings();assert.deepEqual(JSON.parse(saved).widgets,[widgets[1]]);assert.equal(writes,2);assert.equal(root.find('hw-set-card').length,1);f.plugin.unload();
});

test('settings task deletion offers the default uncategorize choice and applies it only after confirmation',async()=>{
 const source='Home/tasks.md';let saved=settingsLayout({widgets:[{id:'work',type:'tasks',title:'工作待办',span:4,hidden:true,settings:{source,area:'work',limit:1}}]}),tasks='- [ ] 工作一 #area/work ^w\n- [x] 工作二 #area/work ^done\n- [ ] 生活 #area/life ^l\n',form,writes=0;
 const f=await settingsFixture(async path=>path===source?tasks:saved);
 f.plugin.io.update=async(path,fn)=>{if(path===source)tasks=fn(tasks);else saved=fn(saved);writes++;};
 f.tab.display();await settleSettings();f.tab.forms={show:(...args)=>{form=args;},dispose(){}};
 const root=f.tab.containerEl;root.find('hw-set-tab')[1].click();root.find('hw-set-subtab').find(el=>el.textContent==='分类待办').click();root.find('hw-set-delete')[0].click();await settleSettings();
 assert.equal(form[0],'删除待办组件');assert.equal(form[2].taskAction,'uncategorize');assert.match(form[5].description.detail,/全部任务：2 项/);assert.equal(writes,0);
 await form[3](form[2]);await settleSettings();assert.equal(JSON.parse(saved).widgets.length,0);assert.match(tasks,/工作一 #area\/uncategorized/);assert.match(tasks,/工作二 #area\/uncategorized/);assert.match(tasks,/生活 #area\/life/);assert.equal(writes,2);f.plugin.unload();
});

