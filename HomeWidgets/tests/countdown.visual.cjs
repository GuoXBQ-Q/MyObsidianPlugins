// Optional browser integration checks against tests/countdown.preview.cjs.
// Start with HOME_WIDGETS_LAYOUT_PREVIEW=1; all dates and layouts stay in memory.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require(process.env.HOME_WIDGETS_PLAYWRIGHT||'playwright');
const output=path.resolve(__dirname,'../preview/countdown-pinning');
async function main(){
  const browser=await chromium.launch({headless:true,...(process.env.HOME_WIDGETS_BROWSER?{executablePath:process.env.HOME_WIDGETS_BROWSER}:{})});
  let page;
  try{
    page=await browser.newPage({viewport:{width:850,height:980}});const errors=[];
    page.setDefaultTimeout(5000);page.on('pageerror',e=>errors.push(e.message));
    await page.goto('http://127.0.0.1:8790');
    const card=page.locator('[data-widget-id="countdown"]');
    await card.getByRole('button',{name:'取消置顶 项目里程碑',exact:true}).waitFor();
    async function selectExisting(){
      await page.getByRole('button',{name:'＋ 添加组件',exact:true}).click();const form=page.getByRole('dialog');
      await form.locator('.hw-select').filter({has:page.locator('select[name="type"]')}).getByRole('button').click();
      await form.getByRole('option',{name:'倒计时（已添加）',exact:true}).click();await form.getByRole('button',{name:'下一步',exact:true}).click();
      await page.getByRole('heading',{name:'组件已添加',exact:true}).waitFor();
    }
    await selectExisting();await page.getByRole('dialog').getByRole('button',{name:'定位组件',exact:true}).click();
    assert.equal(await page.locator('[data-widget-type="countdown"]').count(),1);
    await page.getByRole('button',{name:'⠿ 编辑布局',exact:true}).click();await card.getByRole('button',{name:'隐藏值得期待的日子',exact:true}).click();await card.waitFor({state:'detached'});
    await selectExisting();await page.getByRole('dialog').getByRole('button',{name:'恢复显示',exact:true}).click();await card.waitFor();
    assert.equal(await page.locator('[data-widget-type="countdown"]').count(),1);
    await page.getByRole('button',{name:'✓ 完成编辑',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'不保存并退出',exact:true}).click();

    await card.getByRole('button',{name:'置顶日期 迎接新的一年',exact:true}).click();
    await card.getByRole('heading',{name:'迎接新的一年',exact:true}).waitFor();
    await page.reload();
    await card.getByRole('button',{name:'取消置顶 迎接新的一年',exact:true}).waitFor();

    // The settings selector retains the current pin and uses the unique list.
    await page.getByRole('button',{name:'⠿ 编辑布局',exact:true}).click();
    await card.getByRole('button',{name:'设置值得期待的日子',exact:true}).click();
    let dialog=page.getByRole('dialog');
    const pick=dialog.locator('.hw-select').filter({has:page.locator('select[name="featured"]')}).getByRole('button');
    await pick.getByText('迎接新的一年 · 2027-01-01',{exact:true}).waitFor();await pick.click();
    await dialog.getByRole('option',{name:'项目里程碑 · 2026-11-01',exact:true}).waitFor();
    await pick.press('Escape');
    await dialog.getByRole('button',{name:'保存',exact:true}).click();
    await card.getByRole('button',{name:'取消置顶 迎接新的一年',exact:true}).waitFor();
    await card.getByRole('button',{name:'设置值得期待的日子',exact:true}).click();
    dialog=page.getByRole('dialog');
    await pick.click();
    await dialog.getByRole('option',{name:'项目里程碑 · 2026-11-01',exact:true}).click();
    await dialog.getByRole('button',{name:'保存',exact:true}).click();
    await card.getByRole('button',{name:'取消置顶 项目里程碑',exact:true}).waitFor();
    await page.getByRole('button',{name:'✓ 完成编辑',exact:true}).click();
    await page.getByRole('dialog').getByRole('button',{name:'不保存并退出',exact:true}).click();
    await card.getByRole('button',{name:'取消置顶 迎接新的一年',exact:true}).waitFor();
    await card.getByRole('button',{name:'取消置顶 迎接新的一年',exact:true}).click();
    await card.getByText('自动选择',{exact:true}).waitFor();

    // Deleting a pinned date clears its reference in every affected instance.
    await card.getByRole('button',{name:'置顶日期 项目里程碑',exact:true}).click();
    await card.getByRole('button',{name:'取消置顶 项目里程碑',exact:true}).waitFor();
    await card.getByRole('button',{name:'删除日期 项目里程碑',exact:true}).click();
    await page.getByRole('dialog').getByRole('button',{name:'删除日期',exact:true}).click();
    await card.getByText('自动选择',{exact:true}).waitFor();
    const state=await (await page.request.get('http://127.0.0.1:8790/state')).json();
    assert(state.layout.widgets.every(w=>w.settings.featured===''));
    for(const title of ['留给自己的周末','迎接新的一年','已结束']){
      await card.getByRole('button',{name:'删除日期 '+title,exact:true}).click();
      await page.getByRole('dialog').getByRole('button',{name:'删除日期',exact:true}).click();
      await card.getByRole('button',{name:'删除日期 '+title,exact:true}).waitFor({state:'detached'});
    }
    await card.getByText('添加一个值得期待的日子吧。',{exact:true}).waitFor();
    for(const [title,date] of [['重新添加的日子','2027-03-01'],['另一个日子','2027-04-01']]){
      await card.getByRole('button',{name:'添加关键日期',exact:true}).click();dialog=page.getByRole('dialog');
      await dialog.getByRole('textbox',{name:'日期名称',exact:true}).fill(title);
      await dialog.getByLabel('目标日期',{exact:true}).fill(date);
      await dialog.getByRole('button',{name:'保存',exact:true}).click();
      await card.getByRole('button',{name:'置顶日期 '+title,exact:true}).waitFor();
    }
    await card.getByRole('button',{name:'置顶日期 另一个日子',exact:true}).click();
    await card.getByRole('button',{name:'取消置顶 另一个日子',exact:true}).waitFor();
    await page.reload();
    await card.getByRole('button',{name:'取消置顶 另一个日子',exact:true}).waitFor();

    fs.mkdirSync(output,{recursive:true});
    await card.screenshot({path:path.join(output,'pinned.png')});
    await page.setViewportSize({width:390,height:900});await page.getByRole('button',{name:'切换窄屏',exact:true}).click();
    const overflow=await card.evaluate(el=>{
      const body=el.querySelector('.hw-widget-body'),bounds=body.getBoundingClientRect();
      return [...el.querySelectorAll('.hw-countdown-hero,.hw-countdown-event-row')].some(n=>{const r=n.getBoundingClientRect();return r.left<bounds.left-1||r.right>bounds.right+1;})||body.scrollWidth>body.clientWidth+1;
    });assert.equal(overflow,false);
    await card.screenshot({path:path.join(output,'narrow.png')});
    await page.getByRole('button',{name:'切换深浅色',exact:true}).click();
    await card.screenshot({path:path.join(output,'dark.png')});
    assert.deepEqual(errors,[]);
    console.log('Passed: pin/unpin/reload, singleton persistence, add/locate/restore, settings selection, draft discard, shared deletion/empty/re-add, narrow layout.');
  }catch(e){
    fs.mkdirSync(output,{recursive:true});
    if(page){await page.screenshot({path:path.join(output,'failure.png')});console.error(await page.getByRole('dialog').allTextContents());}
    throw e;
  }finally{await browser.close();}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
