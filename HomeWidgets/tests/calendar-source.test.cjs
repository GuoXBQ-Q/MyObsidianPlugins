const {test}=require('node:test'),assert=require('node:assert/strict');
const {createPluginDataStore}=require('../src/services/plugin-data');
const {createPersistentEventService}=require('../src/services/persistent-events');
const {createCalendarDisplayStore}=require('../src/services/calendar-display');
const {createCalendarAdapter}=require('../src/adapters/calendar-source');
const {createCountdownService}=require('../src/services/countdown');
const {Bus}=require('../src/core/lifecycle');
const clone=value=>JSON.parse(JSON.stringify(value));
const event=(id='a',patch={})=>({id,title:'来源会议',date:'2026-11-05',...patch});
const independent={id:'event-personal',title:'独立日期',date:'2027-01-01',area:'生活',start:''};
function source(events=[event()]){
 const listeners=new Set();let displays=0,revision=0,rows=clone(events),read;
 const api={version:2,getSnapshot:async()=>read?read():{revision,events:clone(rows)},subscribe(fn){listeners.add(fn);return ()=>listeners.delete(fn);},registerDisplayCapability(){displays++;let active=true;return ()=>{if(active){active=false;displays--;}};}};
 return {api,get listeners(){return listeners.size;},get displays(){return displays;},change(events){rows=clone(events);revision++;for(const fn of [...listeners])fn();},read(fn){read=fn;},emit(){revision++;for(const fn of [...listeners])fn();}};
}
function fixture(initial={countdowns:{version:2,events:[independent]}}){
 let disk=clone(initial),fail=false,connection=null,registered=0,removed=0,writes=0,tick;
 const bus=new Bus(),notifications=[];bus.on('countdown',()=>notifications.push('default'));
 const data=createPluginDataStore({load:async()=>clone(disk),save:async next=>{if(fail)throw Error('disk full');disk=clone(next);writes++;}});
 const display=createCalendarDisplayStore(data),adapter=createCalendarAdapter({display,bus,resolve:()=>connection,
  registerWidget(){registered++;return ()=>removed++;},setTimer(fn){tick=fn;return 1;},clearTimer(){tick=null;}});
 const events=createCountdownService(createPersistentEventService(data,bus),adapter);adapter.start();
 return {adapter,events,display,notifications,get disk(){return clone(disk);},get writes(){return writes;},get registered(){return registered;},get removed(){return removed;},setFail(value){fail=value;},
  async connect(src){connection={source:src.api,widget:{}};adapter.check();await adapter.refresh();},disconnect(){connection=null;adapter.check();},async flush(){await adapter.refresh();},tick(){tick?.();},dispose(){adapter.dispose();}};
}

test('snapshots merge with independent dates without persisting source business fields',async t=>{
 const f=fixture(),s=source();t.after(()=>f.dispose());await f.connect(s);
 const dates=await f.events.list();assert.equal(dates.length,2);assert.equal(dates[1].calendarEventId,'a');
 assert.deepEqual(f.disk.countdowns.events,[independent]);assert.equal(JSON.stringify(f.disk).includes('来源会议'),false);
 const id=dates[1].id;s.change([event('a',{title:'改名',date:'2026-11-09'})]);await f.flush();
 assert.equal((await f.events.list())[1].id,id);assert.equal((await f.events.list())[1].date,'2026-11-09');
 s.change([]);await f.flush();assert.deepEqual(await f.events.list(),[independent]);assert(f.notifications.length>=3);
});

test('archive is local, survives source edits and is cleaned only by a valid removal snapshot',async t=>{
 const f=fixture(),s=source();t.after(()=>f.dispose());await f.connect(s);
 const linked=(await f.events.list())[1];await f.events.archive(linked);
 assert.equal((await f.events.list()).length,1);
 s.change([event('a',{title:'来源已改名'})]);await f.flush();
 const moved=(await f.events.list({includeArchived:true}))[1];assert.equal(moved.id,linked.id);assert.equal(moved.archived,true);
 f.disconnect();assert.equal((await f.events.sourceStatus()).state,'disconnected');assert.equal(await f.events.canClearFeatured(linked.id),false);
 assert.equal(Object.keys(f.disk.countdowns.calendarDisplay.states).length,1);
 await f.connect(s);s.change([]);await f.flush();assert.equal(f.disk.countdowns.calendarDisplay,undefined);assert.equal(await f.events.canClearFeatured(linked.id),true);
});

test('source read failures retain the last snapshot and cannot masquerade as deletion',async t=>{
 const f=fixture(),s=source();t.after(()=>f.dispose());await f.connect(s);
 const linked=(await f.events.list())[1];await f.events.archive(linked);const before=f.disk;
 s.read(async()=>{throw Error('read failed');});s.emit();await f.flush();
 assert.equal((await f.events.sourceStatus()).state,'error');assert.deepEqual(f.disk,before);
 assert.equal((await f.events.list({includeArchived:true})).length,2);assert.equal(await f.events.canClearFeatured(linked.id),false);
 s.read(()=>({revision:99,events:[]}));await f.flush();assert.equal((await f.events.list()).length,1);
});

