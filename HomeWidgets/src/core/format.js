function assertFields(value,allowed,label){
  if(!value||typeof value!=='object'||Array.isArray(value))throw new Error(label+'必须为对象');
  for(const key of Object.keys(value))if(!allowed.includes(key))throw new Error(label+'字段不受支持：'+key);
}
module.exports={assertFields};
