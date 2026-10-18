const test=require('node:test'),assert=require('node:assert/strict');
const widget=require('../src/widgets/capture');
const {Lifetime}=require('../src/core/lifecycle');
class Node{
  constructor(tag,doc){this.tag=tag;this.ownerDocument=doc;this.nodeType=1;this.childNodes=[];this.attributes={};this.events={};this.value='';}
  append(...items){this.childNodes.push(...items.map(n=>{if(typeof n==='string')return {nodeType:3,textContent:n};n.parentNode=this;return n;}));}
  contains(node){return node===this||this.childNodes.some(n=>n.nodeType===1&&n.contains(node));}
  setAttribute(key,value){this.attributes[key]=String(value);}
  addEventListener(key,fn){this.events[key]=fn;}
  get textContent(){return this.childNodes.map(n=>n.textContent).join('');}
  set textContent(text){this.childNodes=[{nodeType:3,textContent:text}];}
  focus(){this.focused=true;if(this.ownerDocument)this.ownerDocument.activeElement=this;}
  click(){this.pending=this.events.click?.();return this.pending;}
  find(cls){return this.childNodes.filter(n=>n.nodeType===1).flatMap(n=>[...(n.className?.split(' ').includes(cls)?[n]:[]),...n.find(cls)]);}
}
function fixture({storageError=false,capture=async()=>{},quickAdd=async()=>{},choice=''}={}){
  const data=new Map(),writes=[],calls=[],notices=[],controller=new AbortController(),local={};
  const win={events:{},addEventListener(name,fn){(this.events[name]??=[]).push(fn);},removeEventListener(name,fn){this.events[name]=(this.events[name]||[]).filter(f=>f!==fn);}};Object.defineProperty(win,'localStorage',{get(){if(storageError)throw Error('blocked');return {getItem:k=>data.get(k),setItem:(k,v)=>data.set(k,v),removeItem:k=>data.delete(k)};}});
  const doc={defaultView:win,createElement:t=>new Node(t,doc),createElementNS:(ns,t)=>new Node(t,doc),createTextNode:t=>({nodeType:3,textContent:String(t)})};
  const keydown=(view,event,focus=view.input)=>{focus?.focus();event.preventDefault??=()=>{};event.stopImmediatePropagation??=()=>{};for(const fn of [...win.events.keydown||[]])fn(event);};
  const lives=[];
  const mount=(id='one')=>{const el=new Node('body',doc),life=new Lifetime();lives.push(life);widget.mount({id,doc,el,local,lifetime:life,platform:{vaultId:'vault'},config:{...widget.defaults,quickAddChoice:choice},signal:controller.signal,notify:(...args)=>notices.push(args),services:{ideas:{capture:async(...args)=>{writes.push(args);return capture(...args);}},integrations:{quickAdd:async(...args)=>{calls.push(args);return quickAdd(...args);}}}});const view={el,life,input:el.find('hw-capture-input')[0],save:el.find('hw-capture-save')[0],categories:el.find('hw-capture-category')};view.keydown=(event,focus)=>keydown(view,event,focus);return view;};
  return {mount,data,writes,calls,notices,controller,local,win,doc};
}
const type=(view,text)=>{view.input.value=text;view.input.events.input();};
test('category pills save the chosen category and successful save clears only that instance draft',async()=>{
  const f=fixture(),v=f.mount();type(v,'一个新的想法');await v.categories[2].click();
  assert.equal(v.categories[2].attributes['aria-pressed'],'true');assert.equal(v.categories[0].attributes['aria-pressed'],'false');
  f.data.set('home-widgets-draft:vault:other','另一实例');await v.save.click();
  assert.deepEqual(f.writes,[['Inbox/Ideas',{body:'一个新的想法',area:'生活'}]]);assert.equal(v.input.value,'');assert.equal(f.data.has('home-widgets-draft:vault:one'),false);assert.equal(f.data.get('home-widgets-draft:vault:other'),'另一实例');
  assert.equal(f.mount().categories[2].attributes['aria-pressed'],'true');
});
test('local drafts survive remounts even when browser storage is blocked',()=>{
  for(const storageError of [false,true]){const f=fixture({storageError});let v=f.mount();type(v,'未保存的想法');v=f.mount();assert.equal(v.input.value,'未保存的想法');}
});
test('failed save keeps the draft and restores the save button for retry',async()=>{
  let fail=true;const f=fixture({capture:async()=>{if(fail)throw Error('保存失败');}}),v=f.mount();type(v,'不能丢失');await v.save.click();assert.equal(v.input.value,'不能丢失');assert.equal(v.save.disabled,false);assert.equal(f.notices[0][1],true);
  fail=false;await v.save.click();assert.equal(v.input.value,'');
});
test('typing during an in-flight save preserves the newer draft and blocks duplicate submissions',async()=>{
  let resolve;const f=fixture({capture:()=>new Promise(r=>resolve=r)}),v=f.mount();type(v,'发送中的内容');const pending=v.save.click();assert.equal(v.save.disabled,true);await v.save.click();assert.equal(f.writes.length,1);type(v,'后续新内容');resolve();await pending;
  assert.equal(v.input.value,'后续新内容');assert.equal(f.data.get('home-widgets-draft:vault:one'),'后续新内容');assert.equal(v.save.disabled,false);
});
test('Ctrl/Command+Enter saves, IME composition is ignored, and empty input only focuses the editor',async()=>{
  const f=fixture(),v=f.mount();await v.save.click();assert.equal(v.input.focused,true);assert.equal(f.writes.length,0);
  type(v,'输入法还在选字');v.keydown({ctrlKey:true,key:'Enter',isComposing:true});assert.equal(f.writes.length,0);
  let prevented=false;v.keydown({metaKey:true,key:'Enter',preventDefault(){prevented=true;}});await v.save.pending;assert(prevented);assert.equal(f.writes.length,1);
  type(v,'再次记录');v.keydown({ctrlKey:true,key:'Enter',preventDefault(){}});await v.save.pending;assert.equal(f.writes.length,2);
});
test('QuickAdd receives the same selected category without creating a separate note',async()=>{
  const f=fixture({choice:'Capture idea'}),v=f.mount();type(v,'交给流程');await v.categories[3].click();await v.save.click();
  assert.deepEqual(f.calls,[['Capture idea',{value:'交给流程',area:'学习'}]]);assert.equal(f.writes.length,0);
});
test('shortcut works after selecting a category and also when the save button has focus',async()=>{
  const f=fixture(),v=f.mount();type(v,'分类后保存');v.categories[1].click();v.keydown({ctrlKey:true,key:'Enter'},v.categories[1]);await v.save.pending;assert.equal(f.writes[0][1].area,'工作');
  type(v,'按钮上保存');v.keydown({metaKey:true,key:'Enter'},v.save);await v.save.pending;assert.equal(f.writes.length,2);
});
test('host-prevented events still save once; outside focus, composition and repeats never create duplicate notes',async()=>{
  const f=fixture(),v=f.mount();type(v,'宿主已处理按键');const event={ctrlKey:true,key:'Enter',defaultPrevented:true};v.keydown(event);v.keydown(event);await v.save.pending;assert.equal(f.writes.length,1);
  type(v,'保留此草稿');const outside=f.doc.createElement('input');v.keydown({ctrlKey:true,key:'Enter'},outside);assert.equal(f.writes.length,1);
  for(const extra of [{repeat:true},{keyCode:229},{altKey:true},{shiftKey:true}])v.keydown({ctrlKey:true,key:'Enter',...extra});assert.equal(f.writes.length,1);
  v.life.dispose();v.keydown({ctrlKey:true,key:'Enter'});assert.equal(f.writes.length,1);assert.equal(f.win.events.keydown.length,0);
});
