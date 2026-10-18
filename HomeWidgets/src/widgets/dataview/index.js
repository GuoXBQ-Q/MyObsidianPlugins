module.exports={type:'dataview',label:'Dataview 查询',icon:'⌕',span:8,defaults:{query:'TABLE area AS 分类, status AS 状态\nFROM "Inbox/Ideas"\nWHERE type = "idea"\nSORT created DESC\nLIMIT 10'},
  fields:[{key:'query',label:'Dataview DQL 查询',type:'textarea',required:true}],watch:()=>['integrations'],
  mount:ctx=>ctx.services.integrations.renderDataview(ctx.config.query,ctx.el,ctx.lifetime,ctx.sourcePath)
};
