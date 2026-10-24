const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm');
const fs=require('node:fs/promises'),path=require('node:path');
const clone=value=>JSON.parse(JSON.stringify(value));
const personal={id:'event-personal',title:'独立日期',date:'2027-01-01',start:'',area:''};
const linked={id:'meeting',title:'唯一保存的日程',date:'2026-11-05',endDate:'2026-11-08',startTime:'',endTime:'',allDay:true,color:'#3788d8',note:'私密备注',countdown:{collection:'default'}};
async function fixture(t,initial={}){
  const disk={'home-widgets':{countdowns:{version:1,collections:{default:{events:[personal]}}}},'my-calendar':{events:[]},...clone(initial)};
  const writes={'home-widgets':0,'my-calendar':0},fail=new Set(),loaded=new Set();
  class Component {
    constructor(){this.cleanups=[];this.active=true;}
    register(fn){this.cleanups.push(fn);}
    unload(){if(!this.active)return;this.active=false;this.onunload?.();for(const fn of this.cleanups.splice(0).reverse())fn();}
  }
  class Plugin extends Component {
    constructor(app,manifest){super();this.app=app;this.manifest=manifest;}
    async loadData(){return clone(disk[this.manifest.id]);}
    async saveData(next){if(fail.has(this.manifest.id))throw Error('disk full');writes[this.manifest.id]++;disk[this.manifest.id]=clone(next);}
    registerMarkdownCodeBlockProcessor(){} registerEvent(){} addRibbonIcon(){} addCommand(){} registerView(){} addSettingTab(){}
  }
  const obsidian={Plugin,Component,MarkdownRenderChild:Component,ItemView:Component,Modal:Component,MarkdownView:Component,
    PluginSettingTab:class{},Notice:class{},Setting:class{},MarkdownRenderer:{},parseYaml:()=>({}),Platform:{isDesktopApp:false}};
  const app={vault:{on:()=>({})},workspace:{getLeavesOfType:()=>[]},plugins:{plugins:{},enabledPlugins:new Set()}};
  const entries={};
  for(const [project,id] of [['HomeWidgets','home-widgets'],['MyCalendar','my-calendar']]){
    const sandbox={module:{exports:{}},console,AbortController,crypto,setTimeout,clearTimeout,setInterval,clearInterval,queueMicrotask,window:{setTimeout,clearTimeout},
      require:name=>{assert.equal(name,'obsidian');return obsidian;}};
    vm.runInNewContext(await fs.readFile(path.resolve(__dirname,'../../',project,'build/main.js'),'utf8'),sandbox);
    entries[id]=project==='MyCalendar'?sandbox.module.exports.default:sandbox.module.exports;
  }
  function stop(id){const plugin=app.plugins.plugins[id];app.plugins.enabledPlugins.delete(id);delete app.plugins.plugins[id];plugin?.unload();loaded.delete(plugin);}
  t.after(()=>{for(const plugin of loaded)plugin.unload();});
  return {disk,writes,fail,app,stop,async start(id){const plugin=new entries[id](app,{id,version:'0.0.0'});loaded.add(plugin);app.plugins.plugins[id]=plugin;app.plugins.enabledPlugins.add(id);await plugin.onload();return plugin;},
    async flush(home){home.calendar.check();await home.calendar.refresh();},dates:home=>home.services.events.list('default',{includeArchived:true})};
}

for(const first of ['home-widgets','my-calendar'])test(`built plugins connect in ${first} first order and deletion never writes Home Widgets business data`,async t=>{
  const f=await fixture(t),a=await f.start(first);
  if(first==='my-calendar')assert.equal(a.isCountdownAvailable(),false);
  else {assert.equal(await a.services.events.sourceStatus(),null);assert.equal(a.api.countdowns,undefined);}
  const second=first==='my-calendar'?'home-widgets':'my-calendar',b=await f.start(second);
  const home=first==='home-widgets'?a:b,calendar=first==='my-calendar'?a:b;await f.flush(home);
  assert.equal(calendar.isCountdownAvailable(),true);assert(home.registry.get('my-calendar'));
  await calendar.saveEvent(linked,null);await f.flush(home);
  const dates=await f.dates(home);assert.equal(dates.length,2);assert.equal(dates[1].date,linked.date);
  assert.equal(JSON.stringify(f.disk['home-widgets']).includes(linked.title),false);assert.equal(JSON.stringify(f.disk['home-widgets']).includes(linked.note),false);
  const before=f.writes['home-widgets'];f.fail.add('home-widgets');
  await calendar.deleteEvent(clone(calendar.events[0]));await f.flush(home);
  assert.equal((await f.dates(home)).length,1);assert.equal(f.writes['home-widgets'],before);assert.equal((await home.services.events.sourceStatus()).state,'connected');
});

