// Optional browser integration check. Owns an in-memory preview server; never writes user dates.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{spawn}=require('node:child_process');
const {chromium}=require(process.env.HOME_WIDGETS_PLAYWRIGHT||'playwright');
const output=path.resolve(__dirname,'../preview/countdown-archive');
async function main(){
  const server=spawn(process.execPath,[path.join(__dirname,'countdown.preview.cjs')],{env:{...process.env,HOME_WIDGETS_LAYOUT_PREVIEW:'1'},windowsHide:true,stdio:['ignore','pipe','pipe']});
  let browser,page;
  try{
    await new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>reject(Error('Preview startup timed out')),8000);
      server.once('error',e=>{clearTimeout(timer);reject(e);});
      server.once('exit',code=>{clearTimeout(timer);reject(Error('Preview exited: '+code));});
      server.stderr.on('data',chunk=>process.stderr.write(chunk));
      server.stdout.on('data',chunk=>{if(String(chunk).includes('Countdown preview:')){clearTimeout(timer);resolve();}});
    });
    browser=await chromium.launch({headless:true,...(process.env.HOME_WIDGETS_BROWSER?{executablePath:process.env.HOME_WIDGETS_BROWSER}:{})});
    page=await browser.newPage({viewport:{width:850,height:980}});page.setDefaultTimeout(5000);
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.goto('http://127.0.0.1:8790');
    const card=page.locator('[data-widget-id="countdown"]');
    const state=async()=>await (await page.request.get('http://127.0.0.1:8790/state')).json();
    await card.getByRole('heading',{name:'项目里程碑',exact:true}).waitFor();
    const before=(await state()).pluginData.countdowns.events;
    await card.getByRole('button',{name:'删除日期 项目里程碑',exact:true}).click();
    let dialog=page.getByRole('dialog');
    assert.equal(await dialog.getByRole('button',{name:'归档',exact:true}).count(),1);
    assert.equal(await dialog.getByRole('button',{name:'删除日期',exact:true}).count(),1);
    fs.mkdirSync(output,{recursive:true});await dialog.screenshot({path:path.join(output,'dialog.png')});
    await page.setViewportSize({width:390,height:850});
    assert.equal(await dialog.evaluate(el=>el.scrollWidth>el.clientWidth+1),false);
    await dialog.screenshot({path:path.join(output,'dialog-narrow.png')});
    await dialog.getByRole('button',{name:'取消',exact:true}).click();assert.deepEqual((await state()).pluginData.countdowns.events,before);
    await card.getByRole('button',{name:'删除日期 项目里程碑',exact:true}).click();
    await page.getByRole('dialog').getByRole('button',{name:'归档',exact:true}).click();
    await card.getByRole('button',{name:'查看已归档的日子（1）',exact:true}).waitFor();
    assert.equal(await card.getByRole('heading',{name:'项目里程碑',exact:true}).count(),0);
    const after=await state(),saved=after.pluginData.countdowns.events;
    assert.equal(saved.length,4);assert.deepEqual(saved.find(e=>e.id==='event-project'),{...before.find(e=>e.id==='event-project'),archived:true});
    assert(after.layout.widgets.every(w=>w.settings.featured===''));
    await page.reload();await card.getByRole('button',{name:'查看已归档的日子（1）',exact:true}).waitFor();

    // Active rows, including expired dates, can all be archived without losing the recovery entry.
    for(const title of ['留给自己的周末','迎接新的一年','已结束']){
      await card.getByRole('button',{name:'删除日期 '+title,exact:true}).click();
      await page.getByRole('dialog').getByRole('button',{name:'归档',exact:true}).click();
      await card.getByRole('button',{name:'删除日期 '+title,exact:true}).waitFor({state:'detached'});
    }
    await card.getByText('添加一个值得期待的日子吧。',{exact:true}).waitFor();
    await card.getByRole('button',{name:'查看已归档的日子（4）',exact:true}).waitFor();
    assert.equal(await card.locator('.hw-widget-header').evaluate(el=>el.scrollWidth>el.clientWidth+1),false);
    await card.screenshot({path:path.join(output,'all-archived.png')});
    await card.getByRole('button',{name:'查看已归档的日子（4）',exact:true}).click();dialog=page.getByRole('dialog');
    const pick=dialog.locator('.hw-select').filter({has:page.locator('select[name="id"]')}).getByRole('button');
    await pick.click();await dialog.getByRole('listbox',{name:'选择要恢复的日子',exact:true}).locator('[data-value="event-project"]').click();
    await dialog.screenshot({path:path.join(output,'restore.png')});

    // A failed save leaves the archive and selection intact and allows retry.
    let fail=true;
    await page.route('**/api/io',route=>{
      const body=route.request().postDataJSON();
      if(fail&&body.action==='plugin-data-save')return route.fulfill({status:500,contentType:'application/json',body:JSON.stringify({error:'模拟归档恢复保存失败'})});
      return route.continue();
    });
    await dialog.getByRole('button',{name:'恢复显示',exact:true}).click();
    await dialog.getByRole('alert').filter({hasText:'模拟归档恢复保存失败'}).waitFor();
    assert.equal((await state()).pluginData.countdowns.events.filter(e=>e.archived).length,4);
    assert.equal(await dialog.getByRole('button',{name:'恢复显示',exact:true}).isEnabled(),true);
    fail=false;await dialog.getByRole('button',{name:'恢复显示',exact:true}).click();
    await card.getByRole('heading',{name:'项目里程碑',exact:true}).waitFor();
    await card.getByText('自动选择',{exact:true}).waitFor();
    assert.deepEqual((await state()).pluginData.countdowns.events.find(e=>e.id==='event-project'),before.find(e=>e.id==='event-project'));
    await page.reload();await card.getByRole('heading',{name:'项目里程碑',exact:true}).waitFor();
    await card.getByRole('button',{name:'查看已归档的日子（3）',exact:true}).waitFor();
    await card.getByRole('button',{name:'删除日期 项目里程碑',exact:true}).click();
    await page.getByRole('dialog').getByRole('button',{name:'删除日期',exact:true}).click();
    await card.getByText('添加一个值得期待的日子吧。',{exact:true}).waitFor();
    assert.equal((await state()).pluginData.countdowns.events.length,3);
    assert.deepEqual(errors,[]);
    console.log('Passed: archive/cancel/delete, persistence, singleton, pinned fallback, archive-all, restore/retry and narrow dialogs.');
  }catch(e){
    if(page){fs.mkdirSync(output,{recursive:true});await page.screenshot({path:path.join(output,'failure.png')});console.error(await page.locator('dialog[open]').allTextContents());}
    throw e;
  }finally{await browser?.close();server.kill();}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
