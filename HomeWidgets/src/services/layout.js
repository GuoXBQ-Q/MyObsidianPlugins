const DEFAULT_PATH='Home/widgets.json';
const {moveToTarget}=require('../core/drag-layout');
const {validateTypography}=require('../core/typography');
const {cssClasses}=require('../core/appearance');
const {taskScope,commitCategoryRemoval}=require('./task-category-removal');
const {parseTasks}=require('./tasks');
const {assertFields}=require('../core/format');
function validateLayout(value) {
  assertFields(value,['version','theme','widgets','typography','maxWidth'],'布局');
  if(value.version!==2||!Array.isArray(value.widgets))throw new Error('Home Widgets 布局格式不正确，需要 version: 2');
  if(!['lavender','rose','sage','native'].includes(value.theme))throw new Error('未知主题');
  validateTypography(value.typography);
  if(value.maxWidth!==undefined&&value.maxWidth!=='full'&&(typeof value.maxWidth!=='number'||!Number.isInteger(value.maxWidth)||value.maxWidth<640||value.maxWidth>7680))throw new Error('页面宽度应为 640–7680 的整数或 "full"');
  const ids=new Set();
  for(const item of value.widgets){assertFields(item,['id','type','title','span','hidden','tint','background','height','cssClasses','settings'],'组件实例');cssClasses(item.cssClasses);}
  for(const item of value.widgets){if(!/^[\w-]+$/.test(item.id)||ids.has(item.id))throw new Error('组件实例 ID 无效或重复');ids.add(item.id);if(typeof item.type!=='string'||!item.type)throw new Error('组件缺少类型');if(!Number.isInteger(item.span)||item.span<1||item.span>12)throw new Error('组件宽度应为 1–12');if(item.height!==undefined&&(!Number.isInteger(item.height)||item.height<80||item.height>2000))throw new Error('组件固定高度应为 80–2000 的整数，留空则自适应内容');if(item.settings!==undefined&&(typeof item.settings!=='object'||item.settings===null||Array.isArray(item.settings)))throw new Error('组件 settings 必须为对象');}
  return value;
}
// Keep unrelated settings changed by another view; never overwrite conflicting edits.
function mergeLayoutDraft(base,draft,current){
  const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
  function merge(before,edited,latest){
    if(same(before,edited))return latest;
    if(same(before,latest)||same(edited,latest))return edited;
    if([before,edited,latest].every(value=>value&&typeof value==='object'&&!Array.isArray(value))){
      const result={};
      for(const key of new Set([...Object.keys(before),...Object.keys(edited),...Object.keys(latest)])){
        const value=merge(before[key],edited[key],latest[key]);if(value!==undefined)result[key]=value;
      }
      return result;
    }
    throw new Error('布局已在其他位置修改，无法覆盖冲突。请继续编辑，或选择不保存退出后重新调整。');
  }
  return validateLayout(merge(base,draft,current));
}
function createLayoutStore(io,bus,path=DEFAULT_PATH) {
  async function load(){return validateLayout(JSON.parse(await io.read(path)));}
  async function change(fn,plans=[]){
    const update=text=>JSON.stringify(validateLayout(fn(JSON.parse(text))),null,2)+'\n';
    if(plans.length)await commitCategoryRemoval(io,path,update,plans);else await io.update(path,update);
    bus.emit('layout:'+path);
  }
  return {path,load,
    saveDraft:(base,draft,plans=[])=>change(current=>mergeLayoutDraft(base,draft,current),plans),
    async describeTaskRemoval(id,layout){
      layout=layout||await load();const item=layout.widgets.find(w=>w.id===id);
      if(!item||item.type!=='tasks')throw new Error('待办组件已变化，请刷新后重试');
      const {source,area}=taskScope(item);if(source===path)throw new Error('待办源文件不能是布局文件');
      const snapshot=await io.read(source),count=parseTasks(snapshot,source).filter(t=>t.area===area).length;
      const peers=layout.widgets.filter(w=>w.id!==id&&w.type==='tasks').filter(w=>{const scope=taskScope(w);return scope.source===source&&scope.area===area;}).map(w=>w.title||w.id);
      return {source,area,snapshot,count,peers};
    },
    async initialize(){if(await io.exists(path))return load();const next={version:2,theme:'native',widgets:[]};await io.create(path,JSON.stringify(next,null,2)+'\n');return next;},
    patchWidget:(id,patch)=>change(data=>({...data,widgets:data.widgets.map(w=>w.id===id?{...w,...patch,settings:patch.settings?{...w.settings,...patch.settings}:w.settings}:w)})),
    patchSettings:(id,patch)=>change(data=>({...data,widgets:data.widgets.map(w=>w.id===id?{...w,settings:{...w.settings,...(typeof patch==='function'?patch(w.settings||{}):patch)}}:w)})),
    add:widget=>change(data=>({...data,widgets:[...data.widgets,widget]})),
    remove:(id,plan)=>change(data=>{
      const item=data.widgets.find(w=>w.id===id);
      if(plan){
        if(!item||item.type!=='tasks')throw new Error('待办组件已变化，请重新确认删除');
        const scope=taskScope(item);if(scope.source!==plan.source||scope.area!==plan.area)throw new Error('待办组件分类已变化，请重新确认删除');
      }
      return {...data,widgets:data.widgets.filter(w=>w.id!==id)};
    },plan?[plan]:[]),
    move:(id,offset)=>change(data=>{const widgets=[...data.widgets],from=widgets.findIndex(w=>w.id===id),to=from+offset;if(from<0||to<0||to>=widgets.length)return data;[widgets[from],widgets[to]]=[widgets[to],widgets[from]];return {...data,widgets};}),
    before:(from,to)=>change(data=>{if(from===to)return data;const item=data.widgets.find(w=>w.id===from);if(!item||!data.widgets.some(w=>w.id===to))return data;const widgets=data.widgets.filter(w=>w.id!==from);widgets.splice(widgets.findIndex(w=>w.id===to),0,item);return {...data,widgets};}),
    place:(from,to)=>change(data=>({...data,widgets:moveToTarget(data.widgets,from,to)})),
    theme:theme=>change(data=>({...data,theme})),
    page:patch=>change(data=>({...data,...patch})),
    typography:patch=>change(data=>({...data,typography:{...data.typography,...patch}})),
    subscribe:fn=>bus.on('layout:'+path,fn)
  };
}
module.exports={DEFAULT_PATH,validateLayout,createLayoutStore,mergeLayoutDraft};
