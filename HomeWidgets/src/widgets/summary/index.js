const {element}=require('../../core/dom');
const {leafTasks}=require('../../services/tasks');
module.exports={type:'summary',label:'今日概览',icon:'◷',span:12,defaults:{taskSource:'Home/待办.md',ideaFolder:'Inbox/Ideas',quote:'把想做的事，一点一点变成现实吧。✧'},
  fields:[{key:'taskSource',label:'待办笔记路径'},{key:'ideaFolder',label:'灵感目录'},{key:'quote',label:'一句话'}],watch:c=>['file:'+c.taskSource,'folder:'+c.ideaFolder],
  async mount(ctx){const [allTasks,ideas]=await Promise.all([ctx.services.tasks.list(ctx.config.taskSource),ctx.services.ideas.list(ctx.config.ideaFolder)]);if(ctx.signal.aborted)return;const tasks=leafTasks(allTasks),done=tasks.filter(t=>t.done).length,stats=element(ctx.doc,'div',{class:'hw-summary'});
    for(const [value,label] of [[tasks.length-done,'件事等待完成'],[done,'件事已经做好'],[ideas.filter(i=>i.status!=='archived').length,'个想法等待发芽']])stats.append(element(ctx.doc,'span',{},element(ctx.doc,'b',{},value),' '+label));stats.append(element(ctx.doc,'span',{class:'hw-summary-quote'},ctx.config.quote));ctx.el.append(stats);
  }
};
