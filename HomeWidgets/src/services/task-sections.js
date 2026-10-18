const START='<!-- home-widgets:tasks -->',END='<!-- /home-widgets:tasks -->';
function taskRegion(text){
  const start=text.indexOf(START),end=text.indexOf(END);
  if(start<0&&end<0)return null;
  if(start<0||end<start||text.indexOf(START,start+START.length)>=0||text.indexOf(END,end+END.length)>=0)throw new Error('待办分组区域标记不完整或重复，已保留原文');
  return {start:start+START.length,end};
}
function appendTask(text,line){const region=taskRegion(text);return region?text.slice(0,region.end).trimEnd()+'\n'+line+'\n\n'+text.slice(region.end):text.trimEnd()+'\n'+line+'\n';}
function organizeTaskSections(text,parseTasks,taskBlockEnd){
  const region=taskRegion(text);if(!region)return text;
  const content=text.slice(region.start,region.end),lines=content.split('\n'),tasks=parseTasks(content,''),byLine=new Map(tasks.map(task=>[task.line,task])),blocks=[];
  for(let i=0;i<lines.length;){
    const task=byLine.get(i);
    if(task){const end=taskBlockEnd(lines,i);blocks.push({...task,block:lines.slice(i,end).join('\n').replace(/\s+$/,'')});i=end;continue;}
    if(lines[i].trim()&&!/^#{2,3} /.test(lines[i]))throw new Error('待办分组区域包含无法归类的内容，请将说明移到区域外；已保留原文');
    i++;
  }
  const labels={work:'工作',life:'生活',uncategorized:'未分类'},areas=[...new Set(['work','life',...blocks.map(task=>task.area)])];
  const sections=areas.map(area=>'## '+(labels[area]||area)+'\n\n'+[false,true].map(done=>'### '+(done?'已完成':'未完成')+'\n\n'+blocks.filter(task=>task.area===area&&task.done===done).map(task=>task.block).join('\n')).join('\n\n'));
  const eol=text.includes('\r\n')?'\r\n':'\n',body=('\n\n'+sections.join('\n\n').trimEnd()+'\n\n').replace(/\r\n/g,'\n').replace(/\n/g,eol);
  return text.slice(0,region.start)+body+text.slice(region.end);
}
module.exports={taskRegion,appendTask,organizeTaskSections};
