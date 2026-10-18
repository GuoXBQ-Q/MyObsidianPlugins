const {button,empty}=require('../../core/dom');
module.exports={type:'command',label:'命令 / QuickAdd',icon:'⚡',span:4,defaults:{label:'运行流程',commandId:'',quickAddChoice:''},
  fields:[{key:'label',label:'按钮文字'},{key:'commandId',label:'Obsidian 命令 ID（例如 daily-notes）'},{key:'quickAddChoice',label:'QuickAdd Choice 名称（填写后优先运行）'}],watch:()=>['integrations'],
  mount(ctx){if(!ctx.config.commandId&&!ctx.config.quickAddChoice){ctx.el.append(empty(ctx.doc,'在组件设置中选择命令 ID 或填写 QuickAdd Choice 名称。'));return;}
    const b=button(ctx.doc,ctx.config.label||'运行流程',()=>{b.disabled=true;ctx.run(async()=>{if(ctx.config.quickAddChoice)await ctx.services.integrations.quickAdd(ctx.config.quickAddChoice,{});else await ctx.services.integrations.command(ctx.config.commandId);}).finally(()=>{if(!ctx.signal.aborted)b.disabled=false;});},{class:'hw-button hw-primary'});ctx.el.append(b);
  }
};
