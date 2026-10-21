const {element,button,empty,paintBackground}=require('./dom');
const {Lifetime}=require('./lifecycle');
const {createForms}=require('./forms');
const {createLayoutDrag}=require('./drag-layout');
const {createLayoutResize}=require('./resize-layout');
const {configureFields,configureInitial,configurePatch}=require('./schema');
const {widgetHeadingContent,icon}=require('./icons');
const {showNewWidget,confirmRemoveWidget}=require('./widget-instances');
const {applyTypography}=require('./typography');
const {applyCssClasses,hasWidgetFrame}=require('./appearance');
const {createLayoutEditSession}=require('./layout-edit-session');
const editOwners=new WeakMap();
function createHost(container,{registry,store,services,platform={},sourcePath='homepage.md'}) {
  store=createLayoutEditSession(store);
  const doc=container.ownerDocument,lifetime=new Lifetime(),records=new Map(),locals=new Map();
  lifetime.own(services.tasks.onReopen((source,ids)=>store.clearTaskHidden(source,ids)));
  const root=element(doc,'div',{class:'hw-home','data-home-widgets':'true'}),bar=element(doc,'header',{class:'hw-topbar'}),toolbar=element(doc,'div',{class:'hw-toolbar'});
  bar.append(element(doc,'div',{class:'hw-brand'},'❖  HOME WIDGETS',element(doc,'span',{},' /  My little universe')),toolbar);
  const toast=element(doc,'div',{class:'hw-toast',role:'status','aria-live':'polite'}),grid=element(doc,'div',{class:'hw-grid'});
  root.append(bar,grid,element(doc,'footer',{class:'hw-footer'},'✧ 一点秩序，一点留白，一点好心情。'),toast);container.append(root);
  let editing=false,syncing=false,again=false,layout,toastTimer;
  function notify(text,error=false){if(lifetime.signal.aborted)return;toast.textContent=text;toast.classList.toggle('is-error',error);clearTimeout(toastTimer);toastTimer=setTimeout(()=>toast.textContent='',4500);}
  const forms=createForms(root,notify,services);
  const run=async fn=>{try{return await fn();}catch(e){notify(e.message||String(e),true);return undefined;}};
  function configure(item) {
    const def=registry.get(item.type);
    forms.show('设置 · '+item.title,configureFields(def),configureInitial(item,def),async value=>{await store.patchWidget(item.id,configurePatch(item,def,value));},'保存',{successMessage:editing?'已应用到本次布局':'已保存'});
  }
  function controls(record) {
    record.tools.replaceChildren();
    if(!editing)return;
    const {item}=record,label=item.title;
    const grip=button(doc,'⠿',()=>{}, {class:'hw-button hw-icon-button hw-grip','aria-label':'拖动'+label,'aria-description':'按住并拖动组件标题栏，松开后预览位置；完成编辑时选择是否保存'});
    record.tools.append(grip,button(doc,'↑',()=>run(()=>store.move(item.id,-1)),{class:'hw-button hw-icon-button','aria-label':'上移'+label}),button(doc,'↓',()=>run(()=>store.move(item.id,1)),{class:'hw-button hw-icon-button','aria-label':'下移'+label}),button(doc,'⚙',()=>configure(item),{class:'hw-button hw-icon-button','aria-label':'设置'+label}));
    record.tools.append(button(doc,icon(doc,'hide'),()=>run(()=>store.patchWidget(item.id,{hidden:true})),{class:'hw-button hw-icon-button','aria-label':'隐藏'+label}),button(doc,icon(doc,'trash'),()=>run(()=>confirmRemoveWidget(forms,store,item,{draft:editing,isActive:()=>!lifetime.signal.aborted})),{class:'hw-button hw-icon-button hw-widget-delete','aria-label':'删除实例 '+label}));
  }
  function disposeRecord(record){record.life?.dispose();record.toolsLife?.dispose();record.el.remove();records.delete(record.item.id);}
  async function refreshWidget(record) {
    const {item,def,body,actions}=record;
    record.pending=false;
    record.life?.dispose();record.life=new Lifetime();const life=record.life;
    body.replaceChildren();actions.replaceChildren();
    if(!def){body.append(empty(doc,'尚未注册组件类型：'+item.type+'。配置已保留。'));return;}
    const config={...def.defaults,...item.settings};
    if(!locals.has(item.id))locals.set(item.id,{});
    const ctx={id:item.id,config,el:body,actions,doc,services,platform,sourcePath,forms,notify,local:locals.get(item.id),lifetime:life,signal:life.signal,
      refresh:()=>{if(!life.signal.aborted)return refreshWidget(record);},
      updateConfig:patch=>store.patchSettings(item.id,patch),
      run:fn=>run(fn)
    };
    const watcher=topic=>life.own(services.bus.on(topic,()=>{
      if(life.signal.aborted)return;
      // Keep a widget's active editor intact; retry on blur, not on an interval.
      if(body.contains(doc.activeElement)||forms.active){record.pending=true;return;}
      refreshWidget(record);
    }));
    for(const topic of def.watch?.(config)||[])watcher(topic);
    life.listen(body,'focusout',()=>{queueMicrotask(()=>{if(record.pending&&!body.contains(doc.activeElement)&&!life.signal.aborted){record.pending=false;refreshWidget(record);}});});
    try{const cleanup=await def.mount(ctx);if(typeof cleanup==='function')life.own(cleanup);}
    catch(e){if(!life.signal.aborted){body.replaceChildren(empty(doc,'此组件暂时无法显示：'+e.message));body.append(button(doc,'重试',()=>refreshWidget(record)));}}
  }
  function mount(item) {
    const def=registry.get(item.type),el=element(doc,'section',{class:'hw-widget'+(def?.frameless?' hw-frameless':'')+(!hasWidgetFrame(def)?' hw-frame-none':''),'data-widget-id':item.id,'data-widget-type':item.type,'aria-label':item.title});
    applyCssClasses(el,item.cssClasses);
    el.style.gridColumn='span '+item.span;el.dataset.tint=item.tint||'plain';
    if(item.height){el.style.height=item.height+'px';el.classList.add('hw-fixed');}
    try{paintBackground(el,p=>services.io.resource(p),item.background);}catch(e){notify(e.message,true);}
    const header=element(doc,'header',{class:'hw-widget-header'}),tools=element(doc,'div',{class:'hw-widget-tools'}),actions=element(doc,'div',{class:'hw-widget-actions'});
    const heading=element(doc,'h2',{},...widgetHeadingContent(doc,def,item.title));
    header.append(heading,actions,tools);const body=element(doc,'div',{class:'hw-widget-body'});
    el.append(header,body,element(doc,'div',{class:'hw-resize-grip hw-resize-x','aria-hidden':'true'}),element(doc,'div',{class:'hw-resize-grip hw-resize-y','aria-hidden':'true'}));
    const record={item,def,el,tools,actions,body,toolsLife:new Lifetime(),fingerprint:JSON.stringify(item)};records.set(item.id,record);controls(record);
    refreshWidget(record);return record;
  }
  // Presentation-only edits (span/height/tint/background/title) update in place so edge
  // resizing and the configure dialog never remount a live widget.
  function restyleRecord(record,item) {
    const old=record.item;
    if(old.type!==item.type||JSON.stringify(old.settings||{})!==JSON.stringify(item.settings||{}))return false;
    record.item=item;
    const {el,def}=record;
    applyCssClasses(el,item.cssClasses,old.cssClasses);
    el.style.gridColumn='span '+item.span;
    if(item.height){el.style.height=item.height+'px';el.classList.add('hw-fixed');}
    else{el.style.height='';el.classList.remove('hw-fixed');}
    el.dataset.tint=item.tint||'plain';el.setAttribute('aria-label',item.title);
    try{paintBackground(el,p=>services.io.resource(p),item.background);}catch(e){notify(e.message,true);}
    el.querySelector('.hw-widget-header h2')?.replaceChildren(...widgetHeadingContent(doc,def,item.title));
    controls(record);
    return true;
  }
  async function sync() {
    if(lifetime.signal.aborted)return;if(syncing){again=true;return;}syncing=true;
    try{layout=await store.load();if(lifetime.signal.aborted)return;root.dataset.theme=layout.theme;applyTypography(root,layout.typography);
      // 页面最大宽度同步到容器与其外层 sizer（两者的 max-width 都走 --hw-maxw）
      const maxw=layout.maxWidth===undefined?'1440px':layout.maxWidth==='full'?'none':layout.maxWidth+'px';
      root.style.setProperty('--hw-maxw',maxw);root.dataset.maxw=String(layout.maxWidth??'');
      container.closest('.markdown-preview-sizer')?.style.setProperty('--hw-maxw',maxw);
      const active=new Set(layout.widgets.filter(w=>!w.hidden).map(w=>w.id));
      for(const record of [...records.values()])if(!active.has(record.item.id))disposeRecord(record);
      let position=0;
      for(const item of layout.widgets.filter(w=>!w.hidden)) {
        let record=records.get(item.id);
        if(record&&record.fingerprint!==JSON.stringify(item)){
          if(restyleRecord(record,item))record.fingerprint=JSON.stringify(item);
          else{disposeRecord(record);record=null;}
        }
        if(!record)record=mount(item);
        // Leave unaffected nodes in place, preserving focus and the editing caret.
        if(grid.children[position]!==record.el)grid.insertBefore(record.el,grid.children[position]||null);
        position++;
      }
    }catch(e){notify('读取布局失败：'+e.message,true);}
    finally{syncing=false;if(again){again=false;sync();}}
  }
  function addWidget() {
    if(!registry.list().length){notify('没有可用的组件类型');return;}
    const fields=[{key:'type',label:'组件类型',type:'select',options:registry.list().map(d=>[d.type,d.label])},{key:'title',label:'组件名称（可选）'}];
    let choice;
    const dialog=forms.show('添加独立小组件',fields,{},value=>{if(!registry.get(value.type))throw new Error('此组件类型已断开，请重新选择');choice=value;},'下一步',{successMessage:'请配置新组件'});
    dialog.addEventListener('close',()=>{if(choice&&!lifetime.signal.aborted)run(()=>showNewWidget(forms,registry,store,choice.type,{title:choice.title,draft:editing}));},{once:true});
  }
  function showHidden() {
    const hidden=layout.widgets.filter(w=>w.hidden);
    if(!hidden.length){notify('没有隐藏的小组件');return;}
    forms.show('恢复隐藏组件',[{key:'id',label:'选择组件',type:'select',options:hidden.map(w=>[w.id,w.title])}],{},v=>store.patchWidget(v.id,{hidden:false}),'恢复');
  }
  const drag=createLayoutDrag({grid,root,isEditing:()=>editing,onMove:async(from,to)=>{await store.place(from,to);notify('排序已调整');},onError:e=>notify('布局调整失败：'+e.message,true)});
  lifetime.own(()=>drag.dispose());
  const resize=createLayoutResize({grid,root,isEditing:()=>editing,onResize:(id,patch)=>run(async()=>{await store.patchWidget(id,patch);notify('大小已调整');}),onError:e=>notify('大小调整失败：'+e.message,true)});
  lifetime.own(()=>resize.dispose());
  const hint=element(doc,'p',{class:'hw-layout-hint',hidden:'true'},'按住组件标题栏或 ⠿ 拖到目标卡片排序，拖动右/下边缘调整大小，双击下边缘恢复自适应高度；按 Esc 或「完成编辑」选择是否保存。');
  root.insertBefore(hint,grid);
  function setEditing(value){
    drag.cancel();resize.cancel();editing=value;hint.hidden=!value;
    editButton.textContent=value?'✓ 完成编辑':'⠿ 编辑布局';editButton.classList.toggle('is-active',value);root.classList.toggle('is-editing',value);
    if(value)editOwners.set(doc,root);else if(editOwners.get(doc)===root)editOwners.delete(doc);
    for(const record of records.values())controls(record);
  }
  function requestExit(){
    if(!editing||forms.active)return;
    drag.cancel();resize.cancel();
    forms.show('是否保存布局？',[],{},async()=>{await store.commit();setEditing(false);await sync();},'保存并退出',{
      description:'是否保存本次布局调整？保存也会执行删除待办组件时选择的任务处理；不保存则保留原组件与任务。',cancelLabel:'继续编辑',successMessage:'布局已保存',
      secondaryAction:{label:'不保存并退出',run:async()=>{await store.discard();setEditing(false);await sync();},successMessage:'已放弃本次布局调整'}
    });
  }
  const editButton=button(doc,'⠿ 编辑布局',async()=>{
    if(editing){requestExit();return;}
    editButton.disabled=true;
    try{await store.begin();if(!lifetime.signal.aborted)setEditing(true);}
    catch(e){notify('无法开始编辑：'+e.message,true);}
    finally{editButton.disabled=false;}
  });
  // Capture before Obsidian's Escape shortcuts, while leaving child dialogs alone.
  lifetime.listen(doc.defaultView,'keydown',event=>{
    if(event.key!=='Escape'||!editing||event.isComposing)return;
    if(editOwners.get(doc)!==root&&!root.contains(event.target))return;
    if(forms.active||doc.querySelector('.modal-container,dialog[open]'))return;
    if(doc.activeElement&&doc.activeElement!==doc.body&&!root.contains(doc.activeElement))return;
    event.preventDefault();event.stopImmediatePropagation();if(!event.repeat)requestExit();
  },true);
  toolbar.append(button(doc,'◌ 外观',()=>forms.show('首页外观',[{key:'theme',label:'主题',type:'select',options:[['native','跟随 Obsidian'],['lavender','紫藤花园'],['sage','森林来信'],['rose','樱花手帐']]},{key:'maxWidth',label:'页面最大宽度',type:'select',options:[['','默认（1440px）'],['full','跟随窗口宽度'],['1600','固定 1600px'],['1920','固定 1920px'],['2560','固定 2560px']]}],layout||{},v=>store.page({theme:v.theme,maxWidth:v.maxWidth===''?undefined:v.maxWidth==='full'?'full':Number(v.maxWidth)}))),
    editButton,
    button(doc,'＋ 添加组件',addWidget),button(doc,'恢复隐藏',showHidden));
  lifetime.own(store.subscribe(sync));
  lifetime.own(services.bus.on('file:'+store.path,sync));
  lifetime.own(services.bus.on('registry',()=>{for(const record of [...records.values()])if(record.def!==registry.get(record.item.type))disposeRecord(record);sync();}));
  lifetime.listen(root,'close',()=>{for(const record of records.values())if(record.pending){record.pending=false;refreshWidget(record);}},true);
  lifetime.own(()=>{clearTimeout(toastTimer);if(editOwners.get(doc)===root)editOwners.delete(doc);store.dispose();forms.dispose();for(const record of [...records.values()])disposeRecord(record);root.remove();});
  const ready=sync();
  return {root,ready,sync,dispose:()=>lifetime.dispose()};
}
module.exports={createHost};