test('built plugin unload/reload releases capability and widget registration, retains display state and reconnects the new source',async t=>{
  const f=await fixture(t),calendar=await f.start('my-calendar');let home=await f.start('home-widgets');await f.flush(home);
  await calendar.saveEvent(linked,null);await f.flush(home);
  const derived=(await f.dates(home))[1];await home.services.events.archive('default',derived);
  f.stop('home-widgets');assert.equal(calendar.isCountdownAvailable(),false);
  home=await f.start('home-widgets');await f.flush(home);assert.equal(calendar.isCountdownAvailable(),true);assert.equal((await f.dates(home))[1].archived,true);
  const source=calendar.countdownSource;f.stop('my-calendar');
  assert.equal((await home.services.events.sourceStatus()).state,'disconnected');assert.equal(home.registry.get('my-calendar'),undefined);
  assert.equal((await f.dates(home))[1].id,derived.id);assert.equal(await home.services.events.canClearFeatured(derived.id),false);await assert.rejects(source.getSnapshot(),/未连接/);
  const next=await f.start('my-calendar');await f.flush(home);
  assert.notEqual(next.countdownSource,source);assert.equal(next.isCountdownAvailable(),true);assert(home.registry.get('my-calendar'));assert.equal((await f.dates(home))[1].archived,true);
  const old=clone(next.events[0]);await next.saveEvent({...old,title:'重新连接后的日程',countdown:{collection:'work'}},old);await f.flush(home);
  assert.equal((await f.dates(home)).length,1);const moved=await home.services.events.list('work',{includeArchived:true});assert.equal(moved[0].id,derived.id);assert.equal(moved[0].archived,true);
  assert.equal(JSON.stringify(f.disk['home-widgets']).includes('重新连接后的日程'),false);
});

test('built plugins atomically convert known copied records, keep display IDs and retain copies after a failed save',async t=>{
  const old={id:'event-copied-display',calendarEventId:linked.id,title:'旧复制标题',date:'2026-11-01',archived:true};
  const f=await fixture(t,{'my-calendar':{events:[linked]},'home-widgets':{countdowns:{version:1,collections:{default:{events:[personal,old]}}}}});
  const calendar=await f.start('my-calendar');f.fail.add('home-widgets');const home=await f.start('home-widgets');await f.flush(home);
  assert.equal((await home.services.events.sourceStatus()).state,'error');assert.equal(f.disk['home-widgets'].countdowns.collections.default.events.length,2);
  f.fail.delete('home-widgets');await f.flush(home);const dates=await f.dates(home);
  assert.equal(dates[1].id,old.id);assert.equal(dates[1].archived,true);assert.equal(dates[1].title,linked.title);
  assert.deepEqual(f.disk['home-widgets'].countdowns.collections.default.events,[personal]);assert.equal(JSON.stringify(f.disk['home-widgets']).includes('旧复制标题'),false);
  const writes=f.writes['home-widgets'];await f.flush(home);assert.equal(f.writes['home-widgets'],writes);
  const state=clone(f.disk['home-widgets'].countdowns.calendarDisplay);f.fail.add('home-widgets');
  await calendar.deleteEvent(clone(calendar.events[0]));await f.flush(home);
  assert.equal((await f.dates(home)).length,1);assert.deepEqual(f.disk['home-widgets'].countdowns.calendarDisplay,state);
  assert.equal((await home.services.events.sourceStatus()).state,'error');
  f.fail.delete('home-widgets');await f.flush(home);assert.equal(f.disk['home-widgets'].countdowns.calendarDisplay,undefined);
});
