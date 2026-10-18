// Optional integration checks using an existing Playwright/browser installation.
// Preview I/O is replaced with an in-memory vault; no user notes are written.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require(process.env.HOME_WIDGETS_PLAYWRIGHT||'playwright');
const root=path.resolve(__dirname,'..'),vault=path.dirname(root),output=path.join(root,'preview','tasks');
fs.mkdirSync(output,{recursive:true});
function asset(name){
  const data=fs.readFileSync(path.join(process.env.APPDATA,'obsidian/obsidian-1.14.4.asar'));
  const header=JSON.parse(data.subarray(16,16+data.readUInt32LE(12))),entry=header.files[name],start=8+data.readUInt32LE(4)+Number(entry.offset);
  return data.subarray(start,start+entry.size).toString('utf8');
}
async function main(){
  const browser=await chromium.launch({headless:true,...(process.env.HOME_WIDGETS_BROWSER?{executablePath:process.env.HOME_WIDGETS_BROWSER}:{})});
  try{
    const page=await browser.newPage({viewport:{width:1200,height:650}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.route('http://127.0.0.1/home-widgets-test',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><html><head><meta charset="utf-8"></head><body class="theme-light"><main id="home"></main></body></html>'}));
    await page.goto('http://127.0.0.1/home-widgets-test');
    await page.addStyleTag({content:asset('app.css')});await page.addStyleTag({content:fs.readFileSync(path.join(vault,'.obsidian/themes/AnuPpuccin/theme.css'),'utf8')});
    await page.addStyleTag({content:fs.readFileSync(path.join(root,'build/styles.css'),'utf8')});
    if(process.env.HOME_WIDGETS_EXTRA_CSS)await page.addStyleTag({content:fs.readFileSync(process.env.HOME_WIDGETS_EXTRA_CSS,'utf8')});
    await page.addStyleTag({content:'html{overflow:auto}body{display:block;position:static;contain:none;overflow:auto;width:100%;height:auto;min-height:100vh;padding:20px 8px;--interactive-accent:#df8c79;--interactive-accent-hover:#cf7968}#home{width:100%}'});
    await page.addScriptTag({content:fs.readFileSync(path.join(root,'build/preview.js'),'utf8')});
    await page.evaluate(async()=>{
      const widgets=[['work-primary','工作待办','work'],['work-mirror','工作待办 · 另一实例','work'],['life','日常琐事','life']].map(([id,title,area])=>({id,type:'tasks',title,span:4,height:380,settings:{source:'Home/tasks.md',area,showCompleted:true,limit:50}}));
      window.files=new Map([['Home/widgets.json',JSON.stringify({version:2,theme:'native',widgets})],['Home/tasks.md','- [ ] 进行中的任务 #area/work ^active\n'+Array.from({length:25},(_,i)=>'- [x] 已完成任务 '+(i+1)+' #area/work ^done-'+i).join('\n')+'\n- [x] 生活事项 #area/life ^life-task\n']]);
      const revisions=new Map();
      window.fetch=async(url,options)=>{
        const request=JSON.parse(options.body),p=request.path;let result;
        switch(request.action){
          case 'read':result=files.get(p);break;
          case 'exists':result=files.has(p);break;
          case 'snapshot':result={text:files.get(p),version:revisions.get(p)||0};break;
          case 'cas':if(request.version!==(revisions.get(p)||0))return {ok:false,status:409,json:async()=>({error:'conflict'})};files.set(p,request.text);revisions.set(p,(revisions.get(p)||0)+1);result=true;break;
          case 'changes':result={cursor:0,paths:[]};break;
          default:throw new Error('Unexpected preview action '+request.action);
        }
        return {ok:true,json:async()=>({result})};
      };
      window.host=await HomeWidgetsPreview.start(document.getElementById('home'));
    });
    const primary=page.locator('[data-widget-id="work-primary"]'),mirror=page.locator('[data-widget-id="work-mirror"]');
    const restore=primary.getByRole('button',{name:'还原此组件的全部隐藏待办',exact:true});
    await primary.getByRole('checkbox',{name:'进行中的任务',exact:true}).waitFor();assert.equal(await restore.isDisabled(),true);
    {
      const cdp=await page.context().newCDPSession(page);await cdp.send('DOM.enable');await cdp.send('CSS.enable');
      const document=await cdp.send('DOM.getDocument'),node=await cdp.send('DOM.querySelector',{nodeId:document.root.nodeId,selector:'[data-widget-id="work-primary"] .hw-task-title'});
      const {fonts}=await cdp.send('CSS.getPlatformFontsForNode',{nodeId:node.nodeId});assert(fonts.some(font=>font.familyName==='Noto Sans SC'),'home task text must actually render with Noto Sans SC');
      console.log(JSON.stringify({renderedFonts:fonts.map(font=>font.familyName),taskFontSize:await primary.locator('.hw-task-title').first().evaluate(el=>getComputedStyle(el).fontSize)}));await cdp.detach();
    }
    const outsideBefore=await page.evaluate(()=>{const el=document.createElement('p');el.id='ordinary-note';el.textContent='普通笔记';document.body.append(el);const style=getComputedStyle(el);return {font:style.fontFamily,size:style.fontSize};});
    await page.evaluate(async()=>{
      window.taskBeforeTypography=document.querySelector('[data-widget-id="work-primary"] input');
      const layout=JSON.parse(files.get('Home/widgets.json'));layout.typography={font:'custom',customFont:'Microsoft YaHei',fontSize:18,lineHeight:1.9};files.set('Home/widgets.json',JSON.stringify(layout));await host.sync();
    });
    assert.equal(await primary.getByRole('checkbox',{name:'进行中的任务',exact:true}).evaluate(el=>el===window.taskBeforeTypography),true);
    assert.equal(await primary.locator('.hw-task-title').first().evaluate(el=>getComputedStyle(el).fontSize),'18px');
    assert.equal(await primary.locator('.hw-task-title').first().evaluate(el=>getComputedStyle(el).lineHeight),'34.2px');
    assert((await primary.locator('.hw-task-title').first().evaluate(el=>getComputedStyle(el).fontFamily)).includes('Microsoft YaHei'));
    assert.deepEqual(await page.evaluate(()=>{const style=getComputedStyle(document.getElementById('ordinary-note'));return {font:style.fontFamily,size:style.fontSize};}),outsideBefore);
    await page.evaluate(async()=>{host.dispose();host=await HomeWidgetsPreview.start(document.getElementById('home'));});
    await primary.getByRole('checkbox',{name:'进行中的任务',exact:true}).waitFor();assert.equal(await primary.locator('.hw-task-title').first().evaluate(el=>getComputedStyle(el).fontSize),'18px');
    await page.evaluate(async()=>{const layout=JSON.parse(files.get('Home/widgets.json'));delete layout.typography;files.set('Home/widgets.json',JSON.stringify(layout));await host.sync();document.getElementById('ordinary-note').remove();});
    assert.equal(await primary.locator('.hw-task-title').first().evaluate(el=>getComputedStyle(el).fontSize),'15px');
    await page.screenshot({path:path.join(output,'progress.png'),fullPage:true});
    await primary.getByRole('checkbox',{name:'进行中的任务',exact:true}).check();
    await primary.getByRole('button',{name:'隐藏已完成待办 进行中的任务',exact:true}).waitFor();
    await primary.getByRole('button',{name:'隐藏已完成待办 进行中的任务',exact:true}).click();
    await primary.getByRole('checkbox',{name:'进行中的任务',exact:true}).waitFor({state:'detached'});
    assert.equal(await mirror.getByRole('checkbox',{name:'进行中的任务',exact:true}).count(),1);assert.equal(await restore.isEnabled(),true);
    await primary.locator('.hw-widget-body').evaluate(el=>{el.scrollTop=el.scrollHeight;});
    const buttonBox=await restore.boundingBox(),cardBox=await primary.boundingBox();assert(buttonBox.y>=cardBox.y&&buttonBox.y+buttonBox.height<cardBox.y+100,'restore should stay in the header while the task list scrolls');
    await page.screenshot({path:path.join(output,'hidden.png'),fullPage:true});
    await page.evaluate(async()=>{host.dispose();host=await HomeWidgetsPreview.start(document.getElementById('home'));});
    await page.waitForFunction(()=>document.querySelector('[data-widget-id="work-primary"] .hw-task-hidden-count')?.textContent==='1');
    assert.equal(await primary.getByRole('checkbox',{name:'进行中的任务',exact:true}).count(),0);
    await restore.click();await primary.getByRole('checkbox',{name:'进行中的任务',exact:true}).waitFor();
    assert.equal(await primary.getByRole('checkbox',{name:'进行中的任务',exact:true}).isChecked(),true);
    await page.screenshot({path:path.join(output,'restored.png'),fullPage:true});
    await page.setViewportSize({width:390,height:900});
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    const hideBox=await primary.getByRole('button',{name:'隐藏已完成待办 进行中的任务',exact:true}).boundingBox(),checkboxBox=await primary.getByRole('checkbox',{name:'进行中的任务',exact:true}).boundingBox();
    assert(hideBox.x>checkboxBox.x+checkboxBox.width,'hide action must sit after the task');
    await page.screenshot({path:path.join(output,'narrow.png'),fullPage:true});
    await page.setViewportSize({width:900,height:850});
    await primary.getByRole('button',{name:'＋ 添加待办',exact:true}).click();
    const dialog=page.getByRole('dialog');
    // Date inputs have no implicit textbox role in Chromium.
    const dateInput=dialog.locator('input[name="due"]');
    await dialog.getByRole('textbox',{name:'要做的事',exact:true}).fill('通过日历选择截止日期');
    await dateInput.fill('2026-10-17');
    const formBeforeCalendar=await dialog.boundingBox();
    await dialog.getByRole('button',{name:'选择截止日期（可选）',exact:true}).click();
    const calendar=dialog.getByRole('group',{name:'日期选择器',exact:true});
    const formWithCalendar=await dialog.boundingBox();
    for(const key of ['x','y','width','height'])assert(Math.abs(formBeforeCalendar[key]-formWithCalendar[key])<1,'calendar must not move or resize the task form');
    assert.equal(await calendar.evaluate(el=>el.matches(':popover-open')),true);assert.equal(await page.locator('dialog[open]').count(),1);
    await calendar.getByRole('button',{name:'下个月',exact:true}).click();
    await calendar.getByRole('button',{name:'2026年11月8日',exact:true}).click();
    assert.equal(await dateInput.inputValue(),'2026-11-08');assert.equal(await calendar.isVisible(),false);
    await dialog.getByRole('button',{name:'选择截止日期（可选）',exact:true}).click();
    await page.screenshot({path:path.join(output,'date-picker.png'),fullPage:true});
    await page.setViewportSize({width:390,height:900});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    await page.waitForFunction(()=>{const box=document.querySelector('.hw-date-calendar:popover-open')?.getBoundingClientRect();return box&&box.left>=0&&box.right<=innerWidth&&box.top>=0&&box.bottom<=innerHeight;});
    await page.screenshot({path:path.join(output,'date-picker-narrow.png'),fullPage:true});
    await page.setViewportSize({width:900,height:360});
    await page.waitForFunction(()=>{const box=document.querySelector('.hw-date-calendar:popover-open')?.getBoundingClientRect();return box&&box.left>=0&&box.right<=innerWidth&&box.top>=0&&box.bottom<=innerHeight;});
    await page.setViewportSize({width:390,height:900});
    await dateInput.press('Escape');assert.equal(await calendar.isVisible(),false);assert.equal(await dialog.isVisible(),true);
    await dialog.getByRole('button',{name:'添加待办',exact:true}).click();
    await primary.getByRole('checkbox',{name:'通过日历选择截止日期',exact:true}).waitFor();
    assert.match(await page.evaluate(()=>files.get('Home/tasks.md')),/通过日历选择截止日期 #task #area\/work 📅 2026-11-08/);
    await primary.getByRole('button',{name:'＋ 添加待办',exact:true}).click();
    await dialog.getByRole('textbox',{name:'要做的事',exact:true}).fill('不设截止日期');
    await dateInput.fill('2028-02-10');await dialog.getByRole('button',{name:'选择截止日期（可选）',exact:true}).click();
    await calendar.getByRole('button',{name:'2028年2月29日',exact:true}).click();assert.equal(await dateInput.inputValue(),'2028-02-29');
    await dialog.getByRole('button',{name:'选择截止日期（可选）',exact:true}).click();await calendar.getByRole('button',{name:'清除日期',exact:true}).click();assert.equal(await dateInput.inputValue(),'');
    await dialog.getByRole('button',{name:'选择截止日期（可选）',exact:true}).click();
    await dialog.getByRole('heading',{name:'添加待办',exact:true}).click();assert.equal(await calendar.isVisible(),false);assert.equal(await dialog.isVisible(),true);
    await dialog.getByRole('button',{name:'添加待办',exact:true}).click();await primary.getByRole('checkbox',{name:'不设截止日期',exact:true}).waitFor();
    const plain=(await page.evaluate(()=>files.get('Home/tasks.md'))).split('\n').find(line=>line.includes('不设截止日期'));assert(!plain.includes('📅'));
    assert.equal(await page.locator('.hw-date-calendar:popover-open').count(),0);
    await primary.getByRole('checkbox',{name:'不设截止日期',exact:true}).check();
    await primary.getByRole('button',{name:'隐藏已完成待办 不设截止日期',exact:true}).waitFor();
    await primary.getByRole('button',{name:'编辑待办 不设截止日期',exact:true}).click();
    await dialog.getByRole('heading',{name:'编辑待办',exact:true}).waitFor();
    assert.equal(await dialog.getByRole('textbox',{name:'要做的事',exact:true}).inputValue(),'不设截止日期');
    await dialog.getByRole('textbox',{name:'要做的事',exact:true}).fill('修正后的待办');await dateInput.fill('2027-01-09');
    await dialog.getByRole('button',{name:'保存',exact:true}).click();await primary.getByRole('checkbox',{name:'修正后的待办',exact:true}).waitFor();
    assert.equal(await primary.getByRole('checkbox',{name:'修正后的待办',exact:true}).isChecked(),true);
    await mirror.getByRole('checkbox',{name:'修正后的待办',exact:true}).waitFor();
    const edited=(await page.evaluate(()=>files.get('Home/tasks.md'))).split('\n').find(line=>line.includes('修正后的待办'));
    assert.match(edited,/^- \[x\] 修正后的待办 #task #area\/work 📅 2027-01-09/);assert.equal(edited.match(/\^([\w-]+)$/)[1],plain.match(/\^([\w-]+)$/)[1]);
    await primary.getByRole('button',{name:'删除待办 修正后的待办',exact:true}).click();
    await dialog.getByRole('heading',{name:'删除待办',exact:true}).waitFor();await page.screenshot({path:path.join(output,'delete-confirm.png'),fullPage:true});
    await dialog.getByRole('button',{name:'取消',exact:true}).click();assert.equal(await primary.getByRole('checkbox',{name:'修正后的待办',exact:true}).count(),1);
    assert((await page.evaluate(()=>files.get('Home/tasks.md'))).includes(edited));
    await primary.getByRole('button',{name:'删除待办 修正后的待办',exact:true}).click();await dialog.getByRole('button',{name:'删除待办',exact:true}).click();
    await primary.getByRole('checkbox',{name:'修正后的待办',exact:true}).waitFor({state:'detached'});await mirror.getByRole('checkbox',{name:'修正后的待办',exact:true}).waitFor({state:'detached'});
    assert(!(await page.evaluate(()=>files.get('Home/tasks.md'))).includes('修正后的待办'));
    assert.equal(await primary.getByRole('checkbox',{name:'通过日历选择截止日期',exact:true}).count(),1);
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    assert.deepEqual(errors,[]);console.log(JSON.stringify({screenshots:output,checks:['completion then hide','badge count and per-instance isolation','restore remains in header during scroll','persistence across host restart','restore keeps completion status','390px layout','calendar month navigation and selected date persistence','independent calendar does not resize task form','calendar remains in viewport on narrow and short windows','Escape closes calendar only','leap day and clearing optional date','calendar cleanup after form submission','edit title and date while preserving completion and ID','cancel deletion preserves the task','confirmed deletion updates the source and both widgets'],pageErrors:errors}));
  }finally{await browser.close();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
