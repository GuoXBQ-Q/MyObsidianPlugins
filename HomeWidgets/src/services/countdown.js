function createCountdownService(independent,calendar){
  return {
    async list(options){
      const items=[...await independent.list(options),...await calendar.list(options)];
      if(new Set(items.map(item=>item.id)).size!==items.length)throw new Error('独立倒计时与日程展示 ID 冲突，已保留数据');
      return items;
    },
    save:value=>independent.save(value),
    remove:event=>{if(event.calendarEventId)throw new Error('请在 MyCalendar 中删除日程');return independent.remove(event);},
    archive:event=>event.calendarEventId?calendar.archive(event,true):independent.archive(event),
    restore:event=>event.calendarEventId?calendar.archive(event,false):independent.restore(event),
    sourceStatus:()=>calendar.sourceStatus(),
    async canClearFeatured(id){if(!await calendar.isSourceId(id))return true;return (await calendar.sourceStatus())?.state==='connected';}
  };
}
module.exports={createCountdownService};
