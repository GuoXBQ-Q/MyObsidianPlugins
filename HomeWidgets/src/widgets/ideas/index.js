const {element,button,empty}=require('../../core/dom');
module.exports={type:'ideas',label:'灵感收件箱',icon:'♧',span:8,defaults:{folder:'Inbox/Ideas',limit:5},
  fields:[{key:'folder',label:'灵感目录',required:true},{key:'limit',label:'每次显示条数',type:'number',min:1,max:100}],watch:c=>['folder:'+c.folder],
  async mount(ctx){
    const ideas=await ctx.services.ideas.list(ctx.config.folder);if(ctx.signal.aborted)return;
    const search=element(ctx.doc,'input',{class:'hw-ideas-search',type:'search','aria-label':'搜索灵感',placeholder:'搜索标题、正文或分类',value:ctx.local.query||''});
    const tabs=element(ctx.doc,'div',{class:'hw-ideas-tabs',role:'group','aria-label':'灵感筛选'}),count=element(ctx.doc,'p',{class:'hw-ideas-count',role:'status'}),list=element(ctx.doc,'div',{class:'hw-ideas-list'});
    const pending=ideas.filter(idea=>idea.status!=='archived').length,filters=[];
    let filter=ctx.local.filter||'all',limit=Math.max(1,Number(ctx.config.limit)||5),shown=limit;
    for(const [id,label,total] of [['all','全部',ideas.length],['inbox','待整理',pending],['archived','已归档',ideas.length-pending]]){
      const tab=button(ctx.doc,label+' '+total,()=>{filter=id;ctx.local.filter=id;shown=limit;render();},{class:'hw-button'});filters.push([id,tab]);tabs.append(tab);
    }
    const more=button(ctx.doc,'显示更多',()=>{shown+=limit;render();},{class:'hw-button hw-text-button hw-ideas-more'});
    function render(){
      const query=search.value.trim().toLocaleLowerCase();ctx.local.query=search.value;
      for(const [id,tab] of filters){tab.className='hw-button'+(filter===id?' is-active':'');tab.setAttribute('aria-pressed',String(filter===id));}
      const matches=ideas.filter(idea=>(filter==='all'||(filter==='archived'?idea.status==='archived':idea.status!=='archived'))&&[idea.title,idea.body,idea.area].join('\n').toLocaleLowerCase().includes(query));
      count.textContent='找到 '+matches.length+' 条灵感'+(matches.length>shown?' · 当前显示 '+shown+' 条':'');list.replaceChildren();
      for(const idea of matches.slice(0,shown)){
        const article=element(ctx.doc,'article',{class:'hw-idea'}),copy=element(ctx.doc,'div',{class:'hw-idea-copy'}),actions=element(ctx.doc,'div',{class:'hw-idea-actions'});
        const date=new Date(idea.created),stamp=Number.isNaN(date.getTime())?'未记录时间':date.toLocaleDateString('zh-CN',{year:'numeric',month:'2-digit',day:'2-digit'});
        const open=()=>ctx.run(()=>ctx.services.io.open(idea.path)),archived=idea.status==='archived';
        copy.append(element(ctx.doc,'div',{class:'hw-idea-meta'},idea.area||'未分类',' · ',stamp,' · ',archived?'已归档':'待整理'),element(ctx.doc,'h3',{},button(ctx.doc,idea.title,open,{class:'hw-button hw-text-button hw-idea-title'})),element(ctx.doc,'p',{},idea.summary.slice(0,160)+(idea.summary.length>160?'…':'')));
        actions.append(button(ctx.doc,'打开',open,{class:'hw-button hw-text-button','aria-label':'打开灵感 '+idea.title}),button(ctx.doc,archived?'恢复':'归档',event=>{
          const control=event.currentTarget;control.disabled=true;
          return ctx.run(async()=>{await ctx.services.ideas.archive(ctx.config.folder,idea.path,!archived);await ctx.refresh();}).finally(()=>{if(!ctx.signal.aborted)control.disabled=false;});
        },{class:'hw-button hw-text-button','aria-label':(archived?'恢复灵感 ':'归档灵感 ')+idea.title}));article.append(copy,actions);list.append(article);
      }
      if(!matches.length)list.append(empty(ctx.doc,query?'没有匹配的灵感，试试正文里的关键词。':'这里还没有灵感。记录后会自动出现在这里。'));
      more.hidden=matches.length<=shown;
    }
    search.addEventListener('input',()=>{shown=limit;render();});
    ctx.el.append(search,tabs,count,list,more);render();
  }
};
