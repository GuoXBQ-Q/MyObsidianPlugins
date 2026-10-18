const {parseTasks}=require('./tasks');
const {assertFields}=require('../core/format');
function dateKey(date=new Date()) {return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;}
function validDate(value){if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;const d=new Date(value+'T12:00:00');return Number.isFinite(d.getTime())&&dateKey(d)===value;}
function calendarRange(view='weeks',today=new Date()){
  const end=new Date(today.getFullYear(),today.getMonth(),today.getDate(),12),start=new Date(end),cells=[];
  if(view==='month'){start.setDate(1);const offset=(start.getDay()+6)%7;for(let i=0;i<offset;i++)cells.push(null);}
  else start.setDate(start.getDate()-(start.getDay()+6)%7-84);
  const last=view==='month'?new Date(end.getFullYear(),end.getMonth()+1,0,12):new Date(start.getFullYear(),start.getMonth(),start.getDate()+90,12);
  for(let d=new Date(start);d<=last;d.setDate(d.getDate()+1))cells.push(dateKey(d));
  return {start:dateKey(start),end:dateKey(end),cells};
}
function createActivityService(io,bus){
  const sources=new Map();
  function registerSource(source){
    assertFields(source,['id','label','unit','legend','load'],'活动数据源');
    if(!source||!source.id||typeof source.load!=='function'||!source.label||!source.unit)throw new Error('活动数据源需要 id、label、unit 和 load');
    if(sources.has(source.id))throw new Error('活动数据源重复：'+source.id);
    sources.set(source.id,{...source});bus?.emit('activity-sources');let active=true;
    return ()=>{if(!active)return;active=false;sources.delete(source.id);bus?.emit('activity-sources');};
  }
  registerSource({id:'notes',label:'笔记活动',unit:'篇新笔记',legend:'篇 / 天',async load({config,signal}){
    const files=await io.notes(config.noteFolder||'');if(signal?.aborted)return {values:[]};
    return {values:files.filter(f=>Number.isFinite(f.ctime)&&f.ctime>0).map(f=>({date:dateKey(new Date(f.ctime)),value:1}))};
  }});
  registerSource({id:'tasks',label:'任务完成',unit:'项已完成',legend:'项 / 天',async load({config,signal}){
    const source=config.taskSource||'Home/待办.md';if(!await io.exists(source))return {values:[],note:'待办笔记不存在，请在组件设置中选择来源'};
    const text=await io.read(source);if(signal?.aborted)return {values:[]};let undated=0;const values=[];
    for(const task of parseTasks(text,source)){
      if(!task.done)continue;
      const date=task.raw.match(/(?:✅\s*|\[completion::\s*)(\d{4}-\d{2}-\d{2})/)?.[1];
      if(!validDate(date)){undated++;continue;}values.push({date,value:1});
    }
    return {values,note:undated?`${undated} 项已完成任务缺少有效完成日期，未计入热力图`:''};
  }});
  return {
    registerSource,
    list:()=>[...sources.values()].map(({id,label,unit,legend})=>({id,label,unit,legend})),
    async query(id,config,range,signal){
      const source=sources.get(id);if(!source)throw new Error('统计数据源暂不可用，请切换其他数据源');
      const result=await source.load({io,config,start:range.start,end:range.end,signal}),days=new Map();
      assertFields(result,['values','note'],'活动数据结果');if(!Array.isArray(result.values))throw new Error('活动数据结果必须包含 values 数组');
      for(const item of result.values){assertFields(item,['date','value'],'活动记录');if(!validDate(item.date)||item.date<range.start||item.date>range.end||!Number.isFinite(item.value)||item.value<0)continue;days.set(item.date,(days.get(item.date)||0)+item.value);}
      return {days,note:result.note||'',source:{id:source.id,label:source.label,unit:source.unit,legend:source.legend||source.unit+' / 天'}};
    }
  };
}
module.exports={dateKey,validDate,calendarRange,createActivityService};
