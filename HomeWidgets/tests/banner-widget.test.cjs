const test=require('node:test'),assert=require('node:assert/strict');
const widget=require('../src/widgets/banner');
const {parseQuotes,dailyQuote,randomQuote}=require('../src/widgets/banner/daily-quote');
const {Lifetime}=require('../src/core/lifecycle');
const {createQuoteService}=require('../src/services/quotes');

class Node extends EventTarget{
  constructor(tag,doc){super();this.tag=tag;this.ownerDocument=doc;this.nodeType=1;this.children=[];this.attributes={};this.style={};this.handlers={};this.value='';}
  append(...nodes){this.children.push(...nodes.map(n=>typeof n==='string'?{textContent:n}:n));}
  setAttribute(k,v){this.attributes[k]=String(v);if(k==='hidden')this.hidden=true;}
  addEventListener(k,fn,...args){this.handlers[k]=fn;super.addEventListener(k,fn,...args);}
  click(){if(!this.disabled)return this.handlers.click?.();}
  replaceChildren(...nodes){this.children=[];this.append(...nodes);}
  querySelectorAll(tag){return this.children.filter(n=>n.nodeType===1).flatMap(n=>[...(n.tag===tag?[n]:[]),...n.querySelectorAll(tag)]);}
  focus(){this.ownerDocument.activeElement=this;}
  get textContent(){return this.children.map(n=>n.textContent).join('');}
  set textContent(value){this.children=[{textContent:String(value)}];}
  find(cls){return this.children.filter(n=>n.nodeType===1).flatMap(n=>[...((n.className||n.attributes.class||'').split(' ').includes(cls)?[n]:[]),...n.find(cls)]);}
}
function clock(t){
  const RealDate=Date;let now=new RealDate(2026,9,18,12).getTime();
  global.Date=class extends RealDate{constructor(...args){super(...(args.length?args:[now]));}static now(){return now;}};
  t.after(()=>{global.Date=RealDate;});
  return value=>{now=new RealDate(...value).getTime();};
}
function fixture(t,{read,config={},data=new Map(),storageError=false,vault='test-vault',saveConfig=async()=>{}}={}){
  let text='- 第一条\n- 第二条\n- 第三条';const ticks=new Set(),lives=[],reads=[],opened=[],notices=[],panels=[];let refreshes=0;
  const doc=new EventTarget();doc.defaultView=new EventTarget();
  const locals=new Map(),settings=new Map();
  Object.defineProperty(doc.defaultView,'localStorage',{get(){if(storageError)throw Error('storage blocked');return {getItem:k=>data.get(k),setItem:(k,v)=>data.set(k,v)};}});
  doc.createElement=tag=>new Node(tag,doc);doc.createElementNS=(ns,tag)=>new Node(tag,doc);doc.createTextNode=text=>({nodeType:3,textContent:String(text)});
  function mount(id='banner'){
    const life=new Lifetime(),el=new Node('body',doc);lives.push(life);
    life.interval=fn=>{ticks.add(fn);return life.own(()=>ticks.delete(fn));};
    if(!locals.has(id))locals.set(id,{});
    if(!settings.has(id))settings.set(id,{...config});
    const io={exists:async()=>true,read:async path=>{reads.push(path);return read?read(path):text;},update:async(path,fn)=>{text=fn(text);},resource:p=>p,open:async p=>opened.push(p)};
    const forms={panel:()=>{const dialog=new Node('dialog',doc),body=new Node('div',doc),panel={dialog,body,alive:true,setBusy(){}};dialog.close=()=>{panel.alive=false;dialog.dispatchEvent(new Event('close'));};panels.push(panel);return panel;}};
    const ctx={id,platform:{vaultId:vault},local:locals.get(id),doc,el,forms,config:{...widget.defaults,...settings.get(id)},signal:life.signal,lifetime:life,refresh:()=>{refreshes++;},updateConfig:async patch=>{await saveConfig(patch);settings.set(id,{...settings.get(id),...patch});},notify:(...args)=>notices.push(args),services:{io,quotes:createQuoteService(io)}};
    return {el,life,done:widget.mount(ctx)};
  }
  t.after(()=>lives.forEach(life=>life.dispose()));
  return {mount,doc,ticks,reads,opened,notices,data,locals,panels,settings,setText:value=>{text=value;},get refreshes(){return refreshes;}};
}

