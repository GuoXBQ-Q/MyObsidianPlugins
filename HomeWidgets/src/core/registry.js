const {assertFields}=require('./format');
class WidgetRegistry {
  constructor() { this.types = new Map(); this.sources = new Map(); }
  register(definition,source={kind:'builtin'}) {
    assertFields(definition,['type','label','subtitle','icon','span','frameless','frame','defaults','fields','watch','deferRender','mount','supportsMultipleInstances'],'组件定义');
    if(definition.supportsMultipleInstances!==undefined&&typeof definition.supportsMultipleInstances!=='boolean')throw new Error('组件 supportsMultipleInstances 必须为布尔值');
    if(definition.deferRender!==undefined&&typeof definition.deferRender!=='boolean')throw new Error('组件 deferRender 必须为布尔值');
    if(definition.frame!==undefined&&!['card','none'].includes(definition.frame))throw new Error('组件 frame 必须为 card 或 none');
    for(const field of definition.fields||[])assertFields(field,['key','label','type','required','min','max','options','dependsOn','help','default'],'组件字段');
    if (!/^[a-z][a-z0-9-]*$/.test(definition.type) || typeof definition.mount !== 'function') throw new Error('组件必须有合法 type 和 mount(context)');
    if (this.types.has(definition.type)) throw new Error('组件类型重复：' + definition.type);
    this.types.set(definition.type, definition);
    this.sources.set(definition.type,Object.freeze({...source}));
    let active=true;
    return () => { if(!active)return;active=false;if(this.types.get(definition.type)===definition){this.sources.delete(definition.type);this.types.delete(definition.type);} };
  }
  get(type) { return this.types.get(type); }
  source(type) { return this.sources.get(type); }
  list() { return [...this.types.values()]; }
}
module.exports = { WidgetRegistry };
