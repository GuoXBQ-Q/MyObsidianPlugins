const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {createRequire}=require('node:module'),date=require('../src/services/date');
const filename=path.resolve(__dirname,'../src/widgets/countdown/index.js'),nativeRequire=createRequire(filename),moduleStub={exports:{}};
vm.runInNewContext(fs.readFileSync(filename,'utf8'),{module:moduleStub,require:name=>name==='../../services/date'?{daysUntil:value=>date.daysUntil(value,new Date(2026,9,17,12)),localDay:()=> '2026-10-17'}:nativeRequire(name)});
const widget=moduleStub.exports;
class Node {
  constructor(tag){this.tag=tag;this.nodeType=1;this.childNodes=[];this.attributes={};this.events={};}
  append(...nodes){this.childNodes.push(...nodes.map(n=>typeof n==='string'?{nodeType:3,textContent:n}:n));}
  replaceChildren(...nodes){this.childNodes=[];this.append(...nodes);}
  setAttribute(key,value){this.attributes[key]=String(value);}
  addEventListener(key,fn){this.events[key]=fn;}
  get textContent(){return this.childNodes.map(n=>n.textContent).join('');}
  set textContent(value){this.replaceChildren(String(value));}
  find(cls){return this.childNodes.filter(n=>n.nodeType===1).flatMap(n=>[...(n.className?.split(' ').includes(cls)?[n]:[]),...n.find(cls)]);}
}
const doc={createElement:tag=>new Node(tag),createElementNS:(ns,tag)=>new Node(tag),createTextNode:text=>({nodeType:3,textContent:String(text)})};
const sample=[
  {id:'event-old',title:'已结束',date:'2026-10-01',area:'工作'},
  {id:'event-project',title:'项目里程碑',date:'2026-11-01',start:'2026-10-01',area:'工作'},
  {id:'event-weekend',title:'留给自己的周末',date:'2026-10-18',area:'生活'},
  {id:'event-newyear',title:'迎接新的一年',date:'2027-01-01',area:'生活'},
];
async function mount(events=sample,settings={},aborted=false,local={}){
  const el=new Node('body'),actions=new Node('header'),dialogs=[],saves=[],timers=[],confirmations=[],deletes=[],refreshes=[],patches=[],errors=[];
  const ctx={id:'test-countdown',local,doc,el,actions,config:{...widget.defaults,featured:'event-project',...settings},signal:{aborted},services:{events:{list:async()=>events,save:async(...args)=>saves.push(args),remove:async(...args)=>deletes.push(args)}},forms:{show:(...args)=>dialogs.push(args),confirm:(...args)=>confirmations.push(args)},lifetime:{interval:(...args)=>timers.push(args)},refresh:()=>refreshes.push(true),updateConfig:async patch=>patches.push(patch),run:async fn=>{try{return await fn();}catch(e){errors.push(e.message);}}};
  await widget.mount(ctx);return {ctx,el,actions,dialogs,saves,timers,confirmations,deletes,refreshes,local,patches,errors};
}
test('pinned countdown retains its date, while upcoming items precede expired dates',async()=>{
  const f=await mount(sample,{upcoming:2});
  assert.equal(f.el.find('hw-countdown-title')[0].textContent,'项目里程碑');
  assert.equal(f.el.find('hw-countdown-number')[0].textContent,'15天');
  assert.equal(f.el.find('hw-countdown-caption').length,0);assert.equal(f.el.find('hw-countdown-calendar')[0].attributes['aria-label'],'2026年11月1日 · 周日');
  assert.deepEqual(f.el.find('hw-countdown-event-title').map(n=>n.textContent),['留给自己的周末','迎接新的一年']);
  assert.deepEqual(f.el.find('hw-countdown-remaining').map(n=>n.textContent),['明天','76 天']);
  assert.equal(f.el.find('hw-countdown-event-date')[1].textContent,'2027年1月1日 · 周五');
  assert.equal(f.el.find('hw-countdown-pin').length,1);assert.equal(f.el.find('hw-countdown-track').length,0);
  assert.equal(f.timers[0][1],60000);
});
test('automatic selection chooses the closest future event, with today and expired states handled',async()=>{
  const auto=await mount(sample,{featured:''});assert.equal(auto.el.find('hw-countdown-title')[0].textContent,'留给自己的周末');assert.equal(auto.el.find('hw-countdown-pin')[0].textContent,'自动选择');
  const today=await mount([{id:'today',title:'今天的目标',date:'2026-10-17'}]);
  assert.equal(today.el.find('hw-countdown-status')[0].textContent,'就是今天');assert.equal(today.el.find('hw-countdown-number')[0].textContent,'0天');
  const past=await mount([sample[0],{id:'recent',title:'最近结束',date:'2026-10-16'}]);
  assert.equal(past.el.find('hw-countdown-title')[0].textContent,'最近结束');assert.equal(past.el.find('hw-countdown-status')[0].textContent,'距离目标已过去');assert.equal(past.el.find('hw-countdown-number')[0].textContent,'1天');
});
test('add, hero edit and list edit continue saving through the date service',async()=>{
  const f=await mount();f.actions.find('hw-countdown-add')[0].events.click();assert.equal(f.dialogs[0][0],'添加关键日期');
  f.el.find('hw-countdown-edit')[0].events.click();await f.dialogs[1][3]({title:'新名称',date:'2026-11-02'});
  assert.deepEqual(JSON.parse(JSON.stringify(f.saves[0])),['default',{title:'新名称',date:'2026-11-02',id:'event-project'}]);
  f.el.find('hw-countdown-event')[0].events.click();assert.equal(f.dialogs[2][2].id,'event-weekend');
});
test('zero limit and default settings show all dates, while empty data and cancelled mount avoid stale UI',async()=>{
  const all=await mount(sample,{upcoming:0});assert.equal(all.el.find('hw-countdown-event').length,3);assert.equal(all.el.find('hw-countdown-list-toggle').length,0);
  assert.equal((await mount()).el.find('hw-countdown-event').length,3);
  const empty=await mount([]);assert.match(empty.el.textContent,/添加一个值得期待/);assert.equal(empty.actions.find('hw-countdown-add').length,1);
  const aborted=await mount(sample,{},true);assert.equal(aborted.el.childNodes.length,0);assert.equal(aborted.actions.childNodes.length,0);
});
test('limited lists have an expand/collapse control that survives widget refreshes',async()=>{
  const f=await mount(sample,{upcoming:2}),toggle=f.el.find('hw-countdown-list-toggle')[0];
  assert.equal(f.el.find('hw-countdown-event').length,2);assert.equal(toggle.textContent,'查看全部（3）');assert.equal(toggle.attributes['aria-expanded'],'false');
  toggle.events.click();assert.equal(f.el.find('hw-countdown-event').length,3);assert.equal(toggle.attributes['aria-expanded'],'true');
  assert.equal((await mount(sample,{upcoming:2},false,f.local)).el.find('hw-countdown-event').length,3);
  toggle.events.click();assert.equal(f.el.find('hw-countdown-event').length,2);assert.equal(f.local.countdownExpanded,false);
});
test('default list includes many dates and expired records, with no hard-coded maximum',async()=>{
  const events=[sample[1],...Array.from({length:45},(_,i)=>({id:'event-'+i,title:'日期 '+i,date:'2027-02-01',area:'生活'})),sample[0]];
  const f=await mount(events);assert.equal(f.el.find('hw-countdown-event').length,46);assert.equal(f.el.find('hw-countdown-event-title').at(-1).textContent,'已结束');
});
test('hero and expired rows expose separate delete controls and require confirmation before writing',async()=>{
  const f=await mount(),buttons=f.el.find('hw-countdown-delete');assert.equal(buttons.length,sample.length);
  assert.equal(f.el.find('hw-countdown-event').some(row=>row.find('hw-countdown-delete').length),false);
  buttons[0].events.click();assert.equal(f.deletes.length,0);assert.equal(f.confirmations[0][1].content,'项目里程碑');
  await f.confirmations[0][2]();assert.equal(f.deletes[0][0],'default');assert.equal(f.deletes[0][1].id,'event-project');assert.equal(f.refreshes.length,1);
  const expired=buttons.find(b=>b.attributes['aria-label']==='删除日期 已结束');expired.events.click();assert.equal(f.deletes.length,1);
  await f.confirmations[1][2]();assert.equal(f.deletes[1][1].id,'event-old');
  const withoutMain=await mount(sample.filter(e=>e.id!=='event-project'));assert.equal(withoutMain.el.find('hw-countdown-title')[0].textContent,'留给自己的周末');assert.equal(withoutMain.el.find('hw-countdown-pin')[0].textContent,'自动选择');assert.equal(withoutMain.patches[0].featured,'');
});

