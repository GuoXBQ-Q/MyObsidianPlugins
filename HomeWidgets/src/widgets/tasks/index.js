const {element,button,empty}=require('../../core/dom');
const {daysUntil}=require('../../services/date');
const {icon}=require('../../core/icons');
const hiddenKeys=settings=>Array.isArray(settings.hiddenTaskKeys)?settings.hiddenTaskKeys.filter(key=>typeof key==='string'):[];
const taskKey=(source,id)=>JSON.stringify([source,id]);
module.exports={type:'tasks',label:'分类待办',icon:doc=>icon(doc,'tasks'),span:4,defaults:{source:'Home/待办.md',area:'work',showCompleted:true,limit:20},
  fields:[{key:'source',label:'待办笔记路径',required:true},{key:'area',label:'分类标签后缀，例如 work、life、study',required:true},{key:'showCompleted',label:'显示已完成任务',type:'checkbox'},{key:'limit',label:'最多显示数量',type:'number',min:1,max:200}],
  watch:c=>['file:'+c.source,'integrations'],
  async mount(ctx){const c=ctx.config,tasks=await ctx.services.tasks.list(c.source,c.area);if(ctx.signal.aborted)return;
    const hidden=new Set(hiddenKeys(c)),hiddenCount=tasks.filter(task=>task.done&&hidden.has(taskKey(task.source,task.id))).length;
    // Preserve click order across remounts, including ID assignment for plain Markdown tasks.
    const visibilityChange=action=>{
      const previous=ctx.local.taskVisibilityQueue||Promise.resolve();
      const next=previous.catch(()=>{}).then(action);ctx.local.taskVisibilityQueue=next;
      return next.finally(()=>{if(ctx.local.taskVisibilityQueue===next)delete ctx.local.taskVisibilityQueue;});
    };
    const completed=tasks.filter(task=>task.done).length,remaining=tasks.length-completed;
    const counter=element(ctx.doc,'span',{class:'hw-task-counter'+(!tasks.length?' is-empty':!remaining?' is-complete':''),role:'img','aria-label':tasks.length?'共 '+tasks.length+' 项待办，已完成 '+completed+' 项，剩余 '+remaining+' 项':'暂无待办'},
      element(ctx.doc,'span',{class:'hw-task-progress',style:'--hw-task-progress:'+(tasks.length?completed/tasks.length*100:0)+'%','aria-hidden':'true'}),
      element(ctx.doc,'span',{class:'hw-task-summary','aria-hidden':'true'},...(remaining?['剩余 ',element(ctx.doc,'strong',{},remaining),' 项']:[tasks.length?'全部完成':'暂无待办'])));
    ctx.actions.append(counter);
    const restore=button(ctx.doc,'',()=>{
      restore.disabled=true;
      return ctx.run(()=>visibilityChange(async()=>{await ctx.updateConfig({hiddenTaskKeys:[],showCompleted:true});ctx.notify('已还原隐藏待办');}))
        .finally(()=>{if(!ctx.signal.aborted){restore.disabled=hiddenCount===0;return ctx.refresh();}});
    },{class:'hw-button hw-task-restore','aria-label':'还原此组件的全部隐藏待办','aria-description':'已隐藏 '+hiddenCount+' 条待办'});
    const badge=element(ctx.doc,'span',{class:'hw-task-hidden-count','aria-hidden':'true'},hiddenCount);badge.hidden=hiddenCount===0;
    restore.append(icon(ctx.doc,'restore'),badge);
    restore.disabled=hiddenCount===0;ctx.actions.append(restore);
    const list=element(ctx.doc,'div',{class:'hw-task-list'});
    const visible=tasks.filter(t=>!t.done||(c.showCompleted&&!hidden.has(taskKey(t.source,t.id)))).sort((a,b)=>Number(a.done)-Number(b.done)||(a.due||'9999').localeCompare(b.due||'9999')).slice(0,c.limit);
    let previousStatus;
    for(const task of visible){
      if(previousStatus!==task.done){list.append(element(ctx.doc,'h3',{class:'hw-task-section'},task.done?'已完成':'未完成'));previousStatus=task.done;}
      const input=element(ctx.doc,'input',{type:'checkbox',checked:task.done,'aria-label':task.title}),copy=element(ctx.doc,'span',{},element(ctx.doc,'span',{class:'hw-task-title'},task.title));
      if(task.due){let suffix='';try{if(!task.done&&daysUntil(task.due)<0)suffix=' · 已逾期';}catch{suffix=' · 日期无效';}copy.append(element(ctx.doc,'small',{},task.due.slice(5).replace('-',' / ')+suffix));}
      const main=element(ctx.doc,'label',{class:'hw-task-main'},input,copy),row=element(ctx.doc,'div',{class:'hw-task'+(task.done?' is-done':'')},main);
      input.addEventListener('change',()=>{input.disabled=true;return ctx.run(async()=>{await ctx.services.tasks.toggle(task,input.checked);ctx.notify('任务已更新');}).finally(()=>{if(!ctx.signal.aborted)return ctx.refresh();});});
      const actions=element(ctx.doc,'div',{class:'hw-task-row-actions'});
      const edit=button(ctx.doc,'',()=>ctx.forms.show('编辑待办',[{key:'title',label:'要做的事',required:true},{key:'due',label:'截止日期（可选）',type:'date'}],{title:task.title,due:task.due},value=>ctx.services.tasks.edit(task,value)),{class:'hw-button hw-task-action hw-task-edit','aria-label':'编辑待办 '+task.title});edit.append(icon(ctx.doc,'edit'));actions.append(edit);
      if(task.done){
        const hide=button(ctx.doc,'',()=>{
          hide.disabled=true;
          return ctx.run(()=>visibilityChange(async()=>{
            const id=await ctx.services.tasks.ensureId(task),key=taskKey(task.source,id);
            await ctx.updateConfig(current=>({hiddenTaskKeys:[...new Set([...hiddenKeys(current),key])]}));ctx.notify('已隐藏待办');
          })).finally(()=>{if(!ctx.signal.aborted){hide.disabled=false;return ctx.refresh();}});
        },{class:'hw-button hw-task-action hw-task-hide','aria-label':'隐藏已完成待办 '+task.title});
        hide.append(icon(ctx.doc,'hide'));
        actions.append(hide);
      }
      const remove=button(ctx.doc,'',()=>ctx.forms.confirm('删除待办',{message:'确定删除这条待办吗？',content:task.title,detail:'将从笔记「'+task.source+'」中删除此待办及其缩进子项，其他组件也会同步更新。'},()=>ctx.services.tasks.remove(task),'删除待办'),{class:'hw-button hw-task-action hw-task-delete','aria-label':'删除待办 '+task.title});remove.append(icon(ctx.doc,'trash'));actions.append(remove);row.append(actions);
      list.append(row);
    }
    if(!list.childElementCount)list.append(empty(ctx.doc,hiddenCount?'已隐藏 '+hiddenCount+' 条已完成待办，可在标题栏还原。':'留白也是一种从容。添加第一件事吧。'));
    const add=()=>ctx.forms.show('添加待办',[{key:'title',label:'要做的事',required:true},{key:'due',label:'截止日期（可选）',type:'date'}],{},value=>ctx.services.tasks.add(c.source,{...value,area:c.area}),'添加待办');
    ctx.actions.append(button(ctx.doc,'＋ 添加待办',add,{class:'hw-button hw-task-add'}));
    ctx.el.append(list);
  }
};
