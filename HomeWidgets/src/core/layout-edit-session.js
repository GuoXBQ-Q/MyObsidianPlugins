const {Bus}=require('./lifecycle');
const {createLayoutStore}=require('../services/layout');
const clone=value=>JSON.parse(JSON.stringify(value));
// The host uses this facade so drag, resize and configuration share one draft.
function createLayoutEditSession(persisted){
  const bus=new Bus(),removals=new Map();let base=null,draft=null,tail=Promise.resolve(),disposed=false;
  const changed=()=>bus.emit('draft');
  const memory=createLayoutStore({
    read:async()=>JSON.stringify(draft),
    update:async(path,transform)=>{draft=JSON.parse(transform(JSON.stringify(draft)));}
  },bus,persisted.path);
  const enqueue=fn=>{const job=tail.catch(()=>{}).then(()=>{if(disposed)throw new Error('首页已关闭');return fn();});tail=job;return job;};
  const session={path:persisted.path,
    load:async()=>draft?clone(draft):persisted.load(),
    subscribe:fn=>{const off=[persisted.subscribe(fn),memory.subscribe(fn),bus.on('draft',fn)];return ()=>off.forEach(f=>f());},
    begin:()=>enqueue(async()=>{if(draft)return;base=clone(await persisted.load());draft=clone(base);changed();}),
    commit:()=>enqueue(async()=>{if(!draft)return;await persisted.saveDraft(base,draft,[...removals.values()]);base=null;draft=null;removals.clear();changed();}),
    discard:()=>enqueue(()=>{base=null;draft=null;removals.clear();changed();}),
    describeTaskRemoval:id=>enqueue(()=>persisted.describeTaskRemoval(id,draft?clone(draft):undefined)),
    remove:(id,plan)=>enqueue(async()=>{await (draft?memory:persisted).remove(id,draft?undefined:plan);if(draft&&plan)removals.set(id,clone(plan));}),
    // Completion changes are saved immediately, even while the layout is a draft.
    // Sanitize base and draft as well so discarding/merging cannot resurrect old hides.
    clearTaskHidden:(source,ids)=>enqueue(async()=>{
      await persisted.clearTaskHidden(source,ids);
      if(draft){
        const keys=new Set(ids.map(id=>JSON.stringify([source,id])));
        for(const data of [base,draft])for(const item of data.widgets)if(item.type==='tasks'&&Array.isArray(item.settings?.hiddenTaskKeys))item.settings.hiddenTaskKeys=item.settings.hiddenTaskKeys.filter(key=>!keys.has(key));
        changed();
      }
    }),
    dispose:()=>{disposed=true;base=null;draft=null;removals.clear();},
    get active(){return draft!==null;}
  };
  for(const name of ['patchWidget','patchSettings','add','move','before','place','theme','page','typography']){
    session[name]=(...args)=>enqueue(()=>(draft?memory:persisted)[name](...args));
  }
  return session;
}
module.exports={createLayoutEditSession};
