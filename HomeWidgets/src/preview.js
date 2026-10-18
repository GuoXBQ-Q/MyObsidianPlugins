const {Bus}=require('./core/lifecycle');
const {WidgetRegistry}=require('./core/registry');
const {registerBuiltins}=require('./widgets');
const {createHost}=require('./core/host');
const {createServices}=require('./services');
const {createLayoutStore}=require('./services/layout');
const {element,button}=require('./core/dom');
const {createPluginDataStore}=require('./services/plugin-data');
const {createPersistentEventService}=require('./services/persistent-events');
async function start(container) {
  const bus=new Bus();
  async function request(action,data={}){const response=await fetch('/api/io',{method:'POST',headers:{'Content-Type':'application/json','X-Home-Widgets':'1'},body:JSON.stringify({action,...data})});const value=await response.json();if(!response.ok){const error=new Error(value.error);error.status=response.status;throw error;}return value.result;}
  const io={
    notes:folder=>request('notes',{path:folder}),
    read:path=>request('read',{path}),exists:path=>request('exists',{path}),create:(path,text)=>request('create',{path,text}),list:folder=>request('list',{path:folder}),
    async update(path,fn){for(let attempt=0;attempt<3;attempt++){const snapshot=await request('snapshot',{path}),text=fn(snapshot.text);try{await request('cas',{path,version:snapshot.version,text});bus.changed(path);return;}catch(e){if(e.status!==409)throw e;}}throw new Error('文件同时被修改，请再试一次');},
    resource:path=>'/asset/'+path.split('/').map(encodeURIComponent).join('/'),
    async open(path){const text=await io.read(path),doc=container.ownerDocument,dialog=element(doc,'dialog',{class:'hw-preview-note'});dialog.append(element(doc,'h2',{},path),button(doc,'关闭',()=>dialog.close()),element(doc,'pre',{},text));doc.body.append(dialog);dialog.addEventListener('close',()=>dialog.remove());dialog.showModal();}
  };
  function unavailable(name){throw new Error(name+' 需要在 Obsidian 中启用对应插件；浏览器预览不模拟插件结果');}
  const integrations={status:()=>({dataview:false,tasks:false,quickadd:false}),taskTransform:()=>null,renderDataview:()=>unavailable('Dataview 查询'),renderTasks:()=>unavailable('Tasks 查询'),quickAdd:()=>unavailable('QuickAdd'),command:()=>unavailable('Obsidian 命令'),
    async renderMarkdown(text,el){el.append(element(el.ownerDocument,'pre',{class:'hw-preview-markdown'},text));el.append(element(el.ownerDocument,'small',{},'浏览器显示 Markdown 源文；Obsidian 内使用原生 Markdown 渲染。'));}
  };
  const registry=new WidgetRegistry();registerBuiltins(registry);const layoutPath=new URLSearchParams(window.location.search).get('layout')||undefined;
  const store=createLayoutStore(io,bus,layoutPath);await store.initialize();
  let pluginVersion;
  const data=createPluginDataStore({
    load:async()=>{const result=await request('plugin-data-read');pluginVersion=result.version;return result.data;},
    save:async data=>{const result=await request('plugin-data-save',{version:pluginVersion,data});pluginVersion=result.version;}
  });
  const host=createHost(container,{registry,store,services:createServices(io,bus,integrations,createPersistentEventService(data,bus)),platform:{vaultId:'demo-preview',preview:true}});await host.ready;
  let cursor=0,polling=false;
  const timer=setInterval(async()=>{if(polling)return;polling=true;try{const changes=await request('changes',{cursor});cursor=changes.cursor;for(const path of new Set(changes.paths))bus.changed(path);}catch{/* keep the active editor available during a temporary server outage */}finally{polling=false;}},1500);
  window.addEventListener('pagehide',()=>{clearInterval(timer);host.dispose();},{once:true});
  return host;
}
module.exports={start};
