const {schema,validate}=require('./persistent-events');
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
      const root=await data.read(),state=schema(root),states=statesOf(state),legacy=[];
      for(const collection of Object.values(state.collections)){validate(collection.events);legacy.push(...collection.events.filter(event=>event.calendarEventId));}
      return {states,legacy};
    },
    async reconcile(events,isCurrent=()=>true){
      const active=new Set(events.map(event=>calendarId(event.id)));
      const result=await data.update(root=>{
        if(!isCurrent())return root;
        const state=schema(root),saved=statesOf(state),states={},collections={...state.collections},seen=new Set();
        for(const [key,value] of Object.entries(saved))if(active.has(key))states[key]={...value};
        for(const [name,collection] of Object.entries(state.collections)){
          validate(collection.events);
          for(const event of collection.events)if(event.calendarEventId){
            const key=calendarId(event.calendarEventId);
            if(seen.has(key))throw new Error('旧日程关联重复，转换已停止，原数据已保留');seen.add(key);
            if(active.has(key)&&!Object.hasOwn(saved,key)){
              const value={};if(event.id!==key)value.id=event.id;if(event.archived)value.archived=true;
              if(Object.keys(value).length)states[key]=value;
            }
          }
          collections[name]={...collection,events:collection.events.filter(event=>!event.calendarEventId)};
        }
        const next={...state,collections};
        if(Object.keys(states).length)next.calendarDisplay={version:1,states};else delete next.calendarDisplay;
        if(root.countdowns===undefined&&!Object.keys(collections).length&&!Object.keys(states).length)return root;
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
