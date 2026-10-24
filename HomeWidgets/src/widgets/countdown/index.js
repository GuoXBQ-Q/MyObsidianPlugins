const {element,button,empty}=require('../../core/dom');
const {icon}=require('../../core/icons');
const {daysUntil,localDay}=require('../../services/date');
const {collectionKey}=require('../../services/persistent-events');
const fields=[{key:'title',label:'日期名称',required:true},{key:'date',label:'目标日期',type:'date',required:true},{key:'start',label:'开始日期（可选）',type:'date'},{key:'area',label:'分类'}];
const weekdays=['周日','周一','周二','周三','周四','周五','周六'];
function dateDetails(date){
  const [year,month,day]=date.split('-').map(Number);
  return {year,month,day,weekday:weekdays[new Date(year,month-1,day,12).getDay()]};
}
function listIcon(event){
  if(/新年|新的一年|元旦|纪念|生日|庆祝/.test(event.title))return 'sparkles';
  return event.area==='生活'?'coffee':'calendar';
}
module.exports={type:'countdown',label:'倒计时',icon:doc=>icon(doc,'hourglass'),span:5,defaults:{source:'default',featured:'',upcoming:0},
  fields:[{key:'source',label:'日期集合',required:true,help:'相同集合共用日期。独立日期保存在本插件，关联日程由 MyCalendar 提供；无需填写笔记路径。'},{key:'featured',label:'置顶日期',type:'select',dependsOn:['source'],options:async(value,services)=>[['','自动选择（最近未到期的日子）'],...(await services.events.list(value.source)).sort((a,b)=>a.date.localeCompare(b.date)).map(e=>[e.id,e.title+' · '+e.date])],help:'仅影响当前组件；也可直接点击日期旁的图钉设置或取消置顶。全部日期都已结束时，自动显示最近结束的日子。'},{key:'upcoming',label:'折叠时显示数量（0 = 全部）',type:'number',min:0,max:200,help:'设置数量后仍可点击「查看全部」；日期较多时在组件内滚动查看。'}],
  watch:c=>['countdown:'+collectionKey(c.source),'calendar-source'],
  async mount(ctx){
    const all=await ctx.services.events.list(ctx.config.source,{includeArchived:true});if(ctx.signal.aborted)return;
    const sourceStatus=await ctx.services.events.sourceStatus();if(ctx.signal.aborted)return;
    if(sourceStatus&&sourceStatus.state!=='connected')ctx.el.append(element(ctx.doc,'p',{class:'hw-countdown-source-status',role:'status'},sourceStatus.message));
    const events=all.filter(e=>!e.archived),archived=all.filter(e=>e.archived);
    if(ctx.config.featured&&!events.some(e=>e.id===ctx.config.featured)&&await ctx.services.events.canClearFeatured(ctx.config.featured)){
      await ctx.updateConfig({featured:''});if(ctx.signal.aborted)return;
    }
    const doc=ctx.doc,edit=e=>{
      if(e?.calendarEventId){ctx.notify('此倒计时来自 MyCalendar，请在日程中修改；取消同步或删除日程也会移除倒计时。');return;}
      return ctx.forms.show(e?'编辑关键日期':'添加关键日期',fields,e||{area:'生活'},v=>ctx.services.events.save(ctx.config.source,{...v,id:e?.id}));
    };
    const pinButton=event=>{
      const selected=event.id===ctx.config.featured;
      const pin=button(doc,'',()=>ctx.run(async()=>{
        if(pin.disabled||ctx.signal.aborted)return;pin.disabled=true;
        try{
          if(!selected){
            const latest=await ctx.services.events.list(ctx.config.source);if(ctx.signal.aborted)return;
            if(!latest.some(e=>e.id===event.id))throw new Error('日期已删除，请刷新后重新选择');
          }
          await ctx.updateConfig({featured:selected?'':event.id});
        }finally{pin.disabled=false;}
      }),{class:'hw-button hw-icon-button hw-countdown-pin-button'+(selected?' is-pinned':''),'aria-label':(selected?'取消置顶 ':'置顶日期 ')+event.title,'aria-pressed':String(selected)});
      pin.append(icon(doc,'pin'));return pin;
    };
    const deleteButton=event=>{
      if(event.calendarEventId){
        const archive=button(doc,'',()=>ctx.forms.confirm('归档日历同步日期','归档后隐藏倒计时，仍会接收日程更新，可从「已归档」恢复。要停止联动，请在 MyCalendar 日程中取消同步。',async()=>{
          await ctx.services.events.archive(ctx.config.source,event);if(!ctx.signal.aborted)await ctx.refresh();
        },'归档'),{class:'hw-button hw-icon-button hw-countdown-archive-date','aria-label':'归档日期 '+event.title});
        archive.append(icon(doc,'archive'));return archive;
      }
      const remove=button(doc,'',()=>ctx.forms.show('删除关键日期',[],{},async()=>{
        await ctx.services.events.remove(ctx.config.source,event);if(!ctx.signal.aborted)await ctx.refresh();
      },'删除日期',{
        danger:true,successMessage:'已删除',
        description:{message:'可以归档保留这个日子，也可以永久删除。',content:event.title,
          detail:event.date+' · 归档后不再显示，可从「已归档」恢复；删除会永久移除记录。其他使用同一日期集合的组件也会同步更新。'},
        secondaryAction:{label:'归档',successMessage:'已归档',run:async()=>{
          await ctx.services.events.archive(ctx.config.source,event);if(!ctx.signal.aborted)await ctx.refresh();
        }}
      }),{
        class:'hw-button hw-icon-button hw-countdown-delete','aria-label':'删除日期 '+event.title
      });
      remove.append(icon(doc,'trash'));return remove;
    };
    const add=button(doc,'',()=>edit(),{'aria-label':'添加关键日期',class:'hw-button hw-icon-button hw-countdown-add'});
    add.append(icon(doc,'plus'),element(doc,'span',{},'添加'));
    if(archived.length){
      const history=button(doc,'',()=>ctx.forms.show('已归档的日子',[
        {key:'id',label:'选择要恢复的日子',type:'select',options:[...archived].sort((a,b)=>a.date.localeCompare(b.date)).map(e=>[e.id,e.title+' · '+e.date])}
      ],{id:archived[0].id},async value=>{
        const event=archived.find(e=>e.id===value.id);if(!event)throw new Error('请选择要恢复的日子');
        await ctx.services.events.restore(ctx.config.source,event);if(!ctx.signal.aborted)await ctx.refresh();
      },'恢复显示',{description:'归档的日子保留在日期集合中，不参与倒计时显示。恢复后重新显示，原有置顶不会自动恢复。',successMessage:'已恢复显示'}),{class:'hw-button hw-icon-button hw-countdown-archive','aria-label':'查看已归档的日子（'+archived.length+'）'});
      history.append(icon(doc,'archive'),element(doc,'span',{class:'hw-countdown-archive-count','aria-hidden':'true'},archived.length));
      ctx.actions.append(history);
    }
    ctx.actions.append(add);
    const ordered=[...events].sort((a,b)=>a.date.localeCompare(b.date));
    const pinned=events.find(e=>e.id===ctx.config.featured);
    const main=pinned||ordered.find(e=>daysUntil(e.date)>=0)||ordered.at(-1);
    if(!main){ctx.el.append(empty(doc,'添加一个值得期待的日子吧。'));return;}
    const days=daysUntil(main.date),date=dateDetails(main.date);
    const hero=element(doc,'section',{class:'hw-countdown-hero','aria-label':'主倒计时 '+main.title});
    const meta=element(doc,'div',{class:'hw-countdown-meta'});
    if(main.area)meta.append(element(doc,'span',{class:'hw-pill hw-countdown-category'},main.area));
    meta.append(element(doc,'span',{class:'hw-countdown-pin'},pinned?'置顶':'自动选择'));
    if(main.calendarEventId)meta.append(element(doc,'span',{class:'hw-countdown-source'},'日历同步'));
    else{
      const editButton=button(doc,'',()=>edit(main),{class:'hw-button hw-icon-button hw-countdown-edit','aria-label':'编辑'+main.title});
      editButton.append(icon(doc,'edit'));meta.append(editButton);
    }
    meta.append(pinButton(main),deleteButton(main));
    const content=element(doc,'div',{class:'hw-countdown-content'});
    const copy=element(doc,'div',{class:'hw-countdown-copy'},
      element(doc,'h3',{class:'hw-countdown-title'},main.title),
      element(doc,'p',{class:'hw-countdown-status'},days>0?'距离目标还有':days===0?'就是今天':'距离目标已过去'));
    const number=element(doc,'div',{class:'hw-countdown-number'},Math.abs(days),element(doc,'span',{},'天'));
    copy.append(number);
    const tile=element(doc,'div',{class:'hw-countdown-calendar',role:'img','aria-label':`${date.year}年${date.month}月${date.day}日 · ${date.weekday}`},
      element(doc,'span',{class:'hw-countdown-month'},date.month+'月'),
      element(doc,'span',{class:'hw-countdown-day'},String(date.day).padStart(2,'0')),
      element(doc,'span',{class:'hw-countdown-weekday'},date.weekday));
    content.append(copy,tile);
    hero.append(meta,content);ctx.el.append(hero);
    // Upcoming dates take priority; expired dates follow, most recent first.
    const remaining=ordered.filter(e=>e.id!==main.id);
    const next=[...remaining.filter(e=>daysUntil(e.date)>=0),...remaining.filter(e=>daysUntil(e.date)<0).reverse()];
    if(next.length){
      const heading=element(doc,'div',{class:'hw-countdown-list-heading'},element(doc,'span',{},'其他日子'),element(doc,'span',{class:'hw-countdown-list-count'},next.length));
      ctx.el.append(heading);
      const list=element(doc,'div',{class:'hw-countdown-list'}),year=Number(localDay().slice(0,4));
      const limit=Math.max(0,Math.floor(Number(ctx.config.upcoming)||0));
      const listId='hw-countdown-list-'+ctx.id;list.id=listId;
      list.setAttribute('role','region');list.setAttribute('aria-label','其他日子列表');list.setAttribute('tabindex','0');
      list.addEventListener('scroll',()=>{ctx.local.countdownScrollTop=list.scrollTop;},{passive:true});
      let toggle;
      const renderRows=()=>{
        list.replaceChildren();
        const expanded=limit===0||ctx.local.countdownExpanded===true;
        if(toggle){toggle.textContent=expanded?'收起':'查看全部（'+next.length+'）';toggle.setAttribute('aria-expanded',String(expanded));}
        for(const event of expanded?next:next.slice(0,limit)){
        const n=daysUntil(event.date),info=dateDetails(event.date),glyph=listIcon(event);
        const row=button(doc,'',()=>edit(event),{class:'hw-button hw-countdown-event','aria-label':(event.calendarEventId?'查看日历同步日期 ':'编辑日期 ')+event.title});
        const leading=element(doc,'span',{class:'hw-countdown-event-icon is-'+glyph},icon(doc,glyph));
        const text=element(doc,'span',{class:'hw-countdown-event-copy'},element(doc,'span',{class:'hw-countdown-event-title'},event.title),
          element(doc,'time',{class:'hw-countdown-event-date',datetime:event.date},`${info.year===year?'':info.year+'年'}${info.month}月${info.day}日 · ${info.weekday}`));
        if(event.calendarEventId)text.append(element(doc,'span',{class:'hw-countdown-source'},'日历同步'));
        const badge=element(doc,'span',{class:'hw-countdown-remaining'+(n>=0&&n<=1?' is-soon':'')});
        if(n===0||n===1)badge.append(n===0?'今天':'明天');
        else if(n<0)badge.append('已过 ',element(doc,'strong',{},Math.abs(n)),element(doc,'span',{},' 天'));
        else badge.append(element(doc,'strong',{},n),element(doc,'span',{},' 天'));
        row.append(leading,text,badge);
        list.append(element(doc,'div',{class:'hw-countdown-event-row'},row,pinButton(event),deleteButton(event)));
        }
      };
      if(limit>0&&next.length>limit){
        toggle=button(doc,'',()=>{ctx.local.countdownExpanded=ctx.local.countdownExpanded!==true;renderRows();},{class:'hw-button hw-text-button hw-countdown-list-toggle','aria-controls':listId});
        heading.append(toggle);
      }
      renderRows();
      ctx.el.append(list);
      list.scrollTop=ctx.local.countdownScrollTop||0;
    }
    ctx.lifetime.interval(()=>ctx.refresh(),60000);
  }
};
