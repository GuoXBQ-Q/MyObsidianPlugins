const {element,button,empty}=require('../../core/dom');
const {daysUntil}=require('../../services/date');
const {leafTasks,groupFor,groupError}=require('../../services/tasks');
const {icon}=require('../../core/icons');
const {createDatePicker}=require('../../core/date-picker');
const {createTaskDrag}=require('./drag');
const keys=(settings,name)=>Array.isArray(settings[name])?settings[name].filter(key=>typeof key==='string'):[];
const taskKey=task=>JSON.stringify([task.source,task.id]);
const baseRaw=raw=>raw.replace(/ \^[\w-]+\s*$/,'').trimEnd();
module.exports={type:'tasks',label:'分类待办',icon:doc=>icon(doc,'tasks'),span:4,defaults:{source:'Home/待办.md',area:'work',showCompleted:true,limit:20},
  fields:[{key:'source',label:'待办笔记路径',required:true},{key:'area',label:'分类标签后缀，例如 work、life、study',required:true},{key:'showCompleted',label:'显示已完成任务',type:'checkbox'},{key:'limit',label:'最多显示主待办组数',type:'number',min:1,max:200}],
  watch:c=>['file:'+c.source,'integrations'],
  async mount(ctx){
    const c=ctx.config,all=await ctx.services.tasks.list(c.source);if(ctx.signal.aborted)return;
    const roots=all.filter(task=>task.parentLine===null&&(task.area===c.area||groupFor(all,task).some(child=>child.area===c.area))),groups=new Map(roots.map(root=>[root.id,groupFor(all,root)]));
    const tasks=all.filter(task=>task.area===c.area),leaves=leafTasks(tasks),hidden=new Set(keys(c,'hiddenTaskKeys')),collapsed=new Set(keys(c,'collapsedTaskKeys'));
    const hiddenCount=roots.reduce((count,root)=>count+(root.done&&hidden.has(taskKey(root))?1:groups.get(root.id).slice(1).filter(task=>task.done&&hidden.has(taskKey(task))).length),0);
    const completed=leaves.filter(task=>task.done).length,remaining=leaves.length-completed,entries=[];
    const visibilityChange=action=>{
      const previous=ctx.local.taskVisibilityQueue||Promise.resolve(),next=previous.catch(()=>{}).then(action);ctx.local.taskVisibilityQueue=next;
      return next.finally(()=>{if(ctx.local.taskVisibilityQueue===next)delete ctx.local.taskVisibilityQueue;});
    };
    const refresh=()=>{if(!ctx.signal.aborted)return ctx.refresh();};
    const counter=element(ctx.doc,'span',{class:'hw-task-counter'+(!leaves.length?' is-empty':!remaining?' is-complete':''),role:'img','aria-label':leaves.length?'共 '+leaves.length+' 项待办，已完成 '+completed+' 项，剩余 '+remaining+' 项':'暂无待办'},
      element(ctx.doc,'span',{class:'hw-task-progress',style:'--hw-task-progress:'+(leaves.length?completed/leaves.length*100:0)+'%','aria-hidden':'true'}),
      element(ctx.doc,'span',{class:'hw-task-summary','aria-hidden':'true'},...(remaining?['剩余 ',element(ctx.doc,'strong',{},remaining),' 项']:[leaves.length?'全部完成':'暂无待办'])));
    ctx.actions.append(counter);
    const restore=button(ctx.doc,'',()=>{
      restore.disabled=true;
      return ctx.run(()=>visibilityChange(async()=>{await ctx.updateConfig({hiddenTaskKeys:[],showCompleted:true});ctx.notify('已还原隐藏待办');})).finally(refresh);
    },{class:'hw-button hw-task-restore','aria-label':'还原此组件的全部隐藏待办','aria-description':'已隐藏 '+hiddenCount+' 项（整组计一项）'});
    const badge=element(ctx.doc,'span',{class:'hw-task-hidden-count','aria-hidden':'true'},hiddenCount);badge.hidden=hiddenCount===0;restore.append(icon(ctx.doc,'restore'),badge);restore.disabled=hiddenCount===0;ctx.actions.append(restore);
    const list=element(ctx.doc,'div',{class:'hw-task-list'}),visible=task=>!task.done||(c.showCompleted&&!hidden.has(taskKey(task)));
    let active=ctx.local.childEditor;
    if(active?.source===c.source){
      const parent=roots.find(root=>root.id===active.parentId||active.parentRaw===baseRaw(root.raw));
      if(parent){active.parentId=parent.id;active.parentRaw=baseRaw(parent.raw);}else active=null;
    }else active=null;
    const visibleRoots=roots.filter(visible).sort((a,b)=>Number(a.done)-Number(b.done)).slice(0,c.limit);
    // A newly reopened parent can move beyond the configured limit. Keep its live
    // editor reachable until the user closes it, without exceeding the group limit.
    const editingRoot=active&&roots.find(root=>root.id===active.parentId&&visible(root));
    if(editingRoot&&!visibleRoots.includes(editingRoot)){if(visibleRoots.length>=c.limit)visibleRoots.pop();visibleRoots.push(editingRoot);}
    function iconButton(name,label,fn,extra=''){
      const control=button(ctx.doc,'',fn,{class:'hw-button hw-task-action '+extra,'aria-label':label});control.append(icon(ctx.doc,name));return control;
    }
    async function move(task,target,after){
      const id=await ctx.services.tasks.move(task,target,after);ctx.local.taskFocus={source:task.source,id,action:'drag'};ctx.notify('待办顺序已保存');await refresh();
    }
    function renderRow(task,root,group,container){
      const isChild=task.parentLine!==null,error=groupError(group),row=element(ctx.doc,'div',{class:'hw-task'+(isChild?' hw-task-child':'')+(task.done?' is-done':''),'data-task-id':task.id});
      if(!isChild){
        if(group.length>1){
          const fold=iconButton('chevron','展开子待办 '+task.title,()=>ctx.run(()=>visibilityChange(async()=>{
            const id=await ctx.services.tasks.ensureId(task),key=JSON.stringify([task.source,id]),wasCollapsed=collapsed.has(taskKey(task));
            if(ctx.local.childEditor?.parentId===id)ctx.local.childEditor=null;
            await ctx.updateConfig(current=>({collapsedTaskKeys:wasCollapsed?keys(current,'collapsedTaskKeys').filter(value=>value!==key):[...new Set([...keys(current,'collapsedTaskKeys'),key])]}));
          })).finally(refresh),'hw-task-fold');
          const isCollapsed=collapsed.has(taskKey(task))&&active?.parentId!==task.id;fold.setAttribute('aria-label',(isCollapsed?'展开':'收起')+'子待办 '+task.title);fold.setAttribute('aria-expanded',String(!isCollapsed));row.append(fold);
        }else row.append(element(ctx.doc,'span',{class:'hw-task-fold-space','aria-hidden':'true'}));
      }
      const input=element(ctx.doc,'input',{type:'checkbox',checked:task.done,'aria-label':task.title}),copy=element(ctx.doc,'span',{},element(ctx.doc,'span',{class:'hw-task-title'},task.title));
      input.disabled=!!error;
      if(task.due){let suffix='';try{if(!task.done&&daysUntil(task.due)<0)suffix=' · 已逾期';}catch{suffix=' · 日期无效';}copy.append(element(ctx.doc,'small',{},task.due.slice(5).replace('-',' / ')+suffix));}
      const main=element(ctx.doc,'label',{class:'hw-task-main'},input,copy);row.append(main);
      input.addEventListener('change',()=>{input.disabled=true;return ctx.run(async()=>{await ctx.services.tasks.toggle(task,input.checked);ctx.notify('任务已更新');}).finally(refresh);});
      if(!isChild&&group.length>1)row.append(element(ctx.doc,'span',{class:'hw-task-group-progress','aria-label':'子待办已完成 '+group.slice(1).filter(item=>item.done).length+' / '+(group.length-1)},group.slice(1).filter(item=>item.done).length+'/'+(group.length-1)));
      const actions=element(ctx.doc,'div',{class:'hw-task-row-actions'});
      if(!isChild&&!task.recurring&&!error){
        const addChild=iconButton('plus','添加子待办 '+task.title,()=>ctx.run(async()=>{
          ctx.local.childDrafts=ctx.local.childDrafts||{};
          const state=ctx.local.childDrafts[taskKey(task)]||{source:task.source,parentId:task.id,parentRaw:baseRaw(task.raw),title:'',due:''};state.focus=true;ctx.local.childEditor=state;
          const id=await ctx.services.tasks.ensureId(task);state.parentId=id;ctx.local.childDrafts[JSON.stringify([task.source,id])]=state;
          await ctx.updateConfig(current=>({collapsedTaskKeys:keys(current,'collapsedTaskKeys').filter(key=>key!==JSON.stringify([task.source,id]))}));await refresh();
        }),'hw-task-add-child');actions.append(addChild);
      }
      actions.append(iconButton('edit','编辑待办 '+task.title,()=>ctx.forms.show('编辑待办',[{key:'title',label:'要做的事',required:true},{key:'due',label:'截止日期（可选）',type:'date'}],{title:task.title,due:task.due},value=>ctx.services.tasks.edit(task,value)),'hw-task-edit'));
      if(task.done){
        const hide=iconButton('hide','隐藏已完成待办 '+task.title,()=>{
          hide.disabled=true;return ctx.run(()=>visibilityChange(async()=>{
            const id=await ctx.services.tasks.ensureId(task),key=JSON.stringify([task.source,id]);
            await ctx.updateConfig(current=>({hiddenTaskKeys:[...new Set([...keys(current,'hiddenTaskKeys'),key])]}));ctx.notify(isChild?'已隐藏子待办':group.length>1?'已隐藏整组待办':'已隐藏待办');
          })).finally(refresh);
        },'hw-task-hide');actions.append(hide);
      }
      actions.append(iconButton('trash','删除待办 '+task.title,()=>ctx.forms.confirm('删除待办',{message:!isChild&&group.length>1?'确定删除这组待办吗？':'确定删除这条待办吗？',content:task.title,detail:'将从笔记「'+task.source+'」中删除此待办'+(!isChild&&group.length>1?'及全部 '+(group.length-1)+' 个子待办':'及其缩进说明')+'，其他组件也会同步更新。'},()=>ctx.services.tasks.remove(task),'删除待办'),'hw-task-delete'));
      const grip=iconButton('grip','排序待办 '+task.title,()=>{},'hw-task-grip');grip.disabled=!!error;grip.setAttribute('aria-description','按住拖动；Alt + 上下方向键调整同级顺序，Esc 取消拖拽');grip.setAttribute('aria-grabbed','false');actions.append(grip);row.append(actions);container.append(row);
      entries.push({task,handle:grip,el:isChild?row:container,disabled:!!error});
      const focus=ctx.local.taskFocus;if(focus?.source===task.source&&focus.id===task.id){delete ctx.local.taskFocus;queueMicrotask(()=>{if(!ctx.signal.aborted)grip.focus();});}
      return row;
    }
    function renderEditor(root,container,state){
      const editor=element(ctx.doc,'form',{class:'hw-task-child-editor','aria-label':'添加子待办到 '+root.title}),title=element(ctx.doc,'input',{type:'text',class:'hw-task-child-input',value:state.title,placeholder:'添加子待办，Enter 保存','aria-label':'子待办内容',autocomplete:'off'});
      const picker=createDatePicker(ctx.doc,{id:'hw-child-date-'+crypto.randomUUID(),name:'due',label:'子待办截止日期（可选）'});picker.input.value=state.due;
      ctx.signal.addEventListener('abort',()=>picker.dispose(),{once:true});
      title.addEventListener('input',()=>{state.title=title.value;});picker.input.addEventListener('change',()=>{state.due=picker.input.value;});
      let saving=false;
      const close=()=>{ctx.local.childEditor=null;state.focus=false;return refresh();};
      const submit=()=>{
        if(saving)return;saving=true;save.disabled=true;title.disabled=true;picker.input.disabled=true;
        return ctx.run(async()=>{
          const result=await ctx.services.tasks.addChild(root,{title:state.title,due:state.due});state.parentId=result.parentId;state.title='';state.due='';state.focus=false;ctx.local.childEditor=null;ctx.notify('已添加子待办');await refresh();
        }).finally(()=>{saving=false;if(!ctx.signal.aborted){save.disabled=false;title.disabled=false;picker.input.disabled=false;title.focus();}});
      };
      const save=button(ctx.doc,'添加',submit,{class:'hw-button hw-task-child-save'}),cancel=button(ctx.doc,'取消',close,{class:'hw-button hw-task-child-cancel'});
      editor.addEventListener('submit',event=>{event.preventDefault();if(!event.isComposing)submit();});
      title.addEventListener('keydown',event=>{if(event.key==='Enter'&&!event.isComposing&&event.keyCode!==229){event.preventDefault();submit();}});
      editor.addEventListener('keydown',event=>{if(event.key==='Escape'&&!event.defaultPrevented&&!event.isComposing){event.preventDefault();event.stopPropagation();if(picker.isOpen())picker.close();else if(!saving)close();}});
      editor.append(title,element(ctx.doc,'div',{class:'hw-task-child-editor-tools'},picker.root,save,cancel));container.append(editor);
      if(state.focus){state.focus=false;queueMicrotask(()=>{if(!ctx.signal.aborted)title.focus();});}
    }
    let previousStatus;
    for(const root of visibleRoots){
      if(previousStatus!==root.done){list.append(element(ctx.doc,'h3',{class:'hw-task-section'},root.done?'已完成':'未完成'));previousStatus=root.done;}
      const group=groups.get(root.id),container=element(ctx.doc,'div',{class:'hw-task-group','data-task-group':root.id});renderRow(root,root,group,container);
      const error=groupError(group);if(error)container.append(element(ctx.doc,'p',{class:'hw-task-warning',role:'status'},error));
      if(!collapsed.has(taskKey(root))||active?.parentId===root.id){
        const children=element(ctx.doc,'div',{class:'hw-task-children'});for(const task of group.slice(1).filter(visible))renderRow(task,root,group,children);container.append(children);
      }
      if(active?.parentId===root.id&&!error)renderEditor(root,container,active);list.append(container);
    }
    if(!visibleRoots.length)list.append(empty(ctx.doc,hiddenCount?'已隐藏 '+hiddenCount+' 条已完成待办，可在标题栏还原。':'留白也是一种从容。添加第一件事吧。'));
    const add=()=>ctx.forms.show('添加待办',[{key:'title',label:'要做的事',required:true},{key:'due',label:'截止日期（可选）',type:'date'}],{},value=>ctx.services.tasks.add(c.source,{...value,area:c.area}),'添加待办');
    ctx.actions.append(button(ctx.doc,'＋ 添加待办',add,{class:'hw-button hw-task-add'}));ctx.el.append(list);
    createTaskDrag({list,doc:ctx.doc,entries,onMove:move,onError:error=>ctx.notify(error.message),signal:ctx.signal});
  }
};
