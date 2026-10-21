const test=require('node:test'),assert=require('node:assert/strict');
const {createQuoteService,parseQuotes}=require('../src/services/quotes');
const {createIdeaService,ideaFilename}=require('../src/services/ideas');
const {createTaskService}=require('../src/services/tasks');
const {transformCategories}=require('../src/services/task-category-removal');
function fixture(initial={}){
  const files=new Map(Object.entries(initial)),queues=new Map();
  const io={exists:async p=>files.has(p),read:async p=>{if(!files.has(p))throw Error('missing');return files.get(p);},list:async folder=>[...files.keys()].filter(p=>p.startsWith(folder+'/')),create:async(p,text)=>{if(files.has(p))throw Error('exists');files.set(p,text);},update:async(p,fn)=>{const job=(queues.get(p)||Promise.resolve()).catch(()=>{}).then(()=>{const text=fn(files.get(p));files.set(p,text);});queues.set(p,job);await job;}};
  return {files,io};
}
test('quote edits/deletions preserve surrounding prose, metadata, fenced samples and other quotes',async()=>{
  const prefix='\uFEFF---\r\ntype: quotes\r\n---\r\n# 我的引言\r\n说明\r\n```\r\n- 示例\r\n```\r\n',suffix='\r\n## 保留说明\r\n不要删除\r\n';
  const {files,io}=fixture({'quotes.md':prefix+'- 第一句\r\n  续行\r\n- 第二句\r\n'+suffix}),service=createQuoteService(io);
  await service.save('quotes.md','新的第一句\n仍可换行',(await service.list('quotes.md'))[0]);
  assert.equal(files.get('quotes.md'),prefix+'- 新的第一句\r\n  仍可换行\r\n- 第二句\r\n'+suffix);
  await service.remove('quotes.md',(await service.list('quotes.md'))[0]);assert.equal(files.get('quotes.md'),prefix+'- 第二句\r\n'+suffix);
  await service.save('quotes.md','第三句\n续行');assert.deepEqual(parseQuotes(files.get('quotes.md')),['第二句','第三句\n续行']);
});
test('stale quote edits and deletes fail without overwriting concurrent changes; queued adds retain both entries',async()=>{
  const {files,io}=fixture({'quotes.md':'- 原引言\n'}),service=createQuoteService(io),entry=(await service.list('quotes.md'))[0];
  files.set('quotes.md','- 外部修改\n');await assert.rejects(service.save('quotes.md','我的修改',entry),/已变化/);await assert.rejects(service.remove('quotes.md',entry),/已变化/);assert.equal(files.get('quotes.md'),'- 外部修改\n');
  await Promise.all([service.save('quotes.md','新增一'),service.save('quotes.md','新增二')]);assert.deepEqual(parseQuotes(files.get('quotes.md')),['外部修改','新增一','新增二']);
  const before=files.get('quotes.md');await assert.rejects(service.save('quotes.md','新增一'),/已有/);assert.equal(files.get('quotes.md'),before);
});
test('a missing quote library is created only on explicit save and a failed create never overwrites another writer',async()=>{
  const {files,io}=fixture(),service=createQuoteService(io);assert.deepEqual(await service.list('quotes.md'),[]);assert.equal(files.size,0);
  await service.save('quotes.md','第一句');assert.deepEqual(parseQuotes(files.get('quotes.md')),['第一句']);
  files.delete('quotes.md');const create=io.create;io.create=async(p,text)=>{files.set(p,'- 并发创建的内容\n');return create(p,text);};
  await assert.rejects(service.save('quotes.md','不可覆盖'),/exists/);assert.equal(files.get('quotes.md'),'- 并发创建的内容\n');
});
test('readable idea names never overwrite duplicate captures, including simultaneous instances',async()=>{
  const {files,io}=fixture(),a=createIdeaService(io),b=createIdeaService(io),body='同一个想法\n详细内容';
  const paths=await Promise.all([a.capture('Ideas',{body}),a.capture('Ideas',{body}),b.capture('Ideas',{body})]);
  assert.equal(new Set(paths).size,3);assert(paths.includes('Ideas/同一个想法.md'));assert(paths.includes('Ideas/同一个想法（2）.md'));assert(paths.includes('Ideas/同一个想法（3）.md'));
  files.set('Ideas/普通笔记.md','# 普通笔记');const listed=await a.list('Ideas');assert.equal(listed.length,3);assert(listed.every(idea=>idea.body===body));assert(listed.every(idea=>idea.summary==='同一个想法 详细内容'));
  assert.equal(ideaFilename('../CON: /标题?*'),'CON 标题');assert.equal(ideaFilename('CON'),'灵感-CON');assert.equal(ideaFilename('...'),'新的灵感');
});
test('failed idea save leaves existing data intact and a retry can use the intended title',async()=>{
  const {files,io}=fixture({'Ideas/已有.md':'原文'}),create=io.create;io.create=async()=>{throw Error('磁盘写入失败');};const service=createIdeaService(io);
  await assert.rejects(service.capture('Ideas',{body:'新的想法'}),/写入失败/);assert.equal(files.size,1);assert.equal(files.get('Ideas/已有.md'),'原文');
  io.create=create;assert.equal(await service.capture('Ideas',{body:'新的想法'}),'Ideas/新的想法.md');
});
test('task sections stay organized after adding, completing, restoring and removing categories without losing children or outside prose',async()=>{
  const prefix='# 待办\n说明保留\n<!-- home-widgets:tasks -->',suffix='<!-- /home-widgets:tasks -->\n后记保留\n';
  const {files,io}=fixture({'tasks.md':prefix+'\n## 工作\n### 未完成\n- [ ] 工作任务 #area/work ^work\n  说明\n  - [ ] 子项 #area/work ^child\n## 生活\n### 未完成\n- [ ] 生活任务 #area/life ^life\n'+suffix}),service=createTaskService(io);
  let task=(await service.list('tasks.md','work'))[0];await service.toggle(task,true);let text=files.get('tasks.md');
  assert(text.startsWith(prefix));assert(text.endsWith(suffix));const work=text.slice(text.indexOf('## 工作'),text.indexOf('## 生活'));assert(work.indexOf('工作任务')>work.indexOf('### 已完成'));assert.match(work,/  说明\n  - \[x\] 子项/);
  await service.add('tasks.md',{title:'新增生活任务',area:'life'});text=files.get('tasks.md');assert(text.indexOf('新增生活任务')<text.indexOf(suffix));assert(text.indexOf('新增生活任务')>text.indexOf('## 生活'));
  task=(await service.list('tasks.md','work'))[0];await service.toggle(task,false);text=files.get('tasks.md');assert(text.indexOf('工作任务')<text.indexOf('### 已完成'));
  const changed=transformCategories(text,[{source:'tasks.md',area:'work',mode:'uncategorize'}]);assert(changed.indexOf('工作任务')>changed.indexOf('## 未分类'));assert(changed.endsWith(suffix));assert.match(changed,/  说明\n  - \[ \] 子项 #area\/uncategorized/);
});
test('unknown content in managed task sections stops writes instead of deleting user text',async()=>{
  const text='<!-- home-widgets:tasks -->\n这里有自由正文\n- [ ] 原任务 #area/work ^a\n<!-- /home-widgets:tasks -->';
  const {files,io}=fixture({'tasks.md':text});await assert.rejects(createTaskService(io).add('tasks.md',{title:'新增',area:'work'}),/无法归类/);assert.equal(files.get('tasks.md'),text);
});