test('dates can be pinned, switched and unpinned independently for each widget',async()=>{
  assert.equal(widget.defaults.featured,'');
  const auto=await mount(sample,{featured:''});
  assert.equal(auto.el.find('hw-countdown-pin-button').length,sample.length);
  const pick=auto.el.find('hw-countdown-pin-button').find(n=>n.attributes['aria-label']==='置顶日期 迎接新的一年');
  await pick.events.click();assert.equal(auto.patches[0].featured,'event-newyear');
  const pinned=await mount(sample,{featured:auto.patches[0].featured});
  assert.equal(pinned.el.find('hw-countdown-title')[0].textContent,'迎接新的一年');
  assert.equal(pinned.el.find('hw-countdown-pin')[0].textContent,'置顶');
  assert.equal(pinned.el.find('hw-countdown-pin-button')[0].attributes['aria-pressed'],'true');
  await pinned.el.find('hw-countdown-pin-button')[0].events.click();assert.equal(pinned.patches[0].featured,'');
  const switched=pinned.el.find('hw-countdown-pin-button').find(n=>n.attributes['aria-label']==='置顶日期 已结束');
  await switched.events.click();assert.equal(pinned.patches[1].featured,'event-old');
  const peer=await mount(sample,{featured:'event-project'});assert.equal(peer.el.find('hw-countdown-title')[0].textContent,'项目里程碑');assert.equal(peer.patches.length,0);
});

