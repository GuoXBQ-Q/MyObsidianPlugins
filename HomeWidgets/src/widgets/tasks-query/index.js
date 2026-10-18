module.exports={type:'tasks-query',label:'Tasks 查询',icon:'☑',span:8,defaults:{query:'not done\ntags include #area/work\nsort by due\nlimit 20'},
  fields:[{key:'query',label:'Tasks 查询（由 Tasks 插件渲染）',type:'textarea',required:true}],watch:()=>['integrations'],
  mount:ctx=>ctx.services.integrations.renderTasks(ctx.config.query,ctx.el,ctx.lifetime,ctx.sourcePath)
};
