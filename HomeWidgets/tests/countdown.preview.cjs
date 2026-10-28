// Browser preview against the real host and compiled widget. Edits stay in memory.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const root=path.resolve(__dirname,'..'),vault=path.dirname(root);
const taskRemovalPreview=process.env.HOME_WIDGETS_TASK_REMOVAL_PREVIEW==='1';
const editPreview=process.env.HOME_WIDGETS_LAYOUT_PREVIEW==='1'||taskRemovalPreview;let writes=0;
const capturePreview=process.env.HOME_WIDGETS_CAPTURE_PREVIEW==='1';
let pluginData={countdowns:{version:2,events:[
 {id:'event-project',title:'项目里程碑',date:'2026-11-01',start:'2026-10-01',area:'工作'},
 {id:'event-weekend',title:'留给自己的周末',date:'2026-10-18',area:'生活'},
 {id:'event-newyear',title:'迎接新的一年',date:'2027-01-01',area:'生活'},
 {id:'event-old',title:'已结束',date:'2026-10-01',area:'工作'}
]}},pluginVersion=0;
function appStyles(){
  const folder=path.join(process.env.APPDATA,'obsidian'),archive=fs.readdirSync(folder).filter(n=>/^obsidian-.*\.asar$/.test(n)).sort().pop();
  const data=fs.readFileSync(path.join(folder,archive)),header=JSON.parse(data.subarray(16,16+data.readUInt32LE(12))),entry=header.files['app.css'],start=8+data.readUInt32LE(4)+Number(entry.offset);
  return data.subarray(start,start+entry.size);
}
const layout={version:3,theme:'native',widgets:[{id:'countdown',type:'countdown',title:'值得期待的日子',span:12,height:440,settings:{featured:'event-project',upcoming:0}}]};
if(capturePreview)layout.widgets=[{id:'capture-preview',type:'capture',title:'捕捉一闪而过的灵感',span:12,height:298,settings:{folder:'Inbox/Ideas'}}];
if(taskRemovalPreview)layout.widgets=[
 {id:'tasks-work',type:'tasks',title:'工作待办',span:6,settings:{source:'Home/待办.md',area:'work',showCompleted:false,limit:1}},
 {id:'tasks-work-peer',type:'tasks',title:'工作分类副本',span:6,settings:{source:'Home/待办.md',area:'work'}},
 {id:'tasks-life',type:'tasks',title:'生活待办',span:6,settings:{source:'Home/待办.md',area:'life'}}
];
const files=new Map([['Home/widgets.json',JSON.stringify(layout)]]);
if(taskRemovalPreview)files.set('Home/待办.md','# 模拟待办\n- [ ] 准备项目材料 #task #area/work ^work-one\n- [x] 已完成的工作 #task #area/work ^work-done\n- [ ] 列表之外的工作 #task #area/work ^work-other\n- [ ] 整理书桌 #task #area/life ^life-one\n');
const html=`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>倒计时组件预览</title><link rel="stylesheet" href="/app.css"><link rel="stylesheet" href="/theme.css"><link rel="stylesheet" href="/styles.css"><style>
html{overflow:auto}body{display:block;position:static;contain:none;overflow:auto;width:100%;height:auto;min-height:100vh;margin:0;padding:25px 12px;background:var(--background-secondary);--interactive-accent:#df8c79;--interactive-accent-hover:#cf7968}nav{max-width:620px;margin:0 auto 22px;display:flex;gap:8px}#frame{max-width:620px;margin:auto}#frame.narrow{max-width:315px}#home{padding:0}.hw-topbar{display:${editPreview?'flex':'none'}}.hw-footer{display:none}.hw-grid{display:block}.hw-grid>.hw-widget{margin-bottom:16px}#status,#saved{max-width:620px;margin:15px auto;color:var(--text-muted);font-size:12px;white-space:pre-wrap}
</style></head><body class="theme-light"><nav><button id="theme">切换深浅色</button><button id="narrow">切换窄屏</button><button id="tests">运行布局检查</button></nav><main id="frame"><div id="home"></div></main><p id="status">预览中的添加和编辑仅写入内存。</p><script src="/preview.js"></script><script>
document.getElementById('theme').onclick=()=>{document.body.classList.toggle('theme-light');document.body.classList.toggle('theme-dark')};
document.getElementById('narrow').onclick=()=>document.getElementById('frame').classList.toggle('narrow');
if(${taskRemovalPreview}){document.title='待办组件删除预览';document.getElementById('tests').hidden=true;}
if(!${capturePreview}&&!${editPreview}){const inspect=document.createElement('button');inspect.textContent='查看日期 JSON';document.querySelector('nav').append(inspect);const result=document.createElement('pre');result.id='saved';document.body.append(result);inspect.onclick=async()=>{const state=await(await fetch('/state')).json();result.textContent=JSON.stringify(state.pluginData?.countdowns,null,2)};}
// Reproduce Obsidian's earlier window-capture handler: textarea keydown never runs.
if(${capturePreview})window.addEventListener('keydown',event=>{if((event.ctrlKey||event.metaKey)&&event.key==='Enter'&&!event.isComposing){event.preventDefault();event.stopPropagation();}},true);
if(${capturePreview}){document.title='灵感速记组件预览';document.getElementById('frame').style.maxWidth='850px';const style=document.createElement('style');style.textContent='#frame.narrow{max-width:315px!important}';document.head.append(style);const inspect=document.createElement('button');inspect.textContent='查看保存结果';document.querySelector('nav').append(inspect);const saved=document.createElement('pre');saved.id='saved';document.body.append(saved);inspect.onclick=async()=>{const state=await(await fetch('/state')).json();saved.textContent=JSON.stringify(state.ideas,null,2)};}
if(${editPreview}){const check=document.createElement('button');check.textContent='检查已保存布局';document.querySelector('nav').append(check);const result=document.createElement('pre');result.id='saved';document.querySelector('nav').after(result);check.onclick=async()=>{const state=await(await fetch('/state')).json();result.textContent='写入次数：'+state.writes+'；已保存顺序：'+state.layout.widgets.map(w=>w.title).join(' → ')};}
HomeWidgetsPreview.start(document.getElementById('home')).catch(e=>document.getElementById('status').textContent=e.message);
document.getElementById('tests').onclick=()=>{
 if(${capturePreview}){
  const card=document.querySelector('[data-widget-type="capture"]'),body=card.querySelector('.hw-widget-body'),composer=card.querySelector('.hw-capture-composer'),input=card.querySelector('textarea'),footer=card.querySelector('.hw-capture-footer'),errors=[];
  if(body.scrollWidth>body.clientWidth+1||body.scrollHeight>body.clientHeight+1)errors.push('组件外层存在溢出');
  if(footer.scrollWidth>footer.clientWidth+1)errors.push('操作栏横向溢出');
  if(input.clientHeight<72)errors.push('输入区过小');
  const key=card.querySelector('.hw-capture-key'),group=card.querySelector('.hw-capture-categories'),save=card.querySelector('.hw-capture-save');
  if(footer.children[0]!==group||footer.children[1]!==key||footer.children[2]!==save)errors.push('快捷键位置不正确');
  if(card.querySelectorAll('.hw-capture-category[aria-pressed="true"]').length!==1)errors.push('分类选中状态异常');
  if(!card.querySelector('.hw-widget-subtitle'))errors.push('标题栏缺少副标题');
  document.getElementById('status').textContent=errors.length?errors.join('\\n'):'检查通过：一体式输入区、分类标签和中间快捷键完整显示，无多余滚动。';return;
 }
 const card=document.querySelector('[data-widget-type="countdown"]'),body=card.querySelector('.hw-widget-body');
 const nodes=[...body.querySelectorAll('.hw-countdown-hero,.hw-countdown-event,.hw-countdown-calendar')];
 const rect=body.getBoundingClientRect(),errors=[];
 for(const node of nodes){const r=node.getBoundingClientRect();if(r.left<rect.left-1||r.right>rect.right+1)errors.push('内容超出宽度：'+node.className)}
 if(body.scrollWidth>body.clientWidth+1)errors.push('存在横向溢出');
 if(card.querySelector('progress,[role="progressbar"],.hw-countdown-track'))errors.push('进度条未移除');
 const rows=card.querySelectorAll('.hw-countdown-event').length;
 if(card.querySelectorAll('time').length!==rows)errors.push('日期信息不完整');
 if(card.querySelector('.hw-countdown-caption'))errors.push('重复日期行尚未移除');
 if(card.querySelectorAll('.hw-countdown-delete').length!==rows+1)errors.push('删除入口不完整');
 const hero=card.querySelector('.hw-countdown-hero'),number=card.querySelector('.hw-countdown-number'),list=card.querySelector('.hw-countdown-list');
 const heroRect=hero.getBoundingClientRect(),numberRect=number.getBoundingClientRect();
 if(Math.abs(numberRect.left-card.querySelector('.hw-countdown-copy').getBoundingClientRect().left)>1)errors.push('倒计时未恢复左对齐');
 if(body.scrollHeight>body.clientHeight+1)errors.push('主卡片外层仍然发生滚动');
 if(list){const previous=list.scrollTop;list.scrollTop=list.scrollHeight;if(list.scrollHeight>list.clientHeight+1&&list.scrollTop===0)errors.push('其他日子无法滚动');if(Math.abs(hero.getBoundingClientRect().top-heroRect.top)>.5)errors.push('滚动影响主卡片');list.scrollTop=previous;}
 document.getElementById('status').textContent=errors.length?errors.join('\\n'):'布局检查通过：倒计时恢复左对齐，其他日子独立滚动，主卡片保持固定。';
};
</script></body></html>`;
const base=appStyles(),theme=path.join(vault,'.obsidian/themes/AnuPpuccin/theme.css');
http.createServer(async(req,res)=>{
 try{
  if(req.method==='POST'&&req.url==='/api/io'){
   let body='';for await(const part of req)body+=part;const input=JSON.parse(body),p=input.path;let result;
   switch(input.action){
    case 'read':result=files.get(p);break;case 'exists':result=files.has(p);break;
    case 'snapshot':result={text:files.get(p),version:files.get(p)};break;
    case 'cas':if(input.version!==files.get(p)){res.writeHead(409);res.end(JSON.stringify({error:'conflict'}));return;}files.set(p,input.text);writes++;result=true;break;
    case 'changes':result={cursor:0,paths:[]};break;
    case 'plugin-data-read':result={data:pluginData,version:pluginVersion};break;
    case 'plugin-data-save':if(input.version!==pluginVersion)throw Error('Plugin data conflict');pluginData=input.data;result={version:++pluginVersion};break;
    case 'create':if(files.has(p))throw Error('File exists');files.set(p,input.text);writes++;result=true;break;
    case 'list':result=[...files.keys()].filter(key=>key.startsWith(p+'/'));break;
    default:throw Error('Unsupported preview operation: '+input.action);
   }
   res.setHeader('Content-Type','application/json');res.end(JSON.stringify({result}));return;
  }
  const routes={'/':['text/html; charset=utf-8',()=>html],'/state':['application/json',()=>JSON.stringify({writes,pluginData,layout:JSON.parse(files.get('Home/widgets.json')),tasks:taskRemovalPreview?files.get('Home/待办.md'):undefined,ideas:[...files].filter(([p])=>p.startsWith('Inbox/Ideas/')).map(([path,text])=>({path,text}))})],'/app.css':['text/css',()=>base],'/theme.css':['text/css',()=>fs.readFileSync(theme)],'/styles.css':['text/css',()=>fs.readFileSync(path.join(root,'build/styles.css'))],'/preview.js':['text/javascript',()=>fs.readFileSync(path.join(root,'build/preview.js'))]};
  const route=routes[req.url];if(!route){res.writeHead(404);res.end();return;}res.setHeader('Content-Type',route[0]);res.setHeader('Cache-Control','no-store');res.end(route[1]());
 }catch(e){res.writeHead(500);res.end(JSON.stringify({error:e.message}));}
}).listen(8790,'127.0.0.1',()=>console.log('Countdown preview: http://127.0.0.1:8790 (in-memory data)'));
