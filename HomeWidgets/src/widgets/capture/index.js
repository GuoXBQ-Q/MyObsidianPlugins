const {element,button}=require('../../core/dom');
const {icon}=require('../../core/icons');
const {bindCaptureShortcut}=require('../../core/capture-shortcut');
module.exports={type:'capture',label:'灵感速记',subtitle:'不用想清楚，先把这一刻留下。',icon:doc=>icon(doc,'sparkles'),span:7,defaults:{folder:'Inbox/Ideas',placeholder:'此刻，你脑海里闪过了什么？',quickAddChoice:''},
  fields:[{key:'folder',label:'灵感保存目录',required:true},{key:'placeholder',label:'输入框提示'},{key:'quickAddChoice',label:'QuickAdd Choice 名称（留空则直接创建笔记）'}],
  mount(ctx){const c=ctx.config,key='home-widgets-draft:'+ctx.platform.vaultId+':'+ctx.id;let storage;
    try{storage=ctx.doc.defaultView.localStorage;}catch{/* Keep in-memory drafts when browser storage is unavailable. */}
    const composer=element(ctx.doc,'div',{class:'hw-capture-composer'});
    const input=element(ctx.doc,'textarea',{class:'hw-capture-input','aria-label':'灵感内容',placeholder:c.placeholder,maxlength:20000});
    try{input.value=storage?.getItem(key)||ctx.local.draft||'';}catch{input.value=ctx.local.draft||'';}
    input.addEventListener('input',()=>{ctx.local.draft=input.value;try{storage?.setItem(key,input.value);}catch{/* Keep the in-memory draft. */}});
    const categories=['未分类','工作','生活','学习'],group=element(ctx.doc,'div',{class:'hw-capture-categories',role:'group','aria-label':'灵感分类'});
    group.append(element(ctx.doc,'span',{class:'hw-capture-category-label','aria-hidden':'true'},icon(ctx.doc,'tag'),element(ctx.doc,'span',{},'分类')));
    let selected=categories.includes(ctx.local.area)?ctx.local.area:'未分类';
    const choices=[];
    for(const category of categories){
      const choice=button(ctx.doc,category,()=>{
        selected=category;ctx.local.area=category;
        for(const [name,el] of choices)el.setAttribute('aria-pressed',String(name===selected));
      },{class:'hw-button hw-capture-category','aria-pressed':String(category===selected)});
      choices.push([category,choice]);group.append(choice);
    }
    const saveLabel=element(ctx.doc,'span',{},'保存灵感');
    const save=button(ctx.doc,'',async()=>{
      if(save.disabled)return;
      if(!input.value.trim()){input.focus();return;}save.disabled=true;saveLabel.textContent='保存中…';const body=input.value,area=selected;
      try{if(c.quickAddChoice)await ctx.services.integrations.quickAdd(c.quickAddChoice,{value:body,area});else await ctx.services.ideas.capture(c.folder,{body,area});
        if(ctx.signal.aborted)return;
        if(input.value===body){input.value='';ctx.local.draft='';try{storage?.removeItem(key);}catch{}}
        ctx.notify(c.quickAddChoice?'已交给 QuickAdd 流程':'灵感已保存为独立笔记');
      }catch(e){ctx.notify(e.message,true);}finally{if(!ctx.signal.aborted){save.disabled=false;saveLabel.textContent='保存灵感';}}
    },{class:'hw-button hw-primary hw-capture-save','aria-label':'保存灵感'});
    save.append(icon(ctx.doc,'upload'),saveLabel);
    composer.append(input,element(ctx.doc,'div',{class:'hw-capture-footer'},group,element(ctx.doc,'span',{class:'hw-capture-key'},'Ctrl / ⌘ + Enter'),save));
    ctx.el.append(composer);
    bindCaptureShortcut(composer,save,ctx);
  }
};
