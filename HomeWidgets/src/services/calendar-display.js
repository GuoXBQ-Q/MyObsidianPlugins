const {schema}=require('./persistent-events');
const {assertFields}=require('../core/format');
const {calendarId}=require('../../../shared/calendar-source');
function statesOf(state){
  if(state.calendarDisplay===undefined)return {};
  const display=state.calendarDisplay;assertFields(display,['version','states'],'日程展示状态');
  if(display.version!==1||!display.states||typeof display.states!=='object'||Array.isArray(display.states))throw new Error('日程展示状态格式不受支持');
  for(const [key,value] of Object.entries(display.states)){
    assertFields(value,['id','archived'],'日程展示条目');
    if(!key.startsWith('event-my-calendar-')||value.id!==undefined&&(typeof value.id!=='string'||!value.id.startsWith('event-'))||value.archived!==undefined&&typeof value.archived!=='boolean')throw new Error('日程展示状态无效');
  }
  return display.states;
}
function createCalendarDisplayStore(data){
  return {
    async read(){
      return {states:statesOf(schema(await data.read()))};
    },
    async reconcile(events,isCurrent=()=>true){
      const active=new Set(events.map(event=>calendarId(event.id)));
      const result=await data.update(root=>{
        if(!isCurrent())return root;
        const state=schema(root),saved=statesOf(state),states={};
        for(const [key,value] of Object.entries(saved))if(active.has(key))states[key]={...value};
        const next={...state};
        if(Object.keys(states).length)next.calendarDisplay={version:1,states};else delete next.calendarDisplay;
        if(root.countdowns===undefined&&!Object.keys(states).length)return root;
        return {...root,countdowns:next};
      });
      return statesOf(schema(result));
    },
    async archive(key,archived,isCurrent,expectedArchived){
      await data.update(root=>{
        if(!isCurrent())throw new Error('日程已变化，请刷新后重新确认');
        const state=schema(root),states={...statesOf(state)},value={...states[key]};
        if(!!value.archived!==!!expectedArchived)throw new Error('归档状态已变化，请刷新后重新确认');
        if(archived)value.archived=true;else delete value.archived;
        if(Object.keys(value).length)states[key]=value;else delete states[key];
        const next={...state};
        if(Object.keys(states).length)next.calendarDisplay={version:1,states};else delete next.calendarDisplay;
        return {...root,countdowns:next};
      });
    }
  };
}
module.exports={createCalendarDisplayStore};
