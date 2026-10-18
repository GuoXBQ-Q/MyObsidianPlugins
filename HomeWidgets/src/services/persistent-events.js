const {daysUntil}=require('./date');
const {assertFields}=require('../core/format');
function collectionKey(source='default'){return String(source??'default').trim();}
function schema(data){
  if(data.countdowns===undefined)return {version:1,collections:{}};
  const value=data.countdowns;
  assertFields(value,['version','collections'],'倒计时配置');
  if(!value||value.version!==1||!value.collections||typeof value.collections!=='object'||Array.isArray(value.collections))throw new Error('倒计时 JSON 数据格式或版本不受支持，已保留原数据');
  for(const collection of Object.values(value.collections))assertFields(collection,['events'],'日期集合');
  return value;
}
function validate(events){
  if(!Array.isArray(events))throw new Error('倒计时 JSON 日期列表无效');
  const ids=new Set();
  for(const event of events){
    assertFields(event,['id','title','date','start','area'],'日期记录');
    if(!event||typeof event.id!=='string'||!event.id.startsWith('event-')||ids.has(event.id)||typeof event.title!=='string'||!event.title.trim())throw new Error('日期记录或 ID 无效／重复，已保留原数据');
    ids.add(event.id);daysUntil(event.date);
    if(event.start){daysUntil(event.start);if(event.start>event.date)throw new Error('开始日期不能晚于目标日期');}
    if(event.area!==undefined&&typeof event.area!=='string')throw new Error('日期分类无效');
  }
  return events;
}
function createPersistentEventService(data,bus){
  async function ensure(source){
    const key=collectionKey(source);
    if(!key||/[\\/]/.test(key)||/\.md$/i.test(key))throw new Error('日期集合请填写名称（例如 default），不再支持笔记路径');
    const root=await data.read(),current=schema(root);
    if(Object.hasOwn(current.collections,key)){validate(current.collections[key]?.events);return key;}
    await data.update(latest=>{
      const state=schema(latest);if(Object.hasOwn(state.collections,key))return latest;
      return {...latest,countdowns:{...state,collections:{...state.collections,[key]:{events:[]}}}};
    });
    return key;
  }
  async function change(source,transform){
    const key=await ensure(source);
    await data.update(root=>{
      const state=schema(root),collection=state.collections[key];validate(collection.events);
      const events=validate(transform(collection.events));
      return {...root,countdowns:{...state,collections:{...state.collections,[key]:{...collection,events}}}};
    });
    bus?.emit('countdown:'+key);
  }
  return {
    async list(source){const key=await ensure(source),root=await data.read();return validate(schema(root).collections[key].events);},
    async save(source,value){
      const clean=text=>String(text||'').replace(/[\r\n]+/g,' ').trim();
      const title=clean(value.title);if(!title)throw new Error('请填写日期名称');
      daysUntil(value.date);if(value.start){daysUntil(value.start);if(value.start>value.date)throw new Error('开始日期不能晚于目标日期');}
      const item={id:value.id||'event-'+crypto.randomUUID(),title,date:value.date,start:value.start||'',area:clean(value.area)};
      await change(source,events=>{
        if(!value.id)return [...events,item];
        if(!events.some(event=>event.id===value.id))throw new Error('日期记录已变化，请刷新后再编辑');
        return events.map(event=>event.id===value.id?item:event);
      });
    },
    async remove(source,event){
      await change(source,events=>{
        const current=events.find(item=>item.id===event?.id);
        if(!current||['id','title','date','start','area'].some(key=>(current[key]||'')!==(event[key]||'')))throw new Error('日期记录已变化，请刷新后重新确认删除');
        return events.filter(item=>item.id!==event.id);
      });
    }
  };
}
module.exports={createPersistentEventService,collectionKey};
