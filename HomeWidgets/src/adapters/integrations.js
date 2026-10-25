// All optional plugin API lookups live here. Widgets never access app.plugins.
function createIntegrations(app,{Component,MarkdownRenderer,Scope}) {
  const plugin=id=>app.plugins?.plugins?.[id];
  const own=life=>{const component=new Component();component.load();life.own(()=>component.unload());return component;};
  function requirePlugin(id,name){const value=plugin(id);if(!value)throw new Error('需要启用 '+name+' 插件；其他组件不受影响');return value;}
  async function markdown(text,el,life,source){const child=own(life);await MarkdownRenderer.render(app,text,el,source,child);}
  return {
    bindSaveShortcut(root,handle,life){
      if(!Scope||!app.keymap)return;
      const scope=new Scope(app.scope),doc=root.ownerDocument;let active=false;
      const activate=()=>{if(!active&&!life.signal.aborted){active=true;app.keymap.pushScope(scope);}};
      const deactivate=()=>{if(active){active=false;app.keymap.popScope(scope);}};
      // Explicit Ctrl and Meta support the same hint on every desktop platform.
      const keys=['Ctrl','Meta'].map(modifier=>scope.register([modifier],'Enter',event=>handle(event)?false:true));
      life.listen(root,'focusin',activate);
      life.listen(root,'focusout',()=>queueMicrotask(()=>{if(!root.contains(doc.activeElement))deactivate();}));
      if(root.contains(doc.activeElement))activate();
      life.own(()=>{deactivate();for(const key of keys)scope.unregister(key);});
    },
    status:()=>({tasks:!!plugin('obsidian-tasks-plugin'),quickadd:!!plugin('quickadd')?.api}),
    renderMarkdown:markdown,
    taskTransform(){const api=plugin('obsidian-tasks-plugin')?.apiV1;return typeof api?.executeToggleTaskDoneCommand==='function'?(line,path)=>api.executeToggleTaskDoneCommand(line,path):null;},
    async quickAdd(choice,variables){const api=requirePlugin('quickadd','QuickAdd').api;if(typeof api?.executeChoice!=='function')throw new Error('QuickAdd API 不可用');await api.executeChoice(choice,variables);},
    async command(id){if(!id||!app.commands?.executeCommandById(id))throw new Error('找不到命令：'+id);}
  };
}
module.exports={createIntegrations};
