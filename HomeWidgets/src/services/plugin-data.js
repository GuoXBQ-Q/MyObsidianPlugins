const clone=value=>JSON.parse(JSON.stringify(value));
const {assertFields}=require('../core/format');
function validateRoot(value){
  assertFields(value,['homeFile','countdowns'],'插件 JSON');
  if(value.homeFile!==undefined&&typeof value.homeFile!=='string')throw new Error('首页笔记路径必须为文字');
  return value;
}
function createPluginDataStore({load,save}){
  let state,loading,queue=Promise.resolve();
  async function initialize(){
    if(!loading)loading=Promise.resolve().then(load).then(value=>{
      state=clone(validateRoot(value??{}));
    });
    await loading;
  }
  return {
    async read(){await initialize();await queue.catch(()=>{});return clone(state);},
    update(transform){
      const job=queue.catch(()=>{}).then(async()=>{
        await initialize();const next=await transform(clone(state));
        validateRoot(next);
        if(JSON.stringify(next)!==JSON.stringify(state)){await save(clone(next));state=clone(next);}
        return clone(state);
      });queue=job;return job;
    }
  };
}
module.exports={createPluginDataStore};
