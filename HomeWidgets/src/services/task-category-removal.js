const {parseTasks,taskBlockEnd}=require('./tasks');
const {organizeTaskSections}=require('./task-sections');

function taskScope(item){
  const source=item.settings?.source??'Home/待办.md',area=item.settings?.area??'work';
  if(typeof source!=='string'||!source.trim()||typeof area!=='string'||!area||!/^[\w-]+$/.test(area))throw new Error('待办组件的源文件或分类无效，请先修正组件设置');
  return {source,area};
}

// Work from the exact text the user confirmed, rather than a limited/filtered widget list.
function transformCategories(text,plans){
  const modes=new Map();
  for(const plan of plans){
    if(!['uncategorize','delete'].includes(plan.mode))throw new Error('请选择保留任务或同时删除任务');
    if(modes.has(plan.area)&&modes.get(plan.area)!==plan.mode)throw new Error('同一分类选择了不同的任务处理方式，请不保存退出后统一选择');
    modes.set(plan.area,plan.mode);
  }
  const lines=text.split('\n'),tasks=parseTasks(text,plans[0]?.source),removed=new Set();
  // A nested task in another category retains its own block, even when its parent is deleted.
  for(const task of tasks){
    const deleting=modes.get(task.area)==='delete';
    for(let i=task.line,end=taskBlockEnd(lines,task.line);i<end;i++)deleting?removed.add(i):removed.delete(i);
  }
  for(const task of tasks)if(modes.get(task.area)==='uncategorize'){
    const raw=lines[task.line];
    if(/#area\/[\w-]+/.test(raw))lines[task.line]=raw.replace(/#area\/[\w-]+/g,'#area/uncategorized');
    else lines[task.line]=raw.replace(/( \^[\w-]+)?([ \t]*\r?)$/,(_,id='',ending)=>' #area/uncategorized'+id+ending);
  }
  return organizeTaskSections(lines.filter((_,i)=>!removed.has(i)).join('\n'),parseTasks,taskBlockEnd);
}

// Vault APIs provide atomic writes per file. Compare before each write and roll back
// earlier writes if a later file fails; never overwrite a concurrent external edit.
async function commitCategoryRemoval(io,layoutPath,updateLayout,plans){
  const layoutBefore=await io.read(layoutPath),layoutAfter=updateLayout(layoutBefore),groups=new Map();
  for(const plan of plans){
    if(plan.source===layoutPath)throw new Error('待办源文件不能是布局文件');
    if(!groups.has(plan.source))groups.set(plan.source,[]);groups.get(plan.source).push(plan);
  }
  const changes=[];
  for(const [path,items] of groups){
    const before=await io.read(path);
    if(items.some(plan=>typeof plan.snapshot!=='string'||plan.snapshot!==before))throw new Error('任务文件「'+path+'」已变化，请不保存退出后重新确认删除');
    const after=transformCategories(before,items);if(after!==before)changes.push({path,before,after});
  }
  changes.push({path:layoutPath,before:layoutBefore,after:layoutAfter});
  const applied=[];
  try{
    for(const change of changes){
      await io.update(change.path,current=>{if(current!==change.before)throw new Error('文件「'+change.path+'」已变化，未覆盖新内容');return change.after;});
      applied.push(change);
    }
  }catch(error){
    const failed=[];
    for(const change of applied.reverse())try{
      await io.update(change.path,current=>{if(current!==change.after)throw new Error('文件已被外部修改');return change.before;});
    }catch{failed.push(change);}
    if(failed.length){
      const recovery='HomeWidgets/recovery/task-removal-'+crypto.randomUUID()+'.json';
      let backedUp=false;try{await io.create(recovery,JSON.stringify({reason:error.message,files:failed},null,2)+'\n');backedUp=true;}catch{}
      throw new Error(error.message+(backedUp?'；部分修改无法自动恢复，原文已备份到 '+recovery:'；以下文件无法自动恢复：'+failed.map(c=>c.path).join('、')+'。请保留当前窗口并检查文件。'));
    }
    throw error;
  }
}

module.exports={taskScope,transformCategories,commitCategoryRemoval};
