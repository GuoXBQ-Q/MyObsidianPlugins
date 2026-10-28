const {test}=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),vm=require('node:vm');
const esbuild=require('esbuild'),clone=value=>JSON.parse(JSON.stringify(value));
function compile(file,extras={}){const module={exports:{}};vm.runInNewContext(esbuild.buildSync({entryPoints:[path.join(__dirname,'../src',file)],bundle:true,write:false,platform:'node',format:'cjs',external:['obsidian']}).outputFiles[0].text,{module,exports:module.exports,console,...extras});return module.exports;}
const {CountdownSource}=compile('countdown-source.ts');
const event=(id='a',patch={})=>({id,title:'日程标题',date:'2026-11-05',color:'blue',createdAt:1,...patch});

test('source snapshots expose only committed linked dates and keep errors separate from empty snapshots',async()=>{
 let events=[event('a'),event('b',{countdown:true,endDate:'2026-11-09',note:'private',startTime:'12:00'})];
 const source=new CountdownSource(()=>events);assert.equal(source.version,2);
 assert.deepEqual(clone(await source.getSnapshot()),{revision:0,events:[{id:'b',title:'日程标题',date:'2026-11-05'}]});
 const snapshot=await source.getSnapshot();snapshot.events[0].title='mutated';assert.equal((await source.getSnapshot()).events[0].title,'日程标题');
 events=[];source.changed();assert.deepEqual(clone(await source.getSnapshot()),{revision:1,events:[]});
 source.dispose();await assert.rejects(source.getSnapshot(),/未连接/);
});

test('display capability leases and subscriptions clean up independently and on source disposal',()=>{
 const source=new CountdownSource(()=>[]);let changes=0;const off=source.subscribe(()=>changes++),a=source.registerDisplayCapability(),b=source.registerDisplayCapability();
 assert.equal(source.canDisplay,true);a();a();assert.equal(source.canDisplay,true);b();assert.equal(source.canDisplay,false);
 source.changed();assert.equal(changes,1);off();source.changed();assert.equal(changes,1);
 source.registerDisplayCapability();source.dispose();assert.equal(source.canDisplay,false);assert.throws(()=>source.registerDisplayCapability(),/未连接/);
});

test('availability listeners observe only first connect and last disconnect without publishing data changes',async()=>{
 const source=new CountdownSource(()=>[]),states=[];let dataChanges=0;
 source.subscribe(()=>dataChanges++);const off=source.subscribeAvailability(()=>states.push(source.canDisplay));
 const a=source.registerDisplayCapability(),b=source.registerDisplayCapability();a();a();b();b();
 assert.deepEqual(states,[true,false]);assert.equal(dataChanges,0);assert.equal((await source.getSnapshot()).revision,0);
 source.registerDisplayCapability();off();source.dispose();assert.deepEqual(states,[true,false,true]);
 assert.throws(()=>source.subscribeAvailability(()=>{}),/未连接/);
});

test('source disposal notifies open UI once and clears its availability subscription',()=>{
 const source=new CountdownSource(()=>[]),states=[];source.subscribeAvailability(()=>states.push(source.canDisplay));
 const release=source.registerDisplayCapability();source.dispose();release();source.dispose();assert.deepEqual(states,[true,false]);
});

