const {daysUntil}=require('./date');
const {assertFields}=require('../core/format');
function schema(data){
  if(data.countdowns===undefined)return {version:2,events:[]};
  const value=data.countdowns;
  if(!value||value.version!==2)throw new Error('倒计时 JSON 数据格式或版本不受支持，已保留原数据');
  assertFields(value,['version','events','calendarDisplay'],'倒计时配置');
  validate(value.events);
  return value;
}
function validate(events){
  if(!Array.isArray(events))throw new Error('倒计时 JSON 日期列表无效');
  const ids=new Set();
  for(const event of events){
    assertFields(event,['id','title','date','start','area','archived'],'日期记录');
    if(!event||typeof event.id!=='string'||!event.id.startsWith('event-')||ids.has(event.id)||typeof event.title!=='string'||!event.title.trim())throw new Error('日期记录或 ID 无效／重复，已保留原数据');
    ids.add(event.id);daysUntil(event.date);
    if(event.start){daysUntil(event.start);if(event.start>event.date)throw new Error('开始日期不能晚于目标日期');}
    if(event.area!==undefined&&typeof event.area!=='string')throw new Error('日期分类无效');
    if(event.archived!==undefined&&typeof event.archived!=='boolean')throw new Error('日期归档状态无效，已保留原数据');
  }
  return events;
}
function createPersistentEventService(data,bus){
  async function ensure(){
    const root=await data.read();schema(root);
    if(root.countdowns!==undefined)return;
    await data.update(latest=>{
      return latest.countdowns===undefined?{...latest,countdowns:schema(latest)}:latest;
    });
  }
  async function change(transform){
    await ensure();
    await data.update(root=>{
      const state=schema(root),events=validate(transform(state.events));
      return {...root,countdowns:{...state,events}};
    });
    bus?.emit('countdown');
  }
  function confirmed(events,event){
    const current=events.find(item=>item.id===event?.id);
    if(!current||['id','title','date','start','area','calendarEventId'].some(key=>(current[key]||'')!==(event[key]||''))||(current.archived??false)!==(event.archived??false))throw new Error('日期记录已变化，请刷新后重新确认');
    return current;
  }
  async function setArchived(event,archived){
    await change(events=>{
      const current=confirmed(events,event);
      if((current.archived===true)===archived)throw new Error('日期归档状态已变化，请刷新后重新确认');
      return events.map(item=>{
        if(item.id!==current.id)return item;
        const {archived:previous,...value}=item;
        return archived?{...value,archived:true}:value;
      });
    });
  }
  return {
    sourceStatus:async()=>null,
    canClearFeatured:async()=>true,
    async list(options={}){assertFields(options,['includeArchived'],'日期读取选项');await ensure();const events=schema(await data.read()).events;return options.includeArchived?events:events.filter(event=>!event.archived);},
    async save(value){
      const clean=text=>String(text||'').replace(/[\r\n]+/g,' ').trim();
      const title=clean(value.title);if(!title)throw new Error('请填写日期名称');
      daysUntil(value.date);if(value.start){daysUntil(value.start);if(value.start>value.date)throw new Error('开始日期不能晚于目标日期');}
      const item={id:value.id||'event-'+crypto.randomUUID(),title,date:value.date,start:value.start||'',area:clean(value.area)};
      await change(events=>{
        if(!value.id)return [...events,item];
        const current=events.find(event=>event.id===value.id);
        if(!current)throw new Error('日期记录已变化，请刷新后再编辑');
        if(current.archived)throw new Error('日期已归档，请先恢复后再编辑');
        return events.map(event=>event.id===value.id?item:event);
      });
    },
    async remove(event){
      await change(events=>{
        confirmed(events,event);
        return events.filter(item=>item.id!==event.id);
      });
    },
    archive:event=>setArchived(event,true),
    restore:event=>setArchived(event,false)
  };
}
module.exports={createPersistentEventService,schema,validate};