test('quote library reads multiline bullets while ignoring metadata, prose and fenced examples',()=>{
  const text='\uFEFF---\r\ntags:\r\n  - 不应显示的属性\r\n---\r\n# 引言库\r\n说明文字\r\n\r\n- 认真生活\r\n  慢慢发光。\r\n\r\n* 今天也很好。\r\n+ 今天也很好。\r\n```md\r\n- 代码示例\r\n```\r\n~~~\r\n- 另一个示例\r\n~~~\r\n- 最后一条';
  assert.deepEqual(parseQuotes(text),['认真生活\n慢慢发光。','今天也很好。','最后一条']);
  assert.deepEqual(parseQuotes('# 空库\n没有列表'),[]);
  assert.throws(()=>parseQuotes('---\ntags: []'),/缺少结束/);
  assert.throws(()=>dailyQuote([],'Home/引言库.md','2026-10-18'),/没有可用/);
});

test('daily choices remain stable on reload and cover different quotes across local dates',()=>{
  const quotes=['一','二','三','四','五'],picked=dailyQuote(quotes,'Home/引言库.md','2026-10-18');
  assert.equal(dailyQuote([...quotes],'Home/引言库.md','2026-10-18'),picked);
  const choices=Array.from({length:28},(_,i)=>dailyQuote(quotes,'Home/引言库.md','2026-10-'+String(i+1).padStart(2,'0')));
  assert(choices.every(q=>quotes.includes(q)));assert(new Set(choices).size>=4);
});

test('mount uses the same daily quote, opens its manager, and picks from edited contents without writing',async t=>{
  clock(t);const f=fixture(t),first=f.mount();await first.done;
  const selected=first.el.find('hw-banner-quote')[0].textContent;
  const again=f.mount();await again.done;assert.equal(again.el.find('hw-banner-quote')[0].textContent,selected);
  assert.equal(first.el.find('hw-banner-quote')[0].attributes['aria-description'],'每日一句 · 2026-10-18');
  first.el.find('hw-banner-quote-edit')[0].click();await new Promise(setImmediate);assert.equal(f.panels.length,1);assert.equal(f.panels[0].body.find('hw-quote-entry').length,3);assert.deepEqual(f.opened,[]);
  f.setText('- 新维护的唯一引言\n  保留换行');const edited=f.mount();await edited.done;
  assert(edited.el.find('hw-banner-quote')[0].textContent.includes('新维护的唯一引言\n保留换行'));
  assert(f.reads.every(path=>path==='Home/引言库.md'));
});

test('local midnight and window wake refresh once mounted; disposing releases timers and listeners',async t=>{
  const setClock=clock(t),f=fixture(t),view=f.mount();await view.done;
  for(const tick of f.ticks)tick();assert.equal(f.refreshes,0);assert.equal(f.reads.length,1);
  setClock([2026,9,19,0,0]);for(const tick of f.ticks)tick();assert.equal(f.refreshes,1);
  f.doc.dispatchEvent(new Event('visibilitychange'));f.doc.defaultView.dispatchEvent(new Event('focus'));assert.equal(f.refreshes,3);
  view.life.dispose();assert.equal(f.ticks.size,0);
  f.doc.defaultView.dispatchEvent(new Event('focus'));assert.equal(f.refreshes,3);
});

test('quote manager preserves an edit draft across a conflict and reopening, and reload rebases only an unchanged quote',async t=>{
  const f=fixture(t),view=f.mount();await view.done;view.el.find('hw-banner-quote-edit')[0].click();await new Promise(setImmediate);
  let panel=f.panels[0];await panel.body.find('hw-quote-entry-actions')[0].querySelectorAll('button')[0].click();
  let input=panel.body.querySelectorAll('textarea')[0];input.value='我的草稿';input.handlers.input();f.setText('- 第一条\n- 第二条\n- 第三条\n- 外部新增');
  await panel.body.find('hw-quote-editor-actions')[0].querySelectorAll('button')[1].click();
  assert.match(panel.body.find('hw-form-error')[0].textContent,/已变化/);assert.equal(input.value,'我的草稿');
  panel.dialog.close();view.el.find('hw-banner-quote-edit')[0].click();await new Promise(setImmediate);panel=f.panels[1];input=panel.body.querySelectorAll('textarea')[0];assert.equal(input.value,'我的草稿');
  await panel.body.find('hw-quote-editor-actions')[0].querySelectorAll('button')[1].click();
  assert.equal(panel.body.find('hw-form-error')[0].textContent,'');assert(panel.body.find('hw-quote-entry')[0].textContent.includes('我的草稿'));
  assert(panel.body.textContent.includes('外部新增'));view.life.dispose();assert.equal(panel.alive,false);
});

