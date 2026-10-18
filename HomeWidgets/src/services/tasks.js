const {daysUntil,localDay}=require('./date');
const {appendTask,organizeTaskSections}=require('./task-sections');
const completionPattern=/(?:\s*✅\s*\d{4}-\d{2}-\d{2}|\s*\[completion::\s*\d{4}-\d{2}-\d{2}\s*\])/g;
function parseTasks(text,source) {
  let fenced=false;
  return text.split('\n').flatMap((raw,index)=>{
    if(/^\s*(```|~~~)/.test(raw)){fenced=!fenced;return [];}
    if(fenced)return [];
    const m=raw.replace(/\r$/,'').match(/^(\s*[-*+] )\[([ xX])\] (.+)$/);if(!m)return [];
    const blockId=m[3].match(/ \^([\w-]+)\s*$/)?.[1];
    return [{id:blockId||'line-'+index,line:index,snapshot:text,source,raw,done:m[2].toLowerCase()==='x',area:m[3].match(/#area\/([\w-]+)/)?.[1]||'life',due:m[3].match(/📅 (\d{4}-\d{2}-\d{2})/)?.[1]||'',recurring:m[3].includes('🔁'),title:m[3].replace(/ \^[\w-]+\s*$/,'').replace(completionPattern,'').replace(/#task\b|#area\/[\w-]+|📅 \d{4}-\d{2}-\d{2}/g,'').trim()}];
  });
}
function locateTask(text,task){
  const lines=text.split('\n'),current=parseTasks(text,task.source),blockId=task.raw.match(/ \^([\w-]+)\s*$/)?.[1];
  const matches=current.filter(item=>blockId?item.raw.match(/ \^([\w-]+)\s*$/)?.[1]===blockId:item.raw===task.raw);
  const match=matches.length===1?matches[0]:!blockId&&task.snapshot===text?matches.find(item=>item.line===task.line):undefined;
  if(!match||lines[match.line]!==task.raw)throw new Error('任务已被修改，请刷新后再操作');
  return {lines,index:match.line};
}
function taskBlockEnd(lines,index){
  const indent=line=>line.match(/^[ \t]*/)[0].replace(/\t/g,'    ').length,depth=indent(lines[index]);let end=index+1;
  for(let cursor=end;cursor<lines.length;cursor++){
    if(!lines[cursor].trim())continue;
    if(indent(lines[cursor])<=depth)break;
    end=cursor+1;
  }
  return end;
}
function createTaskService(io,integrations) {
  const update=(source,transform)=>io.update(source,text=>organizeTaskSections(transform(text),parseTasks,taskBlockEnd));
  return {
    list:async(source,area)=>parseTasks(await io.read(source),source).filter(t=>!area||t.area===area),
    async ensureId(task){
      const existing=task.raw.match(/ \^([\w-]+)\s*$/)?.[1];if(existing)return existing;
      const id='hw-'+crypto.randomUUID();
      await update(task.source,text=>{
        const {lines,index}=locateTask(text,task);
        lines[index]=task.raw.trimEnd()+' ^'+id+(task.raw.endsWith('\r')?'\r':'');return lines.join('\n');
      });
      return id;
    },
    async add(source,{title,area,due}) {
      title=String(title||'').replace(/[\r\n]+/g,' ').trim();if(!title)throw new Error('请填写任务');
      if(!/^[\w-]+$/.test(area))throw new Error('分类只能使用字母、数字、下划线和短横线');if(due)daysUntil(due);
      const line='- [ ] '+title+' #task #area/'+area+(due?' 📅 '+due:'')+' ^hw-'+crypto.randomUUID();
      await update(source,text=>appendTask(text,line));
    },
    async edit(task,{title,due=task.due}){
      title=String(title||'').replace(/[\r\n]+/g,' ').trim();if(!title)throw new Error('请填写任务');if(due)daysUntil(due);
      await update(task.source,text=>{
        const {lines,index}=locateTask(text,task),prefix=task.raw.match(/^(\s*[-*+] \[[ xX]\] )/)[1];
        const metadata=task.raw.match(/#task\b|#area\/[\w-]+/g)||[],id=task.raw.match(/ \^([\w-]+)\s*$/)?.[1]||'hw-'+crypto.randomUUID();
        const completion=task.raw.match(completionPattern)?.join('')||'';
        lines[index]=prefix+title+(metadata.length?' '+metadata.join(' '):'')+(due?' 📅 '+due:'')+completion+' ^'+id+(task.raw.endsWith('\r')?'\r':'');
        return lines.join('\n');
      });
    },
    async remove(task){
      await update(task.source,text=>{
        const {lines,index}=locateTask(text,task),end=taskBlockEnd(lines,index);
        // Delete the task's indented description/subtasks, leaving sibling content intact.
        if(task.snapshot!==undefined){
          const original=locateTask(task.snapshot,task),before=original.lines.slice(original.index,taskBlockEnd(original.lines,original.index)).join('\n');
          if(lines.slice(index,end).join('\n')!==before)throw new Error('任务或子项已被修改，请刷新后再操作');
        }
        lines.splice(index,end-index);return lines.join('\n');
      });
    },
    async toggle(task,done) {
      if(done===task.done)return;
      // The Tasks API returns Markdown (including the next recurrence), not a file mutation.
      const transform=integrations?.taskTransform();
      if(task.recurring&&!transform)throw new Error('重复任务需要启用 Tasks；普通任务仍可使用');
      let result=transform?await transform(task.raw,task.source):task.raw.replace(/\[([ xX])\]/,done?'[x]':'[ ]');
      if(!transform){
        result=result.replace(completionPattern,'');
        if(done){const tail=result.match(/( \^[\w-]+)?([ \t]*\r?)$/)[0];result=result.slice(0,result.length-tail.length)+' ✅ '+localDay()+tail;}
      }
      if(typeof result!=='string'||!result.trim())throw new Error('任务插件未返回有效内容');
      await update(task.source,text=>{
        const {lines,index}=locateTask(text,task);
        // A transformed recurring task may produce multiple lines; do not duplicate block IDs.
        const seen=new Set();result=result.split('\n').map(l=>l.replace(/ \^([\w-]+)([ \t]*\r?)$/,(_,id,ending)=>{if(seen.has(id))return ' ^hw-'+crypto.randomUUID()+ending;seen.add(id);return ' ^'+id+ending;})).join('\n');
        lines.splice(index,1,result);return lines.join('\n');
      });
    }
  };
}
module.exports={parseTasks,createTaskService,taskBlockEnd};