async function fixture(initial=[]){
 let disk={events:clone(initial),settings:{},fetchedHolidays:[]},fail=false;
 class Component{constructor(){this.cleanups=[];}register(fn){this.cleanups.push(fn);}unload(){this.onunload?.();for(const fn of this.cleanups.splice(0).reverse())fn();}}
 class Plugin extends Component{constructor(app,manifest){super();this.app=app;this.manifest=manifest;}async loadData(){return clone(disk);}async saveData(value){if(fail)throw Error('disk full');disk=clone(value);}registerView(){}addRibbonIcon(){}addSettingTab(){}addCommand(){}}
 const obsidian={Plugin,ItemView:class{},Modal:class{},PluginSettingTab:class{},Notice:class{},Platform:{isDesktopApp:false}};
 const {default:Calendar}=compile('main.ts',{require:name=>{if(name==='obsidian')return obsidian;return require(name);},setTimeout,clearTimeout,setInterval,clearInterval,window:{setTimeout,clearTimeout}});
 const plugin=new Calendar({workspace:{getLeavesOfType:()=>[]}},{});await plugin.onload();
 return {plugin,get disk(){return clone(disk);},setFail(value){fail=value;}};
}
test('failed source saves notify nobody and do not expose uncommitted changes; retries and stale editors are protected',async t=>{
 const original=event('a',{countdown:true}),f=await fixture([original]);t.after(()=>f.plugin.unload());let notified=0;f.plugin.countdownSource.subscribe(()=>notified++);
 f.setFail(true);await assert.rejects(f.plugin.saveEvent({...original,title:'未保存'},clone(original)),/disk full/);
 assert.equal(notified,0);assert.equal((await f.plugin.countdownSource.getSnapshot()).events[0].title,'日程标题');
 f.setFail(false);await f.plugin.saveEvent({...original,title:'已保存'},clone(original));assert.equal(notified,1);
 await assert.rejects(f.plugin.saveEvent({...original,title:'旧编辑'},clone(original)),/已变化/);assert.equal(f.disk.events[0].title,'已保存');
});
test('concurrent adds, edits, unlink and deletion publish valid snapshots without any host writer',async t=>{
 const f=await fixture();t.after(()=>f.plugin.unload());assert.equal(f.plugin.isCountdownAvailable(),false);
 const off=f.plugin.countdownSource.registerDisplayCapability();assert.equal(f.plugin.isCountdownAvailable(),true);
 await Promise.all([f.plugin.saveEvent(event('a',{countdown:true}),null),f.plugin.saveEvent(event('b'),null)]);
 assert.equal(f.disk.events.length,2);let current=clone(f.plugin.events[0]);
 await f.plugin.saveEvent({...current,title:'改名后'},current);assert.equal((await f.plugin.countdownSource.getSnapshot()).events[0].title,'改名后');
 current=clone(f.plugin.events[0]);const unlinked={...current};delete unlinked.countdown;await f.plugin.saveEvent(unlinked,current);
 assert.equal((await f.plugin.countdownSource.getSnapshot()).events.length,0);await f.plugin.deleteEvent(clone(f.plugin.events[0]));assert.equal(f.disk.events[0].id,'b');
 off();assert.equal(f.plugin.isCountdownAvailable(),false);
});
test('unavailable display integration hides capability without losing existing links; source reloads expose saved data',async t=>{
 const initial=event('a',{countdown:true}),f=await fixture([initial]);t.after(()=>f.plugin.unload());
 const lease=f.plugin.countdownSource.registerDisplayCapability();lease();await f.plugin.saveEvent({...initial,title:'断开期间修改'},initial);
 assert.equal(f.plugin.isCountdownAvailable(),false);assert.deepEqual(f.disk.events[0].countdown,true);
 assert.equal((await f.plugin.countdownSource.getSnapshot()).events[0].title,'断开期间修改');
 const source=f.plugin.countdownSource;f.plugin.onunload();await assert.rejects(source.getSnapshot(),/未连接/);
});
test('a failed delete retains the source and a render failure cannot suppress committed notifications',async t=>{
 const initial=event('a',{countdown:true}),f=await fixture([initial]);t.after(()=>f.plugin.unload());let changes=0;f.plugin.countdownSource.subscribe(()=>changes++);
 f.setFail(true);await assert.rejects(f.plugin.deleteEvent(initial),/disk full/);assert.equal(changes,0);assert.equal(f.disk.events.length,1);
 f.setFail(false);f.plugin.refreshViews=()=>{throw Error('render failure');};await f.plugin.deleteEvent(initial);assert.equal(changes,1);assert.equal((await f.plugin.countdownSource.getSnapshot()).events.length,0);
});
test('event completion toggles persist, refresh all subscribers and survive reload without changing linked dates',async t=>{
 const initial=event('a',{countdown:true,note:'保留备注',important:true}),f=await fixture([initial]);t.after(()=>f.plugin.unload());
 let refreshes=0,changes=0;f.plugin.onRefresh(()=>refreshes++);f.plugin.countdownSource.subscribe(()=>changes++);
 assert.equal(!!f.plugin.events[0].completed,false);
 await f.plugin.toggleEventCompleted('a');
 assert.deepEqual(f.disk.events[0],{...initial,completed:true});assert.equal(f.plugin.events[0].completed,true);assert.equal(refreshes,1);assert.equal(changes,0);
 f.plugin.events=[];await f.plugin.loadSettings();assert.equal(f.plugin.events[0].completed,true);
 const current=clone(f.plugin.events[0]);await f.plugin.saveEvent({...current,title:'完成后编辑'},current);
 assert.equal(f.plugin.events[0].completed,true);assert.equal(f.disk.events[0].title,'完成后编辑');
 await f.plugin.toggleEventCompleted('a');assert.equal(f.plugin.events[0].completed,false);assert.equal(f.disk.events[0].completed,false);
});