test('missing and empty libraries retain the banner and show an actionable fallback; recovery replaces it',async t=>{
  clock(t);
  for(const read of [async()=>{throw Error('笔记不存在');},async()=>'# 尚未添加']){
    const f=fixture(t,{read}),view=f.mount();await view.done;
    assert(view.el.textContent.includes(widget.defaults.quote));assert.equal(view.el.find('hw-banner-art').length,1);
    assert.equal(view.el.find('hw-banner-quote-edit').length,1);assert(view.el.find('hw-banner-quote-status')[0].textContent.includes('引言库暂不可用'));
  }
  const f=fixture(t);f.setText('# 空库');const empty=f.mount();await empty.done;assert.equal(empty.el.find('hw-banner-quote-status').length,1);
  f.setText('- 恢复后的引言');const recovered=f.mount();await recovered.done;assert.equal(recovered.el.find('hw-banner-quote-status').length,0);assert(recovered.el.textContent.includes('恢复后的引言'));
});

test('blank source keeps fixed/hidden quote mode, and an aborted library read cannot append stale UI',async t=>{
  const f=fixture(t,{config:{quoteSource:'',quote:'固定内容'}}),fixed=f.mount();await fixed.done;
  assert.equal(f.reads.length,0);assert.equal(f.ticks.size,0);assert(fixed.el.textContent.includes('固定内容'));
  const hidden=fixture(t,{config:{quoteSource:'',quote:''}}),view=hidden.mount();await view.done;assert.equal(view.el.find('hw-banner-quote').length,0);
  let resolve;const pending=fixture(t,{read:()=>new Promise(r=>resolve=r)}),stale=pending.mount();stale.life.dispose();resolve('- 过期内容');await stale.done;
  assert.equal(stale.el.children.length,0);assert.equal(pending.ticks.size,0);
});

const displayed=view=>view.el.find('hw-banner-quote')[0].children.find(n=>n.tag==='p').textContent;
test('random choices exclude the current quote and gracefully handle an exhausted pool',()=>{
  assert.equal(randomQuote(['一','二','三'],'一',()=>0),'二');
  assert.equal(randomQuote(['一','二','三'],'一',()=>.9999),'三');
  assert.equal(randomQuote(['唯一'],'唯一'),'唯一');assert.equal(randomQuote([],'备用'),'备用');
});

test('random button changes immediately, survives reload, and remains isolated by instance and vault',async t=>{
  clock(t);t.mock.method(Math,'random',()=>0);
  const f=fixture(t),view=f.mount();await view.done;const original=displayed(view),shuffle=view.el.find('hw-banner-quote-random')[0];
  shuffle.click();const chosen=displayed(view);assert.notEqual(chosen,original);assert.equal(f.data.size,1);
  f.locals.clear();const reloaded=f.mount();await reloaded.done;assert.equal(displayed(reloaded),chosen);
  const other=f.mount('another-banner');await other.done;assert.equal(displayed(other),original);
  const anotherVault=fixture(t,{data:f.data,vault:'another-vault'}),separate=anotherVault.mount();await separate.done;assert.equal(displayed(separate),original);
  shuffle.click();assert.notEqual(displayed(view),chosen);
  view.life.dispose();const before=displayed(view),saved=[...f.data.values()];shuffle.click();assert.equal(displayed(view),before);assert.deepEqual([...f.data.values()],saved);
});

test('manual choice expires on the next local day and is ignored if removed from the library',async t=>{
  const setClock=clock(t),f=fixture(t),view=f.mount();await view.done;view.el.find('hw-banner-quote-random')[0].click();
  setClock([2026,9,19,0,0]);const writes=[...f.data.values()];view.el.find('hw-banner-quote-random')[0].click();assert.equal(f.refreshes,1);assert.deepEqual([...f.data.values()],writes);
  const tomorrow=f.mount();await tomorrow.done;assert.equal(displayed(tomorrow),dailyQuote(['第一条','第二条','第三条'],widget.defaults.quoteSource,'2026-10-19'));
  tomorrow.el.find('hw-banner-quote-random')[0].click();f.setText('- 新库里的唯一内容');const edited=f.mount();await edited.done;assert.equal(displayed(edited),'新库里的唯一内容');assert.equal(edited.el.find('hw-banner-quote-random')[0].disabled,true);
});