test('deleted pins are cleared even when empty and newly added dates stay selectable',async()=>{
  const empty=await mount([]);assert.equal(empty.patches[0].featured,'');
  const newEvents=[{id:'event-brand-new',title:'重新添加',date:'2027-02-01'}];
  const added=await mount(newEvents,{featured:''});assert.equal(added.patches.length,0);
  await added.el.find('hw-countdown-pin-button')[0].events.click();assert.equal(added.patches[0].featured,'event-brand-new');
  const pinned=await mount(newEvents,{featured:'event-brand-new'});assert.equal(pinned.el.find('hw-countdown-pin')[0].textContent,'置顶');
});

test('pin controls reject stale dates, prevent duplicate writes and recover from save failures',async()=>{
  const f=await mount(sample,{featured:''}),pin=f.el.find('hw-countdown-pin-button')[0];
  f.ctx.services.events.list=async()=>[];await pin.events.click();assert.equal(f.patches.length,0);assert.match(f.errors[0],/日期已删除/);
  f.ctx.services.events.list=async()=>sample;f.ctx.updateConfig=async()=>{throw Error('保存失败');};
  await pin.events.click();assert.equal(pin.disabled,false);assert.equal(f.errors.at(-1),'保存失败');
  let resolve;f.ctx.updateConfig=()=>new Promise(done=>{resolve=done;});
  const pending=pin.events.click();await Promise.resolve();assert.equal(pin.disabled,true);await pin.events.click();resolve();await pending;assert.equal(pin.disabled,false);
  f.ctx.signal.aborted=true;await pin.events.click();assert.equal(pin.disabled,false);
});

test('settings list date names and dates, including duplicate titles, for the selected collection',async()=>{
  const field=widget.fields.find(f=>f.key==='featured'),requests=[];
  const options=await field.options({source:'second'},{events:{list:async source=>{requests.push(source);return [{id:'event-b',title:'生日',date:'2027-02-01'},{id:'event-a',title:'生日',date:'2026-12-01'}];}}});
  assert.equal(requests[0],'second');assert.equal(options[0][0],'');
  assert.deepEqual(Array.from(options.slice(1),pair=>Array.from(pair)),[['event-a','生日 · 2026-12-01'],['event-b','生日 · 2027-02-01']]);
});
