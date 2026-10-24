// Local browser acceptance. Both stores are memory-only; no vault data is touched.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),esbuild=require('esbuild');
const {chromium}=require(process.env.MY_CALENDAR_PLAYWRIGHT||'playwright');
const root=path.resolve(__dirname,'..'),output=path.join(root,'build','countdown-source-preview');
function asset(name){const dir=path.join(process.env.APPDATA,'obsidian'),file=path.join(dir,fs.readdirSync(dir).filter(n=>/^obsidian-.*\.asar$/.test(n)).sort().pop());const bytes=fs.readFileSync(file),header=JSON.parse(bytes.subarray(16,16+bytes.readUInt32LE(12))),entry=header.files[name],start=8+bytes.readUInt32LE(4)+Number(entry.offset);return bytes.subarray(start,start+entry.size).toString('utf8');}
(async()=>{
 fs.mkdirSync(output,{recursive:true});const bundle=await esbuild.build({entryPoints:[path.join(__dirname,'countdown-sync-preview.ts')],bundle:true,write:false,format:'iife',platform:'node',alias:{obsidian:path.join(__dirname,'preview-obsidian.ts')}});
 const browser=await chromium.launch({headless:true,...(process.env.MY_CALENDAR_BROWSER?{executablePath:process.env.MY_CALENDAR_BROWSER}:{})});
 try{
  const page=await browser.newPage({viewport:{width:900,height:1100}}),errors=[];page.on('pageerror',error=>errors.push(error.message));await page.route('**/*',route=>route.abort());
  await page.setContent('<!doctype html><html><head><meta charset="utf-8"></head><body class="theme-light"><nav><button id="new">新建日程</button></nav><main><section id="stage"></section><section class="hw-home" data-theme="native"><article data-widget-type="countdown"><header id="countdown-actions"></header><div id="countdown"></div></article></section><p id="notice" role="status"></p></main></body></html>');
  await page.addStyleTag({content:asset('app.css')});await page.addStyleTag({content:fs.readFileSync(path.join(root,'../.obsidian/themes/AnuPpuccin/theme.css'),'utf8')});
  for(const file of ['build/styles.css','../HomeWidgets/build/styles.css'])await page.addStyleTag({content:fs.readFileSync(path.join(root,file),'utf8')});
  await page.addStyleTag({content:'html{overflow:auto}body{display:block;position:static;contain:none;overflow:auto;min-height:100vh;height:auto;padding:16px;background:var(--background-primary)}main,nav{max-width:720px;margin:0 auto}#stage .modal{position:static;width:100%;max-width:100%;max-height:none;padding:20px;margin:16px 0;box-shadow:none}#stage .modal-content{margin:0;overflow:visible}article{padding:16px}#countdown-actions{display:flex;justify-content:flex-end}.hw-home{margin-top:20px}#notice{color:var(--text-error)}'});
  await page.addScriptTag({content:bundle.outputFiles[0].text});const title=()=>page.getByPlaceholder('日程标题…');
  const save=async()=>{await page.getByRole('button',{name:'保存',exact:true}).click();await page.locator('.mc-modal').waitFor({state:'detached'});await page.evaluate(()=>calendarPreview.sync());};
  assert.equal(await page.getByRole('checkbox',{name:'同步到倒计时',exact:true}).isChecked(),false);
  await title().fill('单一来源日程');await page.getByRole('checkbox',{name:'同步到倒计时',exact:true}).check();await save();
  assert.equal(await page.locator('#countdown .hw-countdown-title').innerText(),'单一来源日程');
  assert.equal(await page.evaluate(()=>JSON.stringify(calendarPreview.home).includes('单一来源日程')),false);
  await page.evaluate(()=>calendarPreview.open(0));await title().fill('改期后的日程');await page.getByRole('textbox',{name:'开始日期',exact:true}).fill('2026-11-08');
  await page.evaluate(()=>{calendarPreview.failCalendar=true;});await page.getByRole('button',{name:'保存',exact:true}).click();await page.getByRole('status').filter({hasText:'日程保存失败'}).waitFor();
  assert.equal(await page.locator('#countdown .hw-countdown-title').innerText(),'单一来源日程');await page.evaluate(()=>{calendarPreview.failCalendar=false;});await save();
  assert.equal(await page.locator('#countdown .hw-countdown-title').innerText(),'改期后的日程');
  await page.evaluate(async()=>{calendarPreview.setHostState('missing');await calendarPreview.render();calendarPreview.open(0);});
  assert.equal(await page.getByRole('checkbox',{name:'同步到倒计时',exact:true}).count(),0);
  await page.locator('#countdown').getByRole('status').filter({hasText:'日程来源未连接'}).waitFor();
  assert.equal(await page.locator('#countdown .hw-countdown-title').innerText(),'改期后的日程');await title().fill('断开期间修改');await save();
  await page.evaluate(async()=>{calendarPreview.setHostState('connected');await calendarPreview.sync();});assert.equal(await page.locator('#countdown .hw-countdown-title').innerText(),'断开期间修改');
  await page.evaluate(async()=>{calendarPreview.failSource=true;await calendarPreview.sync();});await page.locator('#countdown').getByRole('status').filter({hasText:'来源读取失败'}).waitFor();
  assert.equal(await page.locator('#countdown .hw-countdown-title').innerText(),'断开期间修改');await page.evaluate(async()=>{calendarPreview.failSource=false;await calendarPreview.sync();});
  await page.evaluate(async()=>{const el=document.createElement('section');el.id='real-host';document.querySelector('main').append(el);window.previewHost=await calendarPreview.mountHost(el);});
  const real=page.locator('#real-host');await real.getByRole('button',{name:'置顶日期 断开期间修改',exact:true}).waitFor();
  await page.waitForFunction(()=>document.querySelectorAll('#real-host .mcw-root').length===2);assert.equal(await page.locator('style#my-calendar-widget-css').count(),1);
  await page.evaluate(()=>previewHost.removeFirstCalendar());await page.waitForFunction(()=>document.querySelectorAll('#real-host .mcw-root').length===1);assert.equal(await page.locator('style#my-calendar-widget-css').count(),1);
  await page.evaluate(async()=>{calendarPreview.setHostState('missing');await calendarPreview.sync();});await page.waitForFunction(()=>document.querySelectorAll('#real-host .mcw-root').length===0);assert.equal(await page.locator('style#my-calendar-widget-css').count(),0);
  await page.evaluate(async()=>{calendarPreview.replaceSource();calendarPreview.setHostState('connected');await calendarPreview.sync();});await page.waitForFunction(()=>document.querySelectorAll('#real-host .mcw-root').length===1);assert.equal(await page.locator('style#my-calendar-widget-css').count(),1);
  await real.getByRole('button',{name:'添加关键日期',exact:true}).click();const form=real.getByRole('dialog');await form.getByRole('textbox',{name:'日期名称',exact:true}).fill('未保存的独立日期');
  await page.evaluate(async()=>{const previous=structuredClone(calendarPreview.plugin.events[0]);await calendarPreview.plugin.saveEvent({...previous,title:'表单期间更新'},previous);await calendarPreview.sync();});
  assert.equal(await real.locator('.hw-countdown-title').innerText(),'断开期间修改');assert.equal(await form.getByRole('textbox',{name:'日期名称',exact:true}).inputValue(),'未保存的独立日期');
  await form.getByRole('button',{name:'取消',exact:true}).click();await real.getByRole('heading',{name:'表单期间更新',exact:true}).waitFor();
  await page.evaluate(async()=>{const previous=structuredClone(calendarPreview.plugin.events[0]);await calendarPreview.plugin.saveEvent({...previous,title:'断开期间修改'},previous);await calendarPreview.sync();});await real.getByRole('heading',{name:'断开期间修改',exact:true}).waitFor();
  await real.getByRole('button',{name:'置顶日期 断开期间修改',exact:true}).focus();await page.evaluate(()=>calendarPreview.plugin.deleteEvent(calendarPreview.plugin.events[0]));
  await real.getByRole('heading',{name:'断开期间修改',exact:true}).waitFor({state:'detached',timeout:1500});assert.equal(await page.evaluate(()=>JSON.stringify(calendarPreview.home).includes('断开期间修改')),false);
  await page.getByRole('button',{name:'新建日程',exact:true}).click();await title().fill('跨天日程');await page.getByRole('checkbox',{name:'同步到倒计时',exact:true}).check();await page.getByRole('checkbox',{name:'跨天日程',exact:true}).check();await page.getByRole('textbox',{name:'结束日期',exact:true}).fill('2026-11-09');
  await page.setViewportSize({width:390,height:1100});await page.evaluate(()=>{document.body.className='theme-dark';document.getElementById('notice').textContent='';});await page.screenshot({path:path.join(output,'new-dark-390.png'),fullPage:true});await save();
  assert.equal(await page.evaluate(async()=>(await calendarPreview.dates.list('default'))[0].date),'2026-11-06');
  await real.getByRole('textbox',{name:'未保存的编辑内容',exact:true}).fill('编辑中的内容');await page.evaluate(()=>calendarPreview.plugin.deleteEvent(calendarPreview.plugin.events[0]));await real.getByRole('heading',{name:'跨天日程',exact:true}).waitFor({state:'detached',timeout:1500});assert.equal(await real.getByRole('textbox',{name:'未保存的编辑内容',exact:true}).inputValue(),'编辑中的内容');
  await page.evaluate(()=>previewHost.dispose());assert.equal(await page.locator('style#my-calendar-widget-css').count(),0);
  assert.deepEqual(errors,[]);console.log(JSON.stringify({output,checks:['source-only business data','save failure does not publish','disconnect retains snapshot and hides capability','read failure is not deletion','reconnect updates data','real host deletion refresh','two calendar style leases','unregister/re-register on source replacement','open form delays refresh until close','draft protection','cross-day start date','390px dark'],pageErrors:errors}));
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
