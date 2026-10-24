const {checkedCollection}=require('./persistent-events');
function createCountdownService(independent,calendar){
  return {
    async list(source,options){
      const key=checkedCollection(source),items=[...await independent.list(key,options),...await calendar.list(key,options)];
      if(new Set(items.map(item=>item.id)).size!==items.length)throw new Error('独立倒计时与日程展示 ID 冲突，已保留数据');
      return items;
    },
    save:(source,value)=>independent.save(source,value),
    remove:(source,event)=>independent.remove(source,event),
    archive:(source,event)=>event.calendarEventId?calendar.archive(checkedCollection(source),event,true):independent.archive(source,event),
    restore:(source,event)=>event.calendarEventId?calendar.archive(checkedCollection(source),event,false):independent.restore(source,event),
    sourceStatus:()=>calendar.sourceStatus(),
    async canClearFeatured(id){if(!await calendar.isSourceId(id))return true;return (await calendar.sourceStatus())?.state==='connected';}
  };
}
module.exports={createCountdownService};