test('random selection works with blocked storage, while fixed, empty and one-quote modes stay safe',async t=>{
  clock(t);const f=fixture(t,{storageError:true}),view=f.mount();await view.done;
  const original=displayed(view);view.el.find('hw-banner-quote-random')[0].click();assert.notEqual(displayed(view),original);
  const again=f.mount();await again.done;assert.equal(displayed(again),displayed(view));
  for(const text of ['- 只有一条','- 相同\n- 相同','# 空库']){
    const pool=fixture(t);pool.setText(text);const single=pool.mount();await single.done;const shuffle=single.el.find('hw-banner-quote-random')[0];assert.equal(shuffle.disabled,true);
    const before=displayed(single);shuffle.click();assert.equal(displayed(single),before);assert.equal(pool.data.size,0);
  }
  const fixed=fixture(t,{config:{quoteSource:''}}),manual=fixed.mount();await manual.done;assert.equal(manual.el.find('hw-banner-quote-random').length,0);
});

test('manual library selection persists across dates and reloads, stays per-instance, and can return to automatic mode',async t=>{
  const setClock=clock(t),f=fixture(t),view=f.mount();await view.done;
  view.el.find('hw-banner-quote-edit')[0].click();await new Promise(setImmediate);let panel=f.panels[0];
  const modes=panel.body.find('hw-quote-mode')[0].querySelectorAll('button');modes[1].click();
  const choose=panel.body.find('hw-quote-select')[1];await choose.click();assert.equal(panel.alive,false);
  assert.deepEqual(f.settings.get('banner'),{quoteMode:'manual',selectedQuote:'第二条'});
  setClock([2026,9,19,12]);f.locals.clear();const nextDay=f.mount();await nextDay.done;assert.equal(displayed(nextDay),'第二条');
  const other=f.mount('other');await other.done;assert.equal(displayed(other),dailyQuote(['第一条','第二条','第三条'],widget.defaults.quoteSource,'2026-10-19'));
  nextDay.el.find('hw-banner-quote-edit')[0].click();await new Promise(setImmediate);panel=f.panels[1];
  assert.equal(panel.body.find('is-selected').length,1);await panel.body.find('hw-quote-mode')[0].querySelectorAll('button')[0].click();
  assert.equal(panel.alive,false);const automatic=f.mount();await automatic.done;
  assert.equal(f.settings.get('banner').quoteMode,'daily');assert.equal(displayed(automatic),dailyQuote(['第一条','第二条','第三条'],widget.defaults.quoteSource,'2026-10-19'));
});

test('failed or stale manual selections keep the manager open and never replace saved settings',async t=>{
  let fail=true;const f=fixture(t,{saveConfig:async()=>{if(fail)throw Error('保存设置失败');}}),view=f.mount();await view.done;
  view.el.find('hw-banner-quote-edit')[0].click();await new Promise(setImmediate);const panel=f.panels[0];panel.body.find('hw-quote-mode')[0].querySelectorAll('button')[1].click();
  await panel.body.find('hw-quote-select')[1].click();assert.equal(panel.alive,true);assert.match(panel.body.find('hw-form-error')[0].textContent,/保存设置失败/);assert.deepEqual(f.settings.get('banner'),{});
  fail=false;f.setText('- 第一条\n- 第三条');await panel.body.find('hw-quote-select')[1].click();assert.match(panel.body.find('hw-form-error')[0].textContent,/已被修改或删除/);assert.deepEqual(f.settings.get('banner'),{});
});

test('manual display ignores temporary random choices, safely falls back after deletion and preserves the chosen mode on shuffle',async t=>{
  clock(t);const f=fixture(t,{config:{quoteMode:'manual',selectedQuote:'第二条'}}),view=f.mount();await view.done;
  assert.equal(displayed(view),'第二条');await view.el.find('hw-banner-quote-random')[0].click();const chosen=f.settings.get('banner').selectedQuote;assert.notEqual(chosen,'第二条');assert.equal(f.settings.get('banner').quoteMode,'manual');
  const next=f.mount();await next.done;assert.equal(displayed(next),chosen);
  f.setText('- 改动后的唯一引言');const missing=f.mount();await missing.done;assert.equal(displayed(missing),'改动后的唯一引言');assert.match(missing.el.find('hw-banner-quote-status')[0].textContent,/已不在库中/);
});