test('completion uses the latest queued event and consecutive clicks toggle independently',async t=>{
 const initial=event(),f=await fixture([initial]);t.after(()=>f.plugin.unload());
 await Promise.all([f.plugin.saveEvent({...initial,title:'最新标题'},initial),f.plugin.toggleEventCompleted('a')]);
 assert.equal(f.disk.events[0].title,'最新标题');assert.equal(f.disk.events[0].completed,true);
 await Promise.all([f.plugin.toggleEventCompleted('a'),f.plugin.toggleEventCompleted('a')]);assert.equal(f.disk.events[0].completed,true);
 await assert.rejects(f.plugin.saveEvent({...initial,title:'旧编辑'},initial),/已变化/);assert.equal(f.disk.events[0].completed,true);
 await assert.rejects(f.plugin.toggleEventCompleted('missing'),/已被删除/);assert.equal(f.disk.events.length,1);
});

test('failed completion writes retain memory and disk state and a later toggle can retry',async t=>{
 const initial=event(),f=await fixture([initial]);t.after(()=>f.plugin.unload());let refreshes=0;f.plugin.onRefresh(()=>refreshes++);
 f.setFail(true);await assert.rejects(f.plugin.toggleEventCompleted('a'),/disk full/);
 assert.deepEqual(clone(f.plugin.events),[initial]);assert.deepEqual(f.disk.events,[initial]);assert.equal(refreshes,0);
 f.setFail(false);await f.plugin.toggleEventCompleted('a');assert.equal(f.plugin.events[0].completed,true);assert.equal(refreshes,1);
});

test('shared widget styles stay until the last widget in each document releases them',()=>{
 const {acquireCalendarWidgetStyles}=compile('widget-styles.ts');
 function document(){const styles=[];return {styles,createElement(){return {remove(){styles.splice(styles.indexOf(this),1);}};},head:{append(style){styles.push(style);}}};}
 const doc=document(),other=document(),a=acquireCalendarWidgetStyles(doc),b=acquireCalendarWidgetStyles(doc),c=acquireCalendarWidgetStyles(other);
 assert.equal(doc.styles.length,1);a();a();assert.equal(doc.styles.length,1);assert.equal(other.styles.length,1);
 b();assert.equal(doc.styles.length,0);assert.equal(other.styles.length,1);c();assert.equal(other.styles.length,0);
 const again=acquireCalendarWidgetStyles(doc);assert.equal(doc.styles.length,1);again();assert.equal(doc.styles.length,0);
});
