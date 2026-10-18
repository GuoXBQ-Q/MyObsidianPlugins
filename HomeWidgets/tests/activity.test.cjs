const test=require('node:test'),assert=require('node:assert/strict');
const {createActivityService,calendarRange}=require('../src/services/activity');
const {createTaskService}=require('../src/services/tasks');
const {localDay}=require('../src/services/date');
const {createVaultIO}=require('../src/adapters/vault');
const {Bus}=require('../src/core/lifecycle');

test('calendar uses Monday columns, real month lengths and current day cutoff',()=>{
  const range=calendarRange('weeks',new Date(2026,9,18,23));assert.equal(range.start,'2026-07-20');assert.equal(range.end,'2026-10-18');assert.equal(range.cells.length,91);
  const midweek=calendarRange('weeks',new Date(2026,9,14));assert.equal(midweek.cells.at(-1),'2026-10-18');assert.equal(midweek.end,'2026-10-14');
  const month=calendarRange('month',new Date(2028,1,10));assert.equal(month.cells.filter(Boolean).length,29);assert.equal(month.cells[0],null);assert.equal(month.cells.at(-1),'2028-02-29');
});
test('note metadata filters by folder and bins creation time rather than modification time',async()=>{
  const io=createVaultIO({vault:{getMarkdownFiles:()=>[
    {path:'Ideas/a.md',stat:{ctime:new Date(2026,9,2,15).getTime(),mtime:new Date(2026,9,18).getTime()}},
    {path:'Ideas/nested/b.md',stat:{ctime:new Date(2026,9,2,16).getTime()}},
    {path:'Ideas-other/c.md',stat:{ctime:new Date(2026,9,3).getTime()}}
  ]}},new Bus());
  assert.equal((await io.notes()).length,3);await assert.rejects(io.notes('../outside'));
  const data=await createActivityService(io).query('notes',{noteFolder:'Ideas'},calendarRange('month',new Date(2026,9,18)));
  assert.deepEqual([...data.days],[['2026-10-02',2]]);
});
test('task heatmap accepts completion formats, excludes undated, invalid, pending and fenced examples',async()=>{
  const text='- [x] A ✅ 2026-10-02\n- [X] B [completion:: 2026-10-02]\n- [x] undated\n- [x] invalid ✅ 2026-02-30\n- [ ] pending ✅ 2026-10-03\n- [x] future ✅ 2026-10-19\n```md\n- [x] example ✅ 2026-10-04\n```';
  const activity=createActivityService({exists:async()=>true,read:async()=>text});const result=await activity.query('tasks',{},calendarRange('month',new Date(2026,9,18)));
  assert.deepEqual([...result.days],[['2026-10-02',2]]);assert.match(result.note,/2 项/);
});
test('source registration supports new metrics, validates data and unregisters without replacing builtins',async()=>{
  const bus=new Bus(),activity=createActivityService({},bus);let changed=0;bus.on('activity-sources',()=>changed++);
  const remove=activity.registerSource({id:'habit',label:'阅读打卡',unit:'分钟',load:async()=>({values:[{date:'2026-10-02',value:20},{date:'2026-10-02',value:15},{date:'2026-10-02',value:-3},{date:'2026-02-30',value:10},{date:'2026-10-03',value:NaN}]})});
  const data=await activity.query('habit',{},calendarRange('month',new Date(2026,9,18)));assert.deepEqual([...data.days],[['2026-10-02',35]]);
  assert.throws(()=>activity.registerSource({id:'notes',label:'duplicate',unit:'篇',load:async()=>({values:[]})}),/重复/);remove();remove();assert.equal(changed,2);assert.equal(activity.list().length,2);await assert.rejects(activity.query('habit',{},{}),/不可用/);
});
test('native completion dates survive editing and disappear when reopened, with block IDs and CRLF intact',async()=>{
  let text='- [ ] Task #task #area/work ^id-one\r\n- [ ] Sibling ^id-two\r\n';const io={read:async()=>text,update:async(p,fn)=>{text=fn(text);}};const tasks=createTaskService(io),source='Home/tasks.md';
  await tasks.toggle((await tasks.list(source))[0],true);assert.match(text,new RegExp('✅ '+localDay()+' \\^id-one\\r\\n'));assert.equal((await tasks.list(source))[0].title,'Task');
  await tasks.edit((await tasks.list(source))[0],{title:'Changed',due:'2026-11-01'});assert.match(text,new RegExp('✅ '+localDay()));assert.equal((await tasks.list(source))[0].title,'Changed');
  const activity=createActivityService({...io,exists:async()=>true});assert.equal((await activity.query('tasks',{taskSource:source},calendarRange())).days.get(localDay()),1);
  await tasks.toggle((await tasks.list(source))[0],false);assert(!text.includes('✅'));assert.match(text,/\^id-one\r\n- \[ \] Sibling \^id-two\r\n$/);
});