test('slow old snapshots are discarded after a newer change or a source disconnect',async t=>{
 const f=fixture(),s=source();t.after(()=>f.dispose());await f.connect(s);
 let release;s.read(()=>new Promise(resolve=>release=resolve));const pending=f.adapter.refresh();await new Promise(resolve=>setImmediate(resolve));
 s.change([event('b')]);s.read(()=>({revision:10,events:[event('b')]}));release({revision:1,events:[]});await pending;await f.flush();
 assert.equal((await f.events.list())[1].calendarEventId,'b');
 s.read(()=>new Promise(resolve=>release=resolve));const late=f.adapter.refresh();await new Promise(resolve=>setImmediate(resolve));
 f.disconnect();release({revision:11,events:[]});await late;assert.equal((await f.events.list())[1].calendarEventId,'b');
});

test('load order, API replacements and unload clean old subscriptions, display capability and widget registration',async()=>{
 const f=fixture(),first=source(),second=source([event('b')]);assert.equal((await f.events.list()).length,1);
 await f.connect(first);assert.equal(first.listeners,1);assert.equal(first.displays,1);assert.equal(f.registered,1);
 await f.connect(second);assert.equal(first.listeners,0);assert.equal(first.displays,0);assert.equal(f.removed,1);assert.equal(second.displays,1);
 f.disconnect();assert.equal(second.listeners,0);assert.equal(second.displays,0);assert.equal(f.removed,2);
 await f.connect(second);assert.equal(f.registered,3);f.dispose();assert.equal(second.listeners,0);assert.equal(second.displays,0);assert.equal(f.removed,3);
});

test('display identities and archives persist across reload without copied business fields',async t=>{
 const saved={id:'event-preserved-display',archived:true},initial={countdowns:{version:2,events:[independent],calendarDisplay:{version:1,states:{'event-my-calendar-a':saved}}}};
 const f=fixture(initial),s=source();t.after(()=>f.dispose());await f.connect(s);const linked=(await f.events.list({includeArchived:true}))[1];assert.equal(linked.id,saved.id);assert.equal(linked.archived,true);assert.deepEqual(f.disk.countdowns.events,[independent]);assert.equal(JSON.stringify(f.disk).includes('来源会议'),false);
});

test('display save failures retain local state without keeping deleted source dates; concurrent edits keep independent dates',async t=>{
 const f=fixture(),s=source();t.after(()=>f.dispose());await f.connect(s);const linked=(await f.events.list())[1];
 f.setFail(true);await assert.rejects(f.events.archive(linked),/disk full/);assert.equal((await f.events.list()).length,2);
 f.setFail(false);await Promise.all([f.events.archive(linked),f.events.save({title:'新独立日期',date:'2027-02-01'})]);
 assert.equal(f.disk.countdowns.events.length,2);assert.equal((await f.events.list({includeArchived:true})).length,3);
 const before=f.disk;f.setFail(true);s.change([]);await f.flush();assert.deepEqual(f.disk,before);assert.equal((await f.events.sourceStatus()).state,'error');
 assert.equal((await f.events.list({includeArchived:true})).length,2); // Independent dates only, despite failed metadata cleanup.
 f.setFail(false);await f.flush();assert.equal(f.disk.countdowns.calendarDisplay,undefined);
});

test('malformed or unsupported snapshots retain presentation state and the last valid data',async t=>{
 const f=fixture(),s=source();t.after(()=>f.dispose());await f.connect(s);const linked=(await f.events.list())[1];await f.events.archive(linked);const before=f.disk;
 s.read(()=>({revision:99,events:[event('a',{date:'2026-02-30'})]}));await f.flush();assert.deepEqual(f.disk,before);assert.equal((await f.events.list({includeArchived:true})).length,2);
 s.api.version=99;f.disconnect();await f.connect(s);assert.equal(s.displays,0);assert.deepEqual(f.disk,before);
});

test('concurrent archive actions reject stale presentation state without overwriting the successful action',async t=>{
 const f=fixture(),s=source();t.after(()=>f.dispose());await f.connect(s);const linked=(await f.events.list())[1];
 const results=await Promise.allSettled([f.events.archive(linked),f.events.archive(linked)]);
 assert.equal(results.filter(result=>result.status==='fulfilled').length,1);
 assert.match(results.find(result=>result.status==='rejected').reason.message,/归档状态已变化/);
 assert.equal((await f.events.list({includeArchived:true}))[1].archived,true);
});
