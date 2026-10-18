const test=require('node:test'),assert=require('node:assert/strict');
const {createIntegrations}=require('../src/adapters/integrations');
const {Lifetime}=require('../src/core/lifecycle');
test('native Obsidian scope handles save before parent shortcuts and follows focus and widget lifetime',async()=>{
  const handlers=[],pushed=[],popped=[],removed=[],events={};
  class Scope{constructor(parent){this.parent=parent;}register(modifiers,key,fn){const handler={modifiers,key,fn};handlers.push(handler);return handler;}unregister(handler){removed.push(handler);}}
  const app={scope:{root:true},keymap:{pushScope:s=>pushed.push(s),popScope:s=>popped.push(s)}};
  const input={},category={},outside={},doc={activeElement:input},root={ownerDocument:doc,contains:el=>el===input||el===category,addEventListener:(name,fn)=>events[name]=fn,removeEventListener:name=>delete events[name]};
  const life=new Lifetime();let saves=0;
  createIntegrations(app,{Scope}).bindSaveShortcut(root,event=>{if(event.isComposing||!root.contains(doc.activeElement))return false;saves++;return true;},life);
  assert.deepEqual(handlers.map(h=>h.modifiers),[['Ctrl'],['Meta']]);assert.equal(pushed.length,1);assert.equal(pushed[0].parent,app.scope);assert.equal(handlers[0].fn({}),false);assert.equal(saves,1);
  assert.equal(handlers[0].fn({isComposing:true}),true);assert.equal(saves,1);
  doc.activeElement=category;events.focusout();events.focusin();await Promise.resolve();assert.equal(popped.length,0);assert.equal(pushed.length,1);
  doc.activeElement=outside;events.focusout();await Promise.resolve();assert.equal(popped.length,1);assert.equal(handlers[0].fn({}),true);assert.equal(saves,1);
  doc.activeElement=input;events.focusin();assert.equal(pushed.length,2);life.dispose();assert.equal(popped.length,2);assert.equal(removed.length,2);assert.deepEqual(events,{});
});
