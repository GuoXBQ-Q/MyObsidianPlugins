// Optional browser validation. Uses an existing Playwright installation and browser.
// All edits are in memory; this harness never writes the vault's layout or notes.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require(process.env.HOME_WIDGETS_PLAYWRIGHT||'playwright');
const root=path.resolve(__dirname,'..'),vault=path.dirname(root);
const output=path.join(root,'preview','settings');fs.mkdirSync(output,{recursive:true});
function obsidianAsset(name){
  const file=(process.env.OBSIDIAN_ASAR||path.join(process.env.APPDATA,'obsidian',fs.readdirSync(path.join(process.env.APPDATA,'obsidian')).filter(n=>/^obsidian-.*\.asar$/.test(n)).sort().pop())),data=fs.readFileSync(file);
  const header=JSON.parse(data.subarray(16,16+data.readUInt32LE(12))),entry=header.files[name],start=8+data.readUInt32LE(4)+Number(entry.offset);
  return data.subarray(start,start+entry.size).toString('utf8');
}
async function main(){
  const browser=await chromium.launch({headless:true,...(process.env.HOME_WIDGETS_BROWSER?{executablePath:process.env.HOME_WIDGETS_BROWSER}:{})});
  try{
    const page=await browser.newPage({viewport:{width:820,height:980},deviceScaleFactor:1}),errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    await page.route('http://127.0.0.1/settings-test',route=>route.fulfill({contentType:'text/html',body:'<!doctype html>'}));await page.goto('http://127.0.0.1/settings-test');
    await page.setContent('<!doctype html><html><head><meta charset="utf-8"></head><body class="theme-light"><main id="frame"><div id="settings" class="vertical-tab-content"></div></main></body></html>');
    await page.addStyleTag({content:obsidianAsset('app.css')});
    await page.addStyleTag({content:fs.readFileSync(path.join(vault,'.obsidian/themes/AnuPpuccin/theme.css'),'utf8')});
    await page.addStyleTag({content:fs.readFileSync(path.join(root,'build/styles.css'),'utf8')});
    await page.addStyleTag({content:'html{overflow:auto}body{display:block;position:static;contain:none;overflow:auto;width:100%;height:auto;min-height:100vh;--interactive-accent:#df8c79;--interactive-accent-hover:#cf7968;font-family:"Segoe UI","Microsoft YaHei",sans-serif}#frame{max-width:820px;margin:auto;padding:30px 32px}#settings{padding:0;overflow:visible;width:100%;height:auto}.hw-set-panel{width:100%}'});
    await page.addScriptTag({content:obsidianAsset('enhance.js')});
    await page.addScriptTag({content:`
      class Component{constructor(){this.cleanups=[];}register(fn){this.cleanups.push(fn);}unload(){for(const fn of this.cleanups.splice(0).reverse())fn();}}
      class Plugin extends Component{constructor(app){super();this.app=app;}async loadData(){return {};}async saveData(){}registerEvent(){}registerMarkdownCodeBlockProcessor(){}addRibbonIcon(){}addCommand(){}addSettingTab(tab){this.settingsTab=tab;}}
      class PluginSettingTab{constructor(app){this.app=app;this.containerEl=document.getElementById('settings');}}
      class Setting{
        constructor(parent){this.settingEl=parent.createDiv('setting-item');this.infoEl=this.settingEl.createDiv('setting-item-info');this.nameEl=this.infoEl.createDiv('setting-item-name');this.descEl=this.infoEl.createDiv('setting-item-description');this.controlEl=this.settingEl.createDiv('setting-item-control');}
        setName(text){this.nameEl.textContent=text;return this;}setDesc(text){this.descEl.textContent=text;return this;}
        addText(fn){const input=this.controlEl.createEl('input',{type:'text'}),text={inputEl:input,setValue:v=>{input.value=v;return text;},getValue:()=>input.value,setPlaceholder:v=>{input.placeholder=v;return text;},setDisabled:v=>{input.disabled=v;return text;},onChange:f=>{input.oninput=()=>f(input.value);return text;}};fn(text);return this;}
        addButton(fn){const el=this.controlEl.createEl('button'),button={setButtonText:t=>{el.textContent=t;return button;},setDisabled:v=>{el.disabled=v;return button;},onClick:f=>{el.onclick=f;return button;}};fn(button);return this;}
        addDropdown(fn){const el=this.controlEl.createEl('select',{cls:'dropdown'}),dd={selectEl:el,addOption:(value,text)=>{el.createEl('option',{value,text});return dd;},setValue:v=>{el.value=v;return dd;},setDisabled:v=>{el.disabled=v;return dd;},onChange:f=>{el.onchange=()=>f(el.value);return dd;}};fn(dd);return this;}
      }
      const obsidian={Component,Plugin,PluginSettingTab,Setting,MarkdownRenderChild:Component,MarkdownRenderer:{},Notice:class{constructor(text){console.log(text);}},parseYaml:()=>({})};
      window.require=()=>obsidian;window.module={exports:{}};
    `});
    await page.addScriptTag({content:fs.readFileSync(path.join(root,'build/main.js'),'utf8')});
    const fixture=JSON.stringify({version:3,theme:'native',widgets:[
      {id:'banner',type:'banner',title:'Banner',span:12,hidden:true,settings:{}},
      ...['work','life','study'].map(area=>({id:'tasks-'+area,type:'tasks',title:area==='work'?'工作待办':area,span:4,height:380,settings:{source:'Home/tasks.md',area}})),
      {id:'calendar',type:'my-calendar',title:'Calendar',span:12,settings:{showLunar:true}}
    ]});
    await page.evaluate(async text=>{
      window.savedLayout=text;window.layoutReads=0;window.layoutWrites=0;
      window.plugin=new window.module.exports({plugins:{plugins:{dataview:{api:{}}}},vault:{on(){}},workspace:{openLinkText(){}}});
      await plugin.onload();plugin.io={read:async()=>{layoutReads++;return savedLayout;},update:async(p,fn)=>{layoutWrites++;savedLayout=fn(savedLayout);}};
      window.openWidgetCalls=[];plugin.openWidget=async id=>openWidgetCalls.push(id);window.disconnectCalendar=plugin.api.registerWidget({type:'my-calendar',label:'MyCalendar 日历',icon:'📅',span:12,defaults:{showLunar:true,showFestivals:true,showHolidays:true},fields:[{key:'showLunar',label:'显示农历',type:'checkbox'},{key:'showFestivals',label:'显示节日与节气',type:'checkbox'},{key:'showHolidays',label:'显示休/班角标',type:'checkbox'}],mount(){}},{pluginId:'my-calendar',pluginName:'MyCalendar'});
      plugin.settingsTab.display();
    },fixture);
    await page.getByRole('combobox',{name:'页面最大宽度',exact:true}).waitFor();
    await page.screenshot({path:path.join(output,'general-light.png'),fullPage:true});
    assert.equal(await page.evaluate(()=>layoutWrites),0);
    await page.getByRole('combobox',{name:'正文字号',exact:true}).selectOption('18');await page.getByRole('combobox',{name:'正文行距',exact:true}).selectOption('1.9');
    await page.getByRole('combobox',{name:'首页字体',exact:true}).selectOption('custom');
    await page.getByRole('textbox',{name:'自定义字体名称',exact:true}).fill('Microsoft YaHei');await page.getByRole('textbox',{name:'自定义字体名称',exact:true}).press('Tab');
    await page.waitForFunction(()=>JSON.parse(savedLayout).typography?.customFont==='Microsoft YaHei');
    assert.equal(await page.locator('.hw-font-preview').evaluate(el=>getComputedStyle(el).fontSize),'18px');
    assert.equal(await page.locator('.hw-font-preview').evaluate(el=>getComputedStyle(el).lineHeight),'34.2px');
    await page.evaluate(()=>{plugin.settingsTab.hide();plugin.settingsTab.display();});
    await page.waitForFunction(()=>document.querySelector('[aria-label="正文字号"]').value==='18');
    assert.equal(await page.getByRole('combobox',{name:'首页字体',exact:true}).inputValue(),'custom');
    assert.equal(await page.getByRole('textbox',{name:'自定义字体名称',exact:true}).inputValue(),'Microsoft YaHei');
    await page.screenshot({path:path.join(output,'typography-settings.png'),fullPage:true});
    await page.getByRole('button',{name:'恢复默认排版',exact:true}).click();await page.waitForFunction(()=>JSON.parse(savedLayout).typography===undefined);
    assert.equal(await page.getByRole('combobox',{name:'正文字号',exact:true}).inputValue(),'15');
    await page.getByRole('tab',{name:'内置组件',exact:true}).click();
    assert.equal(await page.getByRole('tab',{name:'MyCalendar 日历',exact:true}).count(),0);
    await page.getByRole('button',{name:'已添加 Banner',exact:true}).click();
    await page.getByRole('dialog').getByRole('button',{name:'恢复显示',exact:true}).click();
    await page.waitForFunction(()=>JSON.parse(savedLayout).widgets.find(w=>w.id==='banner').hidden===false);
    assert.equal(await page.evaluate(()=>JSON.parse(savedLayout).widgets.filter(w=>w.type==='banner').length),1);
    await page.getByRole('tab',{name:'分类待办',exact:true}).click();
    await page.getByRole('button',{name:'新增实例 分类待办',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'取消',exact:true}).click();
    assert.equal(await page.getByRole('switch').count(),3);
    await page.screenshot({path:path.join(output,'builtin-light.png'),fullPage:true});
    await page.getByRole('switch',{name:'在首页显示 工作待办',exact:true}).uncheck();
    await page.getByText('已隐藏 · 4 列 · 380px 高',{exact:true}).waitFor();
    await page.getByRole('switch',{name:'在首页显示 工作待办',exact:true}).check();
    await page.getByRole('tab',{name:'外部插件',exact:true}).click();
    await page.getByRole('tab',{name:'MyCalendar 日历',exact:true}).waitFor();
    await page.screenshot({path:path.join(output,'external-light.png'),fullPage:true});
    await page.getByRole('button',{name:'编辑 Calendar',exact:true}).click();
    await page.getByRole('dialog').waitFor();assert.equal(await page.getByRole('checkbox',{name:'显示农历',exact:true}).isChecked(),true);
    await page.getByRole('button',{name:'取消',exact:true}).click();assert.equal(await page.getByRole('dialog').count(),0);
    await page.evaluate(()=>{document.body.className='theme-dark';});
    await page.screenshot({path:path.join(output,'external-dark.png'),fullPage:true});
    await page.evaluate(()=>disconnectCalendar());
    await page.getByText('该组件的插件尚未连接。已有配置已保留；连接后可继续编辑组件专属设置。',{exact:true}).waitFor();
    await page.screenshot({path:path.join(output,'external-disconnected.png'),fullPage:true});
    assert.equal(await page.evaluate(()=>JSON.parse(savedLayout).widgets.filter(w=>w.type==='banner').length),1);
    for(const width of [390,820]){
      await page.setViewportSize({width,height:980});
      assert(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),'settings overflow at '+width);
    }
    assert.deepEqual(errors,[]);
    console.log(JSON.stringify({screenshots:output,checks:['builtin/external classification','visibility persistence','external editor open/close','disconnected configuration','light/dark themes','390/820px overflow'],pageErrors:errors}));
  }finally{await browser.close();}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
