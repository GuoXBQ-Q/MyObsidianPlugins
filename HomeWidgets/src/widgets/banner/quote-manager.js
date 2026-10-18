const {element,button,empty}=require('../../core/dom');
function showQuoteManager(ctx,source){
  const {doc}=ctx,panel=ctx.forms.panel('引言库','hw-quote-manager'),{body}=panel;
  panel.dialog.setAttribute('data-widget-type','banner');
  const search=element(doc,'input',{type:'search',placeholder:'搜索引言内容','aria-label':'搜索引言'});
  const count=element(doc,'span',{class:'hw-quote-count',role:'status'}),error=element(doc,'p',{class:'hw-form-error',role:'alert'});
  const list=element(doc,'div',{class:'hw-quote-list'}),editor=element(doc,'section',{class:'hw-quote-editor',hidden:true});
  const mode=element(doc,'div',{class:'hw-quote-mode',role:'group','aria-label':'引言显示方式'}),modeStatus=element(doc,'p',{class:'hw-quote-mode-status',role:'status'});
  let manual=ctx.config.quoteMode==='manual';
  const input=element(doc,'textarea',{'aria-label':'引言内容',placeholder:'写下一句值得留下的话，支持换行',rows:4,maxlength:20000});
  let entries=[],editing=null,busy=false,loaded=false,confirming=null;
  const alive=()=>panel.alive&&!ctx.signal.aborted;
  const closeOnAbort=()=>{if(panel.alive)panel.dialog.close();};
  ctx.signal.addEventListener('abort',closeOnAbort,{once:true});
  panel.dialog.addEventListener('close',()=>ctx.signal.removeEventListener('abort',closeOnAbort),{once:true});
  function draft(){ctx.local.quoteDraft={source,body:input.value,entry:editing};}
  function open(entry){
    editing=entry||null;input.value=entry?.body||'';editor.hidden=false;draft();render();input.focus();
  }
  function cancel(){editor.hidden=true;delete ctx.local.quoteDraft;render();}
  async function perform(action){
    if(busy||!alive())return;busy=true;panel.setBusy(true);error.textContent='';render();
    try{await action();}
    catch(e){if(alive())error.textContent=e.message;}
    finally{busy=false;if(alive()){panel.setBusy(false);render();}}
  }
  async function load(){
    const next=await ctx.services.quotes.list(source);if(!alive())return;entries=next;loaded=true;confirming=null;
    if(!editor.hidden&&editing){const matches=entries.filter(entry=>entry.body===editing.body);if(matches.length===1){editing=matches[0];draft();}}
  }
  async function choose(entry){
    // Recheck the library before saving a selection from a potentially stale panel.
    const latest=await ctx.services.quotes.list(source);
    if(!alive())return;
    if(!latest.some(item=>item.body===entry.body))throw new Error('这条引言已被修改或删除，请重新载入后再选择');
    await ctx.updateConfig({quoteMode:'manual',selectedQuote:entry.body});
    ctx.notify('已设为首页引言；将持续显示，直到你更换或恢复每日自动');if(panel.alive)panel.dialog.close();
  }
  const automatic=button(doc,'每日自动',()=>{
    if(ctx.config.quoteMode!=='manual'){manual=false;render();return;}
    return perform(async()=>{await ctx.updateConfig({quoteMode:'daily',selectedQuote:''});ctx.notify('已恢复每日自动引言');if(panel.alive)panel.dialog.close();});
  },{class:'hw-button'});
  const manualButton=button(doc,'手动设置',()=>{manual=true;render();},{class:'hw-button'});
  mode.append(automatic,manualButton);
  const reload=button(doc,'重新载入',()=>perform(load),{class:'hw-button hw-text-button'});
  const add=button(doc,'＋ 添加引言',()=>open(),{class:'hw-button hw-primary'});
  const save=button(doc,'保存引言',()=>perform(async()=>{
    await ctx.services.quotes.save(source,input.value,editing);if(!alive())return;cancel();await load();ctx.notify('引言已保存');
  }),{class:'hw-button hw-primary'});
  const cancelButton=button(doc,'取消',cancel);
  input.addEventListener('input',draft);
  editor.append(element(doc,'label',{},'引言内容',input),element(doc,'div',{class:'hw-quote-editor-actions'},cancelButton,save));
  body.append(mode,modeStatus,element(doc,'div',{class:'hw-quote-toolbar'},search,reload,add),editor,error,count,list);
  function render(){
    automatic.disabled=busy||!editor.hidden;manualButton.disabled=busy||!editor.hidden;
    automatic.setAttribute('aria-pressed',String(!manual));manualButton.setAttribute('aria-pressed',String(manual));
    modeStatus.textContent=manual?'点击某条引言的「设为首页引言」，选定后持续显示，直到你更换或恢复每日自动。':'每天自动选一句；也可以切换到「手动设置」指定首页引言。';
    search.disabled=busy;reload.disabled=busy;add.disabled=busy||!loaded||!editor.hidden;save.disabled=busy;cancelButton.disabled=busy;input.disabled=busy;
    const term=search.value.trim().toLocaleLowerCase(),visible=entries.filter(entry=>entry.body.toLocaleLowerCase().includes(term));
    count.textContent=loaded?(term?'找到 '+visible.length+' / '+entries.length+' 条引言':'共 '+entries.length+' 条引言'):'正在读取引言…';
    list.replaceChildren();
    for(const entry of visible){
      const row=element(doc,'article',{class:'hw-quote-entry'}),actions=element(doc,'div',{class:'hw-quote-entry-actions'});
      if(confirming===entry){
        actions.append(element(doc,'span',{},'删除这条引言？'),button(doc,'取消',()=>{confirming=null;render();}),button(doc,'确认删除',()=>perform(async()=>{await ctx.services.quotes.remove(source,entry);await load();ctx.notify('引言已删除');}),{class:'hw-button hw-danger'}));
      }else{
        if(manual){
          const selected=ctx.config.quoteMode==='manual'&&ctx.config.selectedQuote===entry.body;
          const select=button(doc,selected?'当前使用':'设为首页引言',()=>perform(()=>choose(entry)),{class:'hw-button hw-quote-select'+(selected?' is-selected':''),'aria-label':(selected?'当前首页引言 ':'设为首页引言 ')+entry.body.slice(0,24)});
          actions.append(select);
        }
        actions.append(button(doc,'编辑',()=>open(entry),{class:'hw-button hw-text-button','aria-label':'编辑引言 '+entry.body.slice(0,24)}),button(doc,'删除',()=>{confirming=entry;render();},{class:'hw-button hw-text-button','aria-label':'删除引言 '+entry.body.slice(0,24)}));
      }
      for(const control of actions.querySelectorAll('button'))control.disabled=busy||!editor.hidden;
      row.append(element(doc,'p',{},entry.body),actions);list.append(row);
    }
    if(loaded&&!visible.length)list.append(empty(doc,term?'没有匹配的引言。':'引言库还空着，添加第一句话吧。'));
  }
  search.addEventListener('input',render);
  const saved=ctx.local.quoteDraft;if(saved?.source===source){editing=saved.entry;input.value=saved.body;editor.hidden=false;}
  perform(load);return panel.dialog;
}
module.exports={showQuoteManager};
