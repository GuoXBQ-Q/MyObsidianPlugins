// Standalone browser integration fixture: every note/config write stays in memory.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require(process.env.HOME_WIDGETS_PLAYWRIGHT||'playwright');
const root=path.resolve(__dirname,'..'),output=path.join(root,'preview','task-tree');
function asset(name){
  const data=fs.readFileSync(path.join(process.env.APPDATA,'obsidian/obsidian-1.14.4.asar'));
  const header=JSON.parse(data.subarray(16,16+data.readUInt32LE(12))),entry=header.files[name],start=8+data.readUInt32LE(4)+Number(entry.offset);
  return data.subarray(start,start+entry.size).toString('utf8');
}
async function main(){
  fs.mkdirSync(output,{recursive:true});
  const browser=await chromium.launch({headless:true,...(process.env.HOME_WIDGETS_BROWSER?{executablePath:process.env.HOME_WIDGETS_BROWSER}:{})});
  try{
    const page=await browser.newPage({viewport:{width:1200,height:850}}),errors=[];page.on('pageerror',error=>errors.push(error.message));
    await page.route('http://127.0.0.1/task-tree-test',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><html><head><meta charset="utf-8"></head><body class="theme-light"><main id="home"></main></body></html>'}));
    await page.goto('http://127.0.0.1/task-tree-test');await page.addStyleTag({content:asset('app.css')});await page.addStyleTag({content:fs.readFileSync(path.join(root,'build/styles.css'),'utf8')});
    await page.addStyleTag({content:'html{overflow:auto}body{display:block;position:static;contain:none;overflow:auto;width:100%;height:auto;min-height:100vh;padding:20px 10px}#home{width:100%}'});
    await page.addScriptTag({content:fs.readFileSync(path.join(root,'build/preview.js'),'utf8')});
    await page.evaluate(async()=>{
      const widgets=['primary','mirror'].map(id=>({id,type:'tasks',title:id==='primary'?'工作待办':'同源另一实例',span:6,settings:{source:'tasks.md',area:'work',showCompleted:true,limit:20}}));
      widgets.push({id:'life',type:'tasks',title:'同文件生活待办',span:6,settings:{source:'tasks.md',area:'life'}},{id:'separate',type:'tasks',title:'另一来源待办',span:6,settings:{source:'other.md',area:'work'}});
      window.files=new Map([['Home/widgets.json',JSON.stringify({version:2,theme:'native',widgets})],['other.md','- [ ] 独立任务 #area/work ^independent\n'],['tasks.md','- [ ] 把这一周安排好 #area/work ^p\n  - [x] 整理学习资料 ^a\n  - [ ] 读完第一章，记下三个问题 ^b\n- [ ] 傍晚散步 20 分钟 #area/work ^other\n- [ ] 周五小组讨论，提前准备好 #area/work ^third\n- [ ] 生活任务 #area/life ^life-task\n']]);
      const revisions=new Map();
      window.fetch=async(url,options)=>{
        const request=JSON.parse(options.body),p=request.path;let result;
        switch(request.action){
          case 'read':
            if(p==='tasks.md'&&window.failTaskRead)return {ok:false,status:500,json:async()=>({error:'模拟读取失败'})};
            if(p==='tasks.md'&&window.readDelayMs)await new Promise(resolve=>setTimeout(resolve,window.readDelayMs));
            result=files.get(p);break;
          case 'exists':result=files.has(p);break;
          case 'snapshot':result={text:files.get(p),version:revisions.get(p)||0};break;
          case 'cas':
            if(window.failTaskWrite&&p==='tasks.md')return {ok:false,status:500,json:async()=>({error:'模拟保存失败'})};
            if(request.version!==(revisions.get(p)||0))return {ok:false,status:409,json:async()=>({error:'conflict'})};
            files.set(p,request.text);revisions.set(p,(revisions.get(p)||0)+1);result=true;break;
          case 'changes':result={cursor:0,paths:[]};break;
          default:throw Error('Unexpected '+request.action);
        }
        return {ok:true,json:async()=>({result})};
      };
      window.host=await HomeWidgetsPreview.start(document.getElementById('home'));
    });
    const primary=page.locator('[data-widget-id="primary"]'),mirror=page.locator('[data-widget-id="mirror"]');
    const cb=(scope,name)=>scope.getByRole('checkbox',{name,exact:true});
    await cb(primary,'把这一周安排好').waitFor();assert.equal(await primary.locator('.hw-task-group-progress').textContent(),'1/2');
    assert.equal(await primary.getByRole('img').getAttribute('aria-label'),'共 4 项待办，已完成 1 项，剩余 3 项');
    await primary.getByRole('button',{name:'收起子待办 把这一周安排好',exact:true}).click();await cb(primary,'整理学习资料').waitFor({state:'detached'});assert.equal(await cb(mirror,'整理学习资料').count(),1);
    await page.evaluate(async()=>{host.dispose();host=await HomeWidgetsPreview.start(document.getElementById('home'));});await primary.getByRole('button',{name:'展开子待办 把这一周安排好',exact:true}).waitFor();
    await primary.getByRole('button',{name:'添加子待办 把这一周安排好',exact:true}).click();
    const input=primary.getByRole('textbox',{name:'子待办内容',exact:true});await input.waitFor();assert.equal(await input.evaluate(el=>el===document.activeElement),true);
    await input.fill('连续新增第一项');await input.press('Enter');await cb(primary,'连续新增第一项').waitFor();await input.waitFor({state:'detached'});
    await primary.getByRole('button',{name:'添加子待办 把这一周安排好',exact:true}).click();await input.waitFor();assert.equal(await input.inputValue(),'');assert.equal(await input.evaluate(el=>el===document.activeElement),true);
    await input.fill('连续新增第二项');await primary.getByLabel('子待办截止日期（可选）',{exact:true}).fill('2026-12-01');
    const dateBox=await primary.getByLabel('子待办截止日期（可选）',{exact:true}).boundingBox(),calendarTriggerBox=await primary.getByRole('button',{name:'选择子待办截止日期（可选）',exact:true}).boundingBox();assert(calendarTriggerBox.x>=dateBox.x+dateBox.width);assert(dateBox.width<160);
    await page.screenshot({path:path.join(output,'add-child.png'),fullPage:true});
    await primary.getByRole('button',{name:'选择子待办截止日期（可选）',exact:true}).click();
    await input.press('Escape');assert.equal(await input.isVisible(),true);
    await primary.getByRole('button',{name:'收起子待办 把这一周安排好',exact:true}).click();await input.waitFor({state:'detached'});
    await primary.getByRole('button',{name:'添加子待办 把这一周安排好',exact:true}).click();await input.waitFor();assert.equal(await input.inputValue(),'连续新增第二项');
    const before=await page.evaluate(()=>files.get('tasks.md'));
    await input.dispatchEvent('keydown',{key:'Enter',code:'Enter',isComposing:true});assert.equal(await page.evaluate(()=>files.get('tasks.md')),before);
    await page.evaluate(()=>window.failTaskWrite=true);await input.press('Enter');await page.getByRole('status').filter({hasText:'模拟保存失败'}).waitFor();assert.equal(await input.inputValue(),'连续新增第二项');assert.equal(await page.evaluate(()=>files.get('tasks.md')),before);
    await page.evaluate(()=>window.failTaskWrite=false);await input.press('Enter');await cb(primary,'连续新增第二项').waitFor();assert.match(await page.evaluate(()=>files.get('tasks.md')),/连续新增第二项.*📅 2026-12-01/);
    await input.waitFor({state:'detached'});await page.screenshot({path:path.join(output,'expanded.png'),fullPage:true});
    // A slow note adapter must never leave any existing task card blank while loading.
    await page.evaluate(()=>{
      window.readDelayMs=100;window.emptyTaskFrames=[];window.monitorFrames=true;
      window.unchangedTaskNodes=['life','separate'].map(id=>document.querySelector('[data-widget-id="'+id+'"] .hw-task-list'));
      const monitor=()=>{if(!window.monitorFrames)return;for(const card of document.querySelectorAll('[data-widget-type="tasks"]'))if(!card.querySelector('.hw-task-list'))emptyTaskFrames.push(card.dataset.widgetId);requestAnimationFrame(monitor);};requestAnimationFrame(monitor);
    });
    await cb(primary,'读完第一章，记下三个问题').check();
    await page.waitForFunction(()=>Array.from(document.querySelectorAll('[data-widget-id="mirror"] .hw-task-child .hw-task-title')).at(-1)?.textContent==='读完第一章，记下三个问题');
    assert.deepEqual(await primary.locator('.hw-task-child .hw-task-title').allTextContents(),['整理学习资料','连续新增第一项','连续新增第二项','读完第一章，记下三个问题']);
    assert.equal(await page.evaluate(()=>unchangedTaskNodes.every((node,index)=>node===document.querySelector('[data-widget-id="'+['life','separate'][index]+'"] .hw-task-list'))),true);
    await cb(primary,'读完第一章，记下三个问题').uncheck();await page.waitForFunction(()=>!document.querySelector('[data-widget-id="mirror"] input[aria-label="读完第一章，记下三个问题"]')?.checked);
    await page.evaluate(()=>{window.monitorFrames=false;window.readDelayMs=0;});assert.deepEqual(await page.evaluate(()=>emptyTaskFrames),[]);
    await page.evaluate(()=>{window.taskListBeforeReadFailure=document.querySelector('[data-widget-id="primary"] .hw-task-list');window.failTaskRead=true;});
    await cb(primary,'读完第一章，记下三个问题').check();await page.getByRole('status').filter({hasText:'模拟读取失败'}).waitFor();
    await page.waitForFunction(()=>{const box=document.querySelector('[data-widget-id="primary"] input[aria-label="读完第一章，记下三个问题"]');return box&&!box.disabled&&!box.checked;});
    assert.equal(await page.evaluate(()=>taskListBeforeReadFailure===document.querySelector('[data-widget-id="primary"] .hw-task-list')),true);await page.evaluate(()=>window.failTaskRead=false);
    await primary.getByRole('button',{name:'隐藏已完成待办 整理学习资料',exact:true}).click();await cb(primary,'整理学习资料').waitFor({state:'detached'});assert.equal(await primary.locator('.hw-task-group-progress').textContent(),'1/4');
    await cb(primary,'把这一周安排好').check();await primary.getByRole('button',{name:'隐藏已完成待办 把这一周安排好',exact:true}).waitFor();assert.equal(await primary.locator('.hw-task-group-progress').textContent(),'4/4');
    await primary.getByRole('button',{name:'隐藏已完成待办 把这一周安排好',exact:true}).click();await cb(primary,'把这一周安排好').waitFor({state:'detached'});assert.equal(await primary.locator('.hw-task-hidden-count').textContent(),'1');
    await cb(mirror,'读完第一章，记下三个问题').uncheck();await cb(primary,'把这一周安排好').waitFor();assert.equal(await cb(primary,'把这一周安排好').isChecked(),false);assert.equal(await cb(primary,'连续新增第一项').isChecked(),true);
    await cb(mirror,'读完第一章，记下三个问题').check();await primary.getByRole('button',{name:'隐藏已完成待办 把这一周安排好',exact:true}).waitFor();assert.equal(await cb(primary,'把这一周安排好').count(),1);
    await cb(primary,'把这一周安排好').uncheck();await page.waitForFunction(()=>document.querySelector('[data-widget-id="primary"] .hw-task-group-progress')?.textContent==='0/4');
    // Keyboard sort saves source order, and mirror reads that same order.
    await primary.getByRole('button',{name:'排序待办 把这一周安排好',exact:true}).press('Alt+ArrowDown');
    await page.waitForFunction(()=>files.get('tasks.md').indexOf('傍晚散步')<files.get('tasks.md').indexOf('把这一周'));
    assert.equal(await primary.getByRole('button',{name:'排序待办 把这一周安排好',exact:true}).evaluate(el=>el===document.activeElement),true);
    const source=await primary.getByRole('button',{name:'排序待办 把这一周安排好',exact:true}).boundingBox(),target=await primary.locator('.hw-task-group').filter({has:page.getByRole('checkbox',{name:'傍晚散步 20 分钟',exact:true})}).boundingBox();
    await page.mouse.move(source.x+source.width/2,source.y+source.height/2);await page.mouse.down();await page.mouse.move(target.x+target.width/2,target.y+3,{steps:8});
    assert.equal(await primary.locator('.hw-task-drop-before').count(),1);await page.mouse.up();await page.waitForFunction(()=>files.get('tasks.md').indexOf('把这一周')<files.get('tasks.md').indexOf('傍晚散步'));
    const cancelBefore=await page.evaluate(()=>files.get('tasks.md')),grip=await primary.getByRole('button',{name:'排序待办 把这一周安排好',exact:true}).boundingBox(),third=await cb(primary,'周五小组讨论，提前准备好').boundingBox();
    await page.mouse.move(grip.x+8,grip.y+8);await page.mouse.down();await page.mouse.move(third.x+10,third.y+10,{steps:8});await page.keyboard.press('Escape');await page.mouse.up();assert.equal(await page.evaluate(()=>files.get('tasks.md')),cancelBefore);
    // The root limit must leave the complete first group visible.
    await page.evaluate(async()=>{const layout=JSON.parse(files.get('Home/widgets.json'));layout.widgets[0].settings.limit=1;files.set('Home/widgets.json',JSON.stringify(layout));await host.sync();});
    await cb(primary,'连续新增第二项').waitFor();assert.equal(await primary.getByRole('checkbox').count(),5);
    await page.setViewportSize({width:390,height:950});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    await primary.getByRole('button',{name:'添加子待办 把这一周安排好',exact:true}).click();await input.waitFor();await primary.getByRole('button',{name:'选择子待办截止日期（可选）',exact:true}).click();
    const calendar=primary.getByRole('group',{name:'日期选择器',exact:true});assert(await calendar.isVisible());const calendarBox=await calendar.boundingBox();assert(calendarBox.x>=0&&calendarBox.x+calendarBox.width<=390);await input.press('Escape');assert.equal(await input.count(),1);await input.press('Escape');await input.waitFor({state:'detached'});
    await primary.getByRole('button',{name:'编辑待办 把这一周安排好',exact:true}).click();const edit=page.getByRole('dialog');await edit.getByRole('textbox',{name:'要做的事',exact:true}).fill('倒计时加一个归档的功能，点击删除之后，弹出的页面里加一个归档按钮，归档的话就不显示了');await edit.getByRole('button',{name:'保存',exact:true}).click();await edit.waitFor({state:'detached'});
    for(const typography of [{fontSize:15,lineHeight:1.75},{fontSize:18,lineHeight:1.9}]){
      await page.evaluate(async typography=>{const layout=JSON.parse(files.get('Home/widgets.json'));layout.typography=typography;files.set('Home/widgets.json',JSON.stringify(layout));await host.sync();},typography);
      const offsets=await primary.locator('.hw-task-main').evaluateAll(labels=>labels.map(label=>{const box=label.querySelector('input').getBoundingClientRect(),title=label.querySelector('.hw-task-title'),rect=title.getBoundingClientRect();return Math.abs(box.top+box.height/2-(rect.top+parseFloat(getComputedStyle(title).lineHeight)/2));}));assert(offsets.every(offset=>offset<1),'checkboxes must center on the first text line');
    }
    await page.screenshot({path:path.join(output,'narrow.png'),fullPage:true});
    await page.emulateMedia({colorScheme:'dark'});await page.evaluate(()=>{document.body.classList.remove('theme-light');document.body.classList.add('theme-dark');});await page.screenshot({path:path.join(output,'dark.png'),fullPage:true});
    assert.deepEqual(errors,[]);console.log(JSON.stringify({screenshots:output,checks:['leaf totals','fold persistence and instance isolation','save closes editor and next add is manual','compact date and calendar icon on the right','IME Enter','failed save preserves draft','completed child moves to group end','slow reads never show blank task cards','unrelated categories preserve DOM','failed read retains content and restores checkbox','independent child date','child and group hiding','reopen clears mirror hides','bidirectional completion','keyboard sort and focus','pointer sorting and drop marker','Esc cancels drag','group limit','multiline checkbox alignment at two font sizes','390px and dark mode'],pageErrors:errors}));
  }finally{await browser.close();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
