const {element}=require('../../core/dom');
const {icon}=require('../../core/icons');
const {createSelect}=require('../../core/select');
const {calendarRange,dateKey}=require('../../services/activity');
module.exports={
  type:'heatmap',label:'活动热力图',icon:doc=>icon(doc,'calendar'),span:6,
  defaults:{source:'notes',view:'weeks',noteFolder:'',taskSource:'Home/待办.md'},
  fields:[
    {key:'source',label:'默认统计内容',type:'select',options:[['notes','笔记活动'],['tasks','任务完成']]},
    {key:'view',label:'显示范围',type:'select',options:[['weeks','近 13 周'],['month','本月']]},
    {key:'noteFolder',label:'笔记目录（留空统计整个知识库）'},
    {key:'taskSource',label:'待办笔记路径',help:'按 ✅ YYYY-MM-DD 或 [completion:: YYYY-MM-DD] 统计；缺少完成日期的任务不计入'}
  ],
  watch:()=>['folder:','activity-sources'],
  async mount(ctx){
    const {doc,config,services,signal,lifetime}=ctx,activity=services.activity;
    if(ctx.local.defaultSource!==config.source){delete ctx.local.source;ctx.local.defaultSource=config.source;}
    const available=activity.list().map(s=>s.id),source=available.includes(ctx.local.source)?ctx.local.source:config.source;
    const options=activity.list().map(source=>[source.id,source.label]);
    if(!available.includes(source))options.push([source,'数据源不可用']);
    const picker=createSelect(doc,{label:'热力图统计内容',options,value:source}),select=picker.input;
    picker.root.classList.add('hw-heatmap-source');
    picker.root.querySelector('button').setAttribute('aria-label','热力图统计内容');
    ctx.actions.append(picker.root);lifetime.own(()=>picker.dispose());
    const content=element(doc,'div',{class:'hw-heatmap'});ctx.el.append(content);let request=0;
    async function render(){
      const current=++request,range=calendarRange(config.view),now=range.end;
      select.setAttribute('aria-busy','true');
      try{
        const result=await activity.query(select.value,config,range,signal);if(signal.aborted||current!==request)return;
        content.replaceChildren();const {days,source,note}=result;let active=0,total=0;for(const value of days.values()){total+=value;if(value>0)active++;}
        const stats=element(doc,'div',{class:'hw-heatmap-stats','aria-live':'polite'},
          element(doc,'span',{},element(doc,'strong',{},active),' 活跃天数'),element(doc,'span',{},element(doc,'strong',{},total),' '+source.unit));
        const period=element(doc,'div',{class:'hw-heatmap-period'},element(doc,'span',{},config.view==='month'?now.slice(0,7).replace('-',' 年 ')+' 月':range.start.replaceAll('-','.')+' — '+now.replaceAll('-','.')),element(doc,'span',{},config.view==='month'?'本月':'近 13 周'));
        const monthly=config.view==='month',chart=element(doc,'div',{class:'hw-heatmap-chart'+(monthly?' is-month':'')}),grid=element(doc,'div',{class:'hw-heatmap-grid','aria-label':source.label+'日历'});
        chart.style.setProperty('--hw-heatmap-rows',String(monthly?Math.ceil(range.cells.length/7):7));
        if(monthly){const weekdays=element(doc,'div',{class:'hw-heatmap-weekdays'});for(const day of ['一','二','三','四','五','六','日'])weekdays.append(element(doc,'span',{},day));chart.append(weekdays);}
        else{const labels=element(doc,'div',{class:'hw-heatmap-y','aria-hidden':'true'});for(const day of ['一','','三','','五','','日'])labels.append(element(doc,'span',{},day));chart.append(labels);}
        for(const date of range.cells){
          if(!date){grid.append(element(doc,'span'));continue;}
          const future=date>now,value=days.get(date)||0,level=value===0?0:value<=2?1:value<=4?2:value<=6?3:4;
          const label=date+' · '+(future?'尚未到来':value+' '+source.unit);
          const cell=element(doc,'button',{type:'button',class:'hw-heatmap-cell'+(future?' is-future':''),'data-level':level,'aria-label':label},monthly?Number(date.slice(-2)):'');
          // Native title supplies the same hover detail in the browser preview.
          if(ctx.platform.preview)cell.setAttribute('title',label);if(future)cell.disabled=true;
          grid.append(cell);
        }
        chart.append(grid);
        const legend=element(doc,'div',{class:'hw-heatmap-legend'},element(doc,'span',{},'0'));
        for(let i=0;i<5;i++)legend.append(element(doc,'span',{class:'hw-heatmap-swatch','data-level':i,'aria-hidden':'true'}));
        legend.append(element(doc,'span',{},'7+ '+source.legend));
        if(note)legend.prepend(element(doc,'span',{class:'hw-heatmap-note','aria-label':note,title:ctx.platform.preview?note:undefined},'ⓘ'));
        content.append(stats,period,chart,legend);
      }catch(error){if(!signal.aborted&&current===request)content.replaceChildren(element(doc,'p',{class:'hw-empty',role:'status'},error.message));}
      finally{if(!signal.aborted&&current===request)select.removeAttribute('aria-busy');}
    }
    lifetime.listen(select,'change',()=>{ctx.local.source=select.value;render();});
    let today=dateKey();lifetime.interval(()=>{const next=dateKey();if(next!==today){today=next;render();}},60000);
    await render();
  }
};
