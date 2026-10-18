const {element,button}=require('../../core/dom');
module.exports={type:'shortcuts',label:'快捷入口',icon:'↗',span:4,
  defaults:{links:[{label:'灵感收件箱',description:'把想法轻轻收好',path:'Home/灵感索引.md',icon:'◇'},{label:'全部待办',description:'一步一步，慢慢来',path:'Home/待办.md',icon:'☑'},{label:'插件指南',description:'微调每一个小组件',path:'HomeWidgets/README.md',icon:'▤'}]},
  fields:[{key:'links',label:'入口列表（JSON：label、description、path、icon）',type:'json'}],
  mount(ctx){if(!Array.isArray(ctx.config.links))throw new Error('links 必须为列表');const grid=element(ctx.doc,'div',{class:'hw-shortcuts'});
    for(const link of ctx.config.links){const b=button(ctx.doc,'',()=>ctx.run(()=>ctx.services.io.open(link.path)),{class:'hw-button hw-shortcut'});b.append(element(ctx.doc,'span',{'aria-hidden':'true'},link.icon||'↗'),element(ctx.doc,'strong',{},link.label),element(ctx.doc,'small',{},link.description||''));grid.append(b);}ctx.el.append(grid);
  }
};
