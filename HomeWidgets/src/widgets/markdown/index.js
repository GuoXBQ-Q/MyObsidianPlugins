module.exports={type:'markdown',label:'Markdown / 笔记嵌入',icon:'▤',span:6,defaults:{source:'',content:'写下一句今天想记住的话。'},
  fields:[{key:'source',label:'嵌入笔记路径（可选）'},{key:'content',label:'Markdown 内容（未选笔记时使用）',type:'textarea'}],watch:c=>c.source?['file:'+c.source]:[],
  async mount(ctx){const markdown=ctx.config.source?await ctx.services.io.read(ctx.config.source):ctx.config.content;if(ctx.signal.aborted)return;await ctx.services.integrations.renderMarkdown(markdown,ctx.el,ctx.lifetime,ctx.config.source||ctx.sourcePath);}
};
