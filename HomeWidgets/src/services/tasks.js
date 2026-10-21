const {daysUntil,localDay}=require('./date');
const {appendTask,organizeTaskSections}=require('./task-sections');
const completionPattern=/(?:\s*✅\s*\d{4}-\d{2}-\d{2}|\s*\[completion::\s*\d{4}-\d{2}-\d{2}\s*\])/g;
const indentOf=line=>line.match(/^[ \t]*/)[0].replace(/\t/g,'    ').length;
const blockId=raw=>raw.match(/ \^([\w-]+)\s*$/)?.[1];
function parseTasks(text,source){
  const tasks=[],stack=[];let fence=null;
  for(const [index,raw] of text.split('\n').entries()){
    const marker=raw.match(/^\s*(`{3,}|~{3,})/);
    if(fence){if(marker&&marker[1][0]===fence[0]&&marker[1].length>=fence.length)fence=null;continue;}
    const indent=indentOf(raw);
    if(raw.trim())while(stack.length&&stack.at(-1).indent>=indent)stack.pop();
    if(marker){fence=marker[1];continue;}
    const m=raw.replace(/\r$/,'').match(/^([ \t]*[-*+] )\[([ xX])\] (.+)$/);if(!m)continue;
    const parent=stack.at(-1),explicitArea=m[3].match(/#area\/([\w-]+)/)?.[1];
    const task={id:blockId(raw)||'line-'+index,line:index,snapshot:text,source,raw,indent,depth:parent?parent.depth+1:0,parentLine:parent?.line??null,parentId:parent?.id||null,childCount:0,
      done:m[2].toLowerCase()==='x',area:explicitArea||parent?.area||'life',due:m[3].match(/📅 (\d{4}-\d{2}-\d{2})/)?.[1]||'',recurring:m[3].includes('🔁'),
      title:m[3].replace(/ \^[\w-]+\s*$/,'').replace(completionPattern,'').replace(/#task\b|#area\/[\w-]+|📅 \d{4}-\d{2}-\d{2}/g,'').trim()};
    if(parent)parent.childCount++;tasks.push(task);stack.push(task);
  }
  return tasks;
}
const leafTasks=tasks=>tasks.filter(task=>!task.childCount);
function locateTask(text,task){
  const lines=text.split('\n'),tasks=parseTasks(text,task.source),id=blockId(task.raw);
  const matches=tasks.filter(item=>id?blockId(item.raw)===id:item.raw===task.raw);
  const match=matches.length===1?matches[0]:!id&&task.snapshot===text?matches.find(item=>item.line===task.line):undefined;
  if(!match||lines[match.line]!==task.raw)throw new Error('任务已被修改，请刷新后再操作');
  return {lines,index:match.line,task:match,tasks};
}
function taskBlockEnd(lines,index){
  const depth=indentOf(lines[index]);let end=index+1;
  for(let cursor=end;cursor<lines.length;cursor++){
    if(!lines[cursor].trim())continue;if(indentOf(lines[cursor])<=depth)break;end=cursor+1;
  }
  return end;
}
function groupFor(tasks,task){
  let root=task;while(root.parentLine!==null)root=tasks.find(item=>item.line===root.parentLine);
  const end=taskBlockEnd(root.snapshot.split('\n'),root.line);return tasks.filter(item=>item.line>=root.line&&item.line<end);
}
function groupError(group){
  if(group.some(task=>task.depth>1))return '子待办最多支持两层，请先在笔记中调整更深的层级';
  if(group.some(task=>task.area!==group[0].area))return '子待办须与父待办属于同一分类，请先在笔记中调整分类';
  if(group.length>1&&group.some(task=>task.recurring))return '重复待办请独立使用；此组包含重复任务，无法执行父子联动';return '';
}
function assertGroup(group){const error=groupError(group);if(error)throw new Error(error);}
function checkedGroup(text,task){
  const current=locateTask(text,task),group=groupFor(current.tasks,current.task);
  if(task.snapshot!==undefined){
    const original=locateTask(task.snapshot,task),before=groupFor(original.tasks,original.task);
    const content=(lines,root)=>lines.slice(root.line,taskBlockEnd(lines,root.line)).join('\n');
    if(content(current.lines,group[0])!==content(original.lines,before[0]))throw new Error('任务或子项已被修改，请刷新后再操作');
  }
  return {...current,group};
}
function validateTitle(title,due){title=String(title||'').replace(/[\r\n]+/g,' ').trim();if(!title)throw new Error('请填写任务');if(due)daysUntil(due);return title;}
function setDone(raw,done){
  let result=raw.replace(/\[([ xX])\]/,done?'[x]':'[ ]').replace(completionPattern,'');
  if(done){const tail=result.match(/( \^[\w-]+)?([ \t]*\r?)$/)[0];result=result.slice(0,result.length-tail.length)+' ✅ '+localDay()+tail;}return result;
}
function assignId(lines,task){
  const id=blockId(lines[task.line])||'hw-'+crypto.randomUUID();
  if(!blockId(lines[task.line]))lines[task.line]=lines[task.line].trimEnd()+' ^'+id+(lines[task.line].endsWith('\r')?'\r':'');return id;
}
function moveBlock(lines,from,to,after){
  const end=taskBlockEnd(lines,from),destination=after?taskBlockEnd(lines,to):to,block=lines.splice(from,end-from);
  lines.splice(destination>from?destination-block.length:destination,0,...block);return lines;
}
function rootToEnd(text,id,source){
  const tasks=parseTasks(text,source),root=tasks.find(task=>task.id===id);if(!root||root.parentLine!==null)return text;
  const last=tasks.filter(task=>task.parentLine===null&&task.area===root.area&&task.done===root.done&&task.id!==id).at(-1);
  return last?moveBlock(text.split('\n'),root.line,last.line,true).join('\n'):text;
}
function childToEnd(text,id,source){
  const tasks=parseTasks(text,source),child=tasks.find(task=>task.id===id);
  if(!child||child.parentLine===null)return text;
  const last=tasks.filter(task=>task.parentLine===child.parentLine).at(-1);
  return last&&last!==child?moveBlock(text.split('\n'),child.line,last.line,true).join('\n'):text;
}
function createTaskService(io,integrations){
  const reopenHandlers=new Set();
  const clearHidden=async(source,tasks)=>{const ids=tasks.map(task=>blockId(task.raw)).filter(Boolean);if(ids.length)for(const handler of reopenHandlers)await handler(source,ids);};
  const update=(source,transform)=>io.update(source,text=>organizeTaskSections(transform(text).replace(/\r?\n/g,text.includes('\r\n')?'\r\n':'\n'),parseTasks,taskBlockEnd));
  return {
    onReopen(handler){reopenHandlers.add(handler);return ()=>reopenHandlers.delete(handler);},
    list:async(source,area)=>parseTasks(await io.read(source),source).filter(task=>!area||task.area===area),
    async ensureId(task){
      const existing=blockId(task.raw);if(existing){locateTask(await io.read(task.source),task);return existing;}
      let id;await update(task.source,text=>{const current=locateTask(text,task);id=assignId(current.lines,current.task);return current.lines.join('\n');});return id;
    },
    async add(source,{title,area,due}){
      title=validateTitle(title,due);if(!/^[\w-]+$/.test(area))throw new Error('分类只能使用字母、数字、下划线和短横线');
      const id='hw-'+crypto.randomUUID(),line='- [ ] '+title+' #task #area/'+area+(due?' 📅 '+due:'')+' ^'+id;
      await update(source,text=>appendTask(text,line));return id;
    },
    async addChild(parent,{title,due}){
      title=validateTitle(title,due);if(title.includes('🔁'))throw new Error('子待办不支持重复，请创建独立待办');
      const before=await io.read(parent.source),prepared=checkedGroup(before,parent);assertGroup(prepared.group);
      if(prepared.task.parentLine!==null)throw new Error('子待办最多支持两层');if(prepared.task.recurring)throw new Error('重复待办请独立使用，不能添加子待办');
      if(prepared.task.done)await clearHidden(parent.source,[prepared.task]);let result;
      await update(parent.source,text=>{
        const {lines,task,group}=checkedGroup(text,parent);assertGroup(group);
        const parentId=assignId(lines,task),id='hw-'+crypto.randomUUID(),indent=task.raw.match(/^[ \t]*/)[0]+'  ',ending=text.includes('\r\n')?'\r':'';
        lines.splice(taskBlockEnd(lines,task.line),0,indent+'- [ ] '+title+' #task #area/'+task.area+(due?' 📅 '+due:'')+' ^'+id+ending);
        if(task.done)lines[task.line]=setDone(lines[task.line],false);result={parentId,id};
        return task.done?rootToEnd(lines.join('\n'),parentId,parent.source):lines.join('\n');
      });return result;
    },
    async edit(task,{title,due=task.due}){
      title=validateTitle(title,due);
      await update(task.source,text=>{
        const current=locateTask(text,task),{lines,index}=current,group=groupFor(current.tasks,current.task);
        if(group.length>1&&title.includes('🔁'))throw new Error('重复待办请独立使用，不能加入父子组');
        const prefix=task.raw.match(/^([ \t]*[-*+] \[[ xX]\] )/)[1],metadata=task.raw.match(/#task\b|#area\/[\w-]+/g)||[],id=blockId(task.raw)||'hw-'+crypto.randomUUID(),completion=task.raw.match(completionPattern)?.join('')||'';
        lines[index]=prefix+title+(metadata.length?' '+metadata.join(' '):'')+(due?' 📅 '+due:'')+completion+' ^'+id+(task.raw.endsWith('\r')?'\r':'');return lines.join('\n');
      });
    },
    async remove(task){
      const before=await io.read(task.source),prepared=checkedGroup(before,task);if(prepared.task.parentLine!==null)assertGroup(prepared.group);
      const siblings=prepared.group.slice(1).filter(item=>item.line!==prepared.task.line);
      if(prepared.task.parentLine!==null&&siblings.length&&!siblings.every(item=>item.done)&&prepared.group[0].done)await clearHidden(task.source,[prepared.group[0]]);
      await update(task.source,text=>{
        const {lines,index,group,task:current}=checkedGroup(text,task),root=group[0];
        if(current.parentLine!==null)assertGroup(group);
        let rootChanged=false,id;
        if(current.parentLine!==null){
          const remaining=group.slice(1).filter(item=>item.line!==index);id=assignId(lines,root);
          if(remaining.length){const done=remaining.every(item=>item.done);if(done!==root.done){lines[root.line]=setDone(lines[root.line],done);rootChanged=true;}}
        }
        lines.splice(index,taskBlockEnd(lines,index)-index);return rootChanged?rootToEnd(lines.join('\n'),id,task.source):lines.join('\n');
      });
    },
    async toggle(task,done){
      if(done===task.done)return;
      const before=await io.read(task.source),current=checkedGroup(before,task),{group}=current;assertGroup(group);
      const root=group[0],changes=new Map();
      if(current.task.parentLine===null){for(const item of group)if(item.done!==done)changes.set(item.line,done);}
      else{changes.set(current.task.line,done);const rootDone=group.slice(1).every(item=>item.line===current.task.line?done:item.done);if(rootDone!==root.done)changes.set(root.line,rootDone);}
      const transform=integrations?.taskTransform(),results=new Map();
      for(const item of group){
        if(!changes.has(item.line))continue;const desired=changes.get(item.line);
        if(item.recurring&&!transform)throw new Error('重复任务需要启用 Tasks；普通任务仍可使用');
        const result=transform?await transform(item.raw,task.source):setDone(item.raw,desired);
        if(typeof result!=='string'||!result.trim())throw new Error('任务插件未返回有效内容');
        if(!item.recurring){const parsed=parseTasks(result,task.source);if(result.trimEnd().includes('\n')||parsed.length!==1||parsed[0].done!==desired||parsed[0].indent!==item.indent)throw new Error('任务插件返回的完成状态或缩进无效，已保留原文');}
        results.set(item.line,result);
      }
      await clearHidden(task.source,group.filter(item=>changes.get(item.line)===false));
      await update(task.source,text=>{
        const fresh=checkedGroup(text,task),lines=fresh.lines,offset=fresh.group[0].line-root.line;
        const id=blockId(root.raw)||'hw-'+crypto.randomUUID(),seen=new Set(fresh.tasks.filter(item=>!changes.has(item.line-offset)).map(item=>blockId(item.raw)).filter(Boolean));
        const completedChild=done&&current.task.parentLine!==null?current.task:null,childId=completedChild&&(blockId(completedChild.raw)||'hw-'+crypto.randomUUID());
        for(const item of [...group].reverse()){
          if(!results.has(item.line))continue;let result=results.get(item.line);
          if((item===root||item===completedChild)&&!blockId(item.raw)){
            const parts=result.split('\n');parts[0]=parts[0].trimEnd()+' ^'+(item===root?id:childId)+(item.raw.endsWith('\r')?'\r':'');result=parts.join('\n');
          }
          result=result.split('\n').map(line=>line.replace(/ \^([\w-]+)([ \t]*\r?)$/,(_,old,ending)=>{const next=seen.has(old)?'hw-'+crypto.randomUUID():old;seen.add(next);return ' ^'+next+ending;})).join('\n');
          lines.splice(item.line+offset,1,result);
        }
        const next=completedChild?childToEnd(lines.join('\n'),childId,task.source):lines.join('\n');
        return changes.has(root.line)?rootToEnd(next,id,task.source):next;
      });
    },
    async move(task,target,after=false){
      if(task.source!==target.source)throw new Error('只能在同一待办笔记内排序');if(task.line===target.line)return;
      let id;
      await update(task.source,text=>{
        const from=checkedGroup(text,task),to=checkedGroup(text,target);assertGroup(from.group);assertGroup(to.group);
        if(from.task.parentLine!==to.task.parentLine||from.task.area!==to.task.area||from.task.parentLine===null&&from.task.done!==to.task.done)throw new Error('只能在同一父项或同一完成分区内排序');
        id=assignId(from.lines,from.task);return moveBlock(from.lines,from.index,to.index,after).join('\n');
      });return id;
    }
  };
}
module.exports={parseTasks,leafTasks,groupFor,groupError,createTaskService,taskBlockEnd};
