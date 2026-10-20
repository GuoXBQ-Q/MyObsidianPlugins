// Optional desktop browser verification. All requests and installations stay in memory.
// UPDATER_PLAYWRIGHT and UPDATER_BROWSER may point to existing local installations.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), assert = require('node:assert/strict');
const {chromium} = require(process.env.UPDATER_PLAYWRIGHT || 'playwright');
const {archive, pluginFiles, releaseFor, digest} = require('./fixtures.cjs');
const root = path.resolve(__dirname, '../..');
const output = process.env.UPDATER_PREVIEW_DIR || path.join(os.tmpdir(), 'obsidian-updater-preview');
function obsidianAsset(name) {
  const directory = path.join(process.env.APPDATA, 'obsidian');
  const file = process.env.OBSIDIAN_ASAR || path.join(directory, fs.readdirSync(directory).filter(n => /^obsidian-.*\.asar$/.test(n)).sort().pop());
  const data = fs.readFileSync(file), header = JSON.parse(data.subarray(16, 16 + data.readUInt32LE(12)));
  const entry = header.files[name], start = 8 + data.readUInt32LE(4) + Number(entry.offset);
  return data.subarray(start, start + entry.size).toString('utf8');
}
function runtime() {
  const modules = ['update-format', 'update-controller', 'plugin-updater'].map(name =>
    `${JSON.stringify('./' + name)}:function(module,exports,require){\n${fs.readFileSync(path.join(root, 'shared', name + '.js'), 'utf8')}\n}`);
  return `const modules={${modules.join(',')}},cache={};
    function load(name){if(cache[name])return cache[name].exports;
      if(name==='./update-files'||name==='./update-zip')return {};
      if(!modules[name])throw new Error('Unexpected module '+name);
      const m=cache[name]={exports:{}};modules[name](m,m.exports,load);return m.exports;}
    window.UpdateController=load('./update-controller').UpdateController;
    window.renderUpdateSettings=load('./plugin-updater').renderUpdateSettings;`;
}
async function main() {
  fs.mkdirSync(output, {recursive:true});
  const browser = await chromium.launch({headless:true, ...(process.env.UPDATER_BROWSER ? {executablePath:process.env.UPDATER_BROWSER} : {})});
  try {
    const page = await browser.newPage({viewport:{width:820,height:1100}, deviceScaleFactor:1}), errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.setContent('<!doctype html><html><head><meta charset="utf-8"></head><body class="theme-light"><main><section id="home" class="hw-settings"><h2>Home Widgets</h2></section><section id="calendar"><h2>MyCalendar 日历设置</h2></section></main></body></html>');
    await page.addStyleTag({content:obsidianAsset('app.css')});
    for (const plugin of ['HomeWidgets','MyCalendar']) await page.addStyleTag({content:fs.readFileSync(path.join(root, plugin, 'build/styles.css'), 'utf8')});
    await page.addStyleTag({content:'html{overflow:auto}body{display:block;position:static;contain:none;overflow:auto;height:auto;min-height:100vh;font-family:"Segoe UI","Microsoft YaHei",sans-serif}main{max-width:820px;margin:auto;padding:24px}h2{font-size:20px}.modal-container{position:fixed;inset:0;background:#0005;display:flex;align-items:center;justify-content:center}.modal{max-width:calc(100vw - 40px);width:480px}.modal-content{padding:24px}.plugin-update-auto .setting-item-info{flex:1}'});
    await page.addScriptTag({content:obsidianAsset('enhance.js')});
    await page.addScriptTag({content:`
      class Setting {
        constructor(parent){this.settingEl=parent.createDiv('setting-item');this.infoEl=this.settingEl.createDiv('setting-item-info');this.nameEl=this.infoEl.createDiv('setting-item-name');this.descEl=this.infoEl.createDiv('setting-item-description');this.controlEl=this.settingEl.createDiv('setting-item-control');}
        setName(v){this.nameEl.textContent=v;return this;}setDesc(v){this.descEl.textContent=v;return this;}
        addToggle(fn){const el=this.controlEl.createDiv('checkbox-container');el.setAttribute('role','switch');el.tabIndex=0;
          let value=false,changed=()=>{};const toggle={toggleEl:el,setValue(v){value=v;el.classList.toggle('is-enabled',v);el.setAttribute('aria-checked',String(v));return toggle;},setDisabled(v){el.setAttribute('aria-disabled',String(v));return toggle;},onChange(f){changed=f;return toggle;}};
          const click=()=>{if(el.getAttribute('aria-disabled')!=='true'){toggle.setValue(!value);changed(value);}};
          el.onclick=click;el.onkeydown=e=>{if(e.key===' '){e.preventDefault();click();}};fn(toggle);return this;}
      }
      const app={preview:true};
      class Modal {
        constructor(received){if(received!==app)throw new Error('Modal requires the plugin app');this.containerEl=document.createElement('div');this.containerEl.className='modal-container';const modal=this.containerEl.createDiv('modal');modal.setAttribute('role','dialog');modal.setAttribute('aria-modal','true');this.contentEl=modal.createDiv('modal-content');}
        open(){document.body.append(this.containerEl);this.onOpen();this.escape=e=>{if(e.key==='Escape')this.close();};document.addEventListener('keydown',this.escape);}
        close(){document.removeEventListener('keydown',this.escape);this.containerEl.remove();this.onClose();}
      }
      function setIcon(el,name){const paths={package:'M12 3 3 8v9l9 5 9-5V8Z M3 8l9 5 9-5 M12 13v9',cloud:'M6 18a4 4 0 0 1-1-8 7 7 0 0 1 13-1 5 5 0 0 1 0 9Z',download:'M12 3v12 m-5-5 5 5 5-5 M4 16v5h16v-5','external-link':'M14 3h7v7 M21 3 10 14 M10 4H4v16h16v-6','refresh-cw':'M20 8a8 8 0 1 0 0 8 M20 3v5h-5','loader-circle':'M20 12a8 8 0 1 1-8-8','circle-check':'M9 12l2 2 4-4','circle-alert':'M12 7v6 M12 16v1','circle-arrow-up':'M12 17V7 M8 11l4-4 4 4','notebook-text':'M5 3h14v18H5Z M8 8h8 M8 12h8 M8 16h5',x:'m6 6 12 12 M6 18 18 6'};
        paths['hard-drive']='M5 5h14l3 9v5H2v-5Z M2 14h20 M6 17h.01 M10 17h.01';
        paths['cloud-download']='M7 17a5 5 0 1 1 .7-9.95A7 7 0 0 1 21 10a4 4 0 0 1-4 7 M12 12v9 m-4-4 4 4 4-4';
        el.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">'+(name.startsWith('circle-')?'<circle cx="12" cy="12" r="9"/>':'')+'<path d="'+(paths[name]||paths['refresh-cw'])+'"/></svg>';}
      window.obsidian={Setting,Modal,setIcon};window.previewApp=app;
    `});
    await page.addScriptTag({content:runtime()});
    const data = ['home-widgets','my-calendar'].map(id => {
      const files = pluginFiles(id,'0.3.0'), zip = archive(files), release = releaseFor(id,'0.3.0','1.5.0',zip);
      release.body = release.body.replace('notes','修复已知问题，提升稳定性。\n<script>window.unsafe=true</script>');
      return {id,release,bytes:[...zip],digest:digest(zip),files:Object.fromEntries(Object.entries(files).map(([name,bytes])=>[name,[...bytes]]))};
    });
    await page.evaluate(async data => {
      window.fixtures = [];
      for (const [index, input] of data.entries()) {
        const f = {input, mode:'equal', downloads:0, installs:0, notices:[], held:null};
        const controller = f.controller = new UpdateController({id:input.id,version:'0.2.1',appVersion:'1.8.0',
          io:{initialize:async()=>({installed:{id:input.id,version:'0.2.1'}}),saveState:async()=>{},install:async()=>{f.installs++;}},
          request:async params=>{if(!params.url.endsWith('/latest')){f.downloads++;return {status:200,arrayBuffer:Uint8Array.from(input.bytes).buffer};}
            if(f.mode==='held')return new Promise(resolve=>{f.held=resolve;});
            if(f.mode==='error')return {status:500};
            const release=JSON.parse(JSON.stringify(input.release));if(f.mode==='equal'){const old=release.body;release.body=old.replace('"version":"0.3.0"','"version":"0.2.1"');}return {status:200,json:release};},
          digest:async()=>input.digest,unpack:async()=>Object.fromEntries(Object.entries(input.files).map(([n,b])=>[n,Uint8Array.from(b)])),notify:m=>f.notices.push(m)});
        controller.pluginApp=previewApp;await controller.initialize(false);controller.ready=Promise.resolve();
        f.dispose=renderUpdateSettings(document.getElementById(index?'calendar':'home'),controller,obsidian);
        fixtures.push(f);await controller.check(false);
      }
    },data);
    for (const id of ['home','calendar']) {
      const card = page.locator('#'+id);
      assert.equal(await card.getByRole('status').innerText(),'已是最新版本');
      assert.equal(await card.getByRole('button',{name:'下载并安装',exact:true}).isDisabled(),true);
      assert.equal(await card.locator('details').isVisible(),false);
    }
    await page.screenshot({path:path.join(output,'latest-light.png'),fullPage:true});
    await page.evaluate(async()=>{for(const f of fixtures){f.mode='new';await f.controller.check(false);}});
    assert.equal(await page.evaluate(()=>fixtures.reduce((n,f)=>n+f.downloads,0)),0);
    assert.equal(await page.evaluate(()=>window.unsafe),undefined);
    await page.evaluate(()=>fixtures.forEach(f=>{
      f.input.release.body=f.input.release.body.replace('\n<script>window.unsafe=true</script>','');
      f.controller.candidate.notes='修复已知问题，提升稳定性。';f.controller.emit();
    }));
    await page.screenshot({path:path.join(output,'available-light.png'),fullPage:true});
    const home = page.locator('#home'), calendar = page.locator('#calendar');
    await home.getByRole('button',{name:'下载并安装',exact:true}).click();
    assert.equal(await page.getByRole('dialog').count(),1);
    assert.equal(await page.evaluate(()=>fixtures[0].downloads),0);
    await page.screenshot({path:path.join(output,'confirm.png'),fullPage:true});
    await page.getByRole('button',{name:'取消',exact:true}).click();
    assert.equal(await page.evaluate(()=>fixtures[0].downloads),0);
    await calendar.getByRole('button',{name:'下载并安装',exact:true}).click();
    await page.getByRole('button',{name:'确认安装',exact:true}).click();
    await calendar.getByRole('button',{name:'已安装，待重启',exact:true}).waitFor();
    assert.equal(await page.evaluate(()=>fixtures[1].installs),1);
    await page.evaluate(async()=>{await fixtures[1].controller.install();await fixtures[1].controller.check();});
    assert.equal(await page.evaluate(()=>fixtures[1].downloads),1);
    await home.getByRole('button',{name:'下载并安装',exact:true}).click();
    await page.evaluate(async()=>{fixtures[0].mode='error';await fixtures[0].controller.check(false);});
    await page.getByRole('button',{name:'确认安装',exact:true}).click();
    assert.equal(await page.evaluate(()=>fixtures[0].downloads),0); // A stale confirmation cannot install.
    assert.equal(await home.getByRole('status').innerText(),'检查失败');
    assert.equal(await home.getByText('最新版本（上次结果）',{exact:true}).isVisible(),true);
    await page.screenshot({path:path.join(output,'failure-and-restart.png'),fullPage:true});
    await page.evaluate(()=>{fixtures[0].mode='held';});
    await home.getByRole('button',{name:'重试',exact:true}).click();
    assert.equal(await home.getByRole('status').innerText(),'检查中…');
    assert.equal(await home.getByRole('button',{name:'下载并安装',exact:true}).isDisabled(),true);
    await page.screenshot({path:path.join(output,'checking.png'),fullPage:true});
    await page.evaluate(()=>{fixtures[0].held({status:200,json:fixtures[0].input.release});});
    await home.getByRole('button',{name:'下载并安装',exact:true}).waitFor({state:'visible'});
    await page.waitForFunction(()=>fixtures[0].controller.canInstall);
    await home.getByRole('switch',{name:'自动检查更新',exact:true}).click();
    assert.equal(await home.getByRole('switch').getAttribute('aria-checked'),'false');
    await page.evaluate(()=>{fixtures[0].mode='new';});
    await home.getByRole('button',{name:'检查更新',exact:true}).click();
    await page.waitForFunction(()=>!fixtures[0].controller.busy);
    await page.evaluate(()=>{document.body.className='theme-dark';});
    await page.screenshot({path:path.join(output,'available-dark.png'),fullPage:true});
    for (const width of [390,560]) {
      await page.setViewportSize({width,height:1100});
      assert(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),'overflow at '+width);
      assert(await page.locator('.plugin-update-auto').evaluateAll(rows=>rows.every(row=>
        row.getBoundingClientRect().height<180 && row.querySelector('.setting-item-info').getBoundingClientRect().width>120)), 'toggle row squeezed at '+width);
      await page.screenshot({path:path.join(output,'narrow-'+width+'.png'),fullPage:true});
    }
    await home.getByRole('button',{name:'下载并安装',exact:true}).click();
    await page.evaluate(()=>fixtures[0].dispose());
    assert.equal(await page.getByRole('dialog').count(),0);
    await page.evaluate(()=>fixtures.forEach(f=>{f.dispose();f.controller.dispose();}));
    assert.deepEqual(errors,[]);
    console.log(JSON.stringify({output,checks:['both plugin styles','latest/new/checking/error/restart states','confirmation/cancel/stale confirmation','no automatic downloads','manual check with auto disabled','view disposal closes modal','390/560px overflow','light/dark'],pageErrors:errors}));
  } finally { await browser.close(); }
}
main().catch(e=>{console.error(e);process.exitCode=1;});
