const {CALENDAR_SOURCE_VERSION,calendarId,readCalendarSnapshot}=require('../../../shared/calendar-source');
function createCalendarAdapter({resolve,display,bus,registerWidget=()=>()=>{},setTimer=setInterval,clearTimer=clearInterval}){
  let alive=true,source=null,cleanups=[],records=[],state='disconnected',message='日程来源未连接',everConnected=false;
  let generation=0,requested=false,running=null,timer,lastRevision=-1;
  const notify=()=>bus.emit('calendar-source');
  function status(next,text){const changed=state!==next||message!==text;state=next;message=text;if(changed)notify();}
  function detach(){generation++;for(const cleanup of cleanups.splice(0).reverse())try{cleanup();}catch{}source=null;lastRevision=-1;}
  function current(){if(!alive)return null;return resolve();}
  function check(){
    if(!alive)return;
    let candidate;
    try{candidate=current();}catch(error){detach();status('error','日程来源读取失败：'+error.message);return;}
    if(candidate?.source===source&&source){if(state==='error')void refresh();return;}
    detach();
    if(!candidate?.source){status('disconnected','日程来源未连接');return;}
    const api=candidate.source;
    if(api.version!==CALENDAR_SOURCE_VERSION||['getSnapshot','subscribe','registerDisplayCapability'].some(key=>typeof api[key]!=='function')){status('error','日程来源接口版本不支持');return;}
    try{
      source=api;
      cleanups.push(api.subscribe(()=>{if(current()?.source!==api)check();else void refresh();}));
      cleanups.push(api.registerDisplayCapability());
      if(candidate.widget)cleanups.push(registerWidget(candidate.widget));
      everConnected=true;status('loading','正在读取日程来源');void refresh();
    }catch(error){detach();status('error','日程来源连接失败：'+error.message);}
  }
  function refresh(){
    if(!alive||!source)return Promise.resolve();
    generation++;requested=true;
    if(!running)running=Promise.resolve().then(async()=>{
      while(requested&&alive&&source){
        requested=false;const token=generation,api=source;
        const valid=()=>alive&&source===api&&generation===token&&current()?.source===api;
        try{
          const snapshot=readCalendarSnapshot(await api.getSnapshot());
          if(!valid())continue;
          if(snapshot.revision<lastRevision)throw new Error('日程来源返回过期快照');
          const {legacy}=await display.read();let displayError;
          try{await display.reconcile(snapshot.events,valid);}
          catch(error){
            // Conversion must commit before copied IDs/archive state can be used.
            // Later metadata cleanup failures must not keep deleted source dates visible.
            if(legacy.length)throw error;displayError=error;
          }
          if(!valid())continue;
          const before=records;records=snapshot.events;lastRevision=snapshot.revision;
          status(displayError?'error':'connected',displayError?'日程展示状态保存失败：'+displayError.message:'');
          const changed=new Set([...before,...records].map(event=>event.collection));
          for(const collection of changed)if(JSON.stringify(before.filter(event=>event.collection===collection))!==JSON.stringify(records.filter(event=>event.collection===collection)))bus.emit('countdown:'+collection);
        }catch(error){if(valid())status('error','日程来源读取或展示状态保存失败：'+error.message);}
      }
    }).finally(()=>{running=null;if(requested&&alive&&source)void refresh();});
    return running;
  }
  return {
    start(){if(timer!==undefined)return;check();timer=setTimer(check,1000);},
    check,refresh,
    async list(collection,{includeArchived=false}={}){
      const {states}=await display.read();
      return records.filter(event=>event.collection===collection).map(event=>{
        const key=calendarId(event.id),saved=states[key]||{};
        return {id:saved.id||key,title:event.title,date:event.date,start:'',area:'',calendarEventId:event.id,...(saved.archived?{archived:true}:{})};
      }).filter(event=>includeArchived||!event.archived);
    },
    async sourceStatus(){const {states,legacy}=await display.read();return everConnected||legacy.length||Object.keys(states).length?{state,message}:null;},
    async isSourceId(id){const {states,legacy}=await display.read();return id.startsWith('event-my-calendar-')||Object.values(states).some(value=>value.id===id)||legacy.some(event=>event.id===id);},
    async archive(collection,event,archived){
      const matches=await this.list(collection,{includeArchived:true}),found=matches.find(value=>value.id===event.id);
      if(!found||JSON.stringify(found)!==JSON.stringify(event))throw new Error('日程已变化，请刷新后重新确认');
      const record=records.find(value=>value.id===event.calendarEventId),key=calendarId(event.calendarEventId);
      await display.archive(key,archived,()=>alive&&records.some(value=>JSON.stringify(value)===JSON.stringify(record)),event.archived);bus.emit('countdown:'+collection);
    },
    dispose(){if(!alive)return;alive=false;clearTimer(timer);detach();state='disconnected';message='日程来源未连接';notify();}
  };
}
module.exports={createCalendarAdapter};
