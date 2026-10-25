const CALENDAR_SOURCE_VERSION=2;
const calendarId=id=>'event-my-calendar-'+id;
function readCalendarSnapshot(value){
  const fields=(value,allowed)=>{if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>!allowed.includes(key)))throw new Error('日程快照格式不受支持');};
  fields(value,['revision','events']);
  if(!Number.isSafeInteger(value.revision)||value.revision<0||!Array.isArray(value.events))throw new Error('日程快照格式不受支持');
  const ids=new Set();
  const events=value.events.map(event=>{
    fields(event,['id','title','date']);
    if(typeof event.id!=='string'||!event.id.trim()||ids.has(event.id)||typeof event.title!=='string'||!event.title.trim())throw new Error('日程快照 ID 或标题无效');
    if(typeof event.date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(event.date))throw new Error('日程快照日期无效');
    const [y,m,d]=event.date.split('-').map(Number),date=new Date(Date.UTC(y,m-1,d));
    if(date.getUTCFullYear()!==y||date.getUTCMonth()!==m-1||date.getUTCDate()!==d)throw new Error('日程快照日期无效');
    ids.add(event.id);return {id:event.id,title:event.title.trim(),date:event.date};
  });
  return {revision:value.revision,events};
}
module.exports={CALENDAR_SOURCE_VERSION,calendarId,readCalendarSnapshot};
