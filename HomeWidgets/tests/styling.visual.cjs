// Actual MyCalendar widget + Home Widgets host; all data stays in memory.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require(process.env.HOME_WIDGETS_PLAYWRIGHT||'playwright');
const root=path.resolve(__dirname,'..'),vault=path.dirname(root),output=path.join(root,'preview','styling');fs.mkdirSync(output,{recursive:true});
const esbuild=require(path.join(vault,'MyCalendar/node_modules/esbuild'));
function asset(name){const data=fs.readFileSync(path.join(process.env.APPDATA,'obsidian/obsidian-1.14.4.asar')),header=JSON.parse(data.subarray(16,16+data.readUInt32LE(12))),entry=header.files[name],start=8+data.readUInt32LE(4)+Number(entry.offset);return data.subarray(start,start+entry.size).toString('utf8');}
async function main(){
 const calendar=await esbuild.build({entryPoints:[path.join(vault,'MyCalendar/src/widget.ts')],bundle:true,write:false,format:'iife',globalName:'MyCalendarWidget',platform:'browser',target:'es2020',external:['obsidian']});
 const browser=await chromium.launch({headless:true,...(process.env.HOME_WIDGETS_BROWSER?{executablePath:process.env.HOME_WIDGETS_BROWSER}:{})});
 try{
  const page=await browser.newPage({viewport:{width:1100,height:1100}}),errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.route('http://127.0.0.1/styling-test',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><html><head><meta charset="utf-8"></head><body class="theme-light"><main id="home"></main></body></html>'}));await page.goto('http://127.0.0.1/styling-test');
  await page.addStyleTag({content:asset('app.css')});await page.addStyleTag({content:fs.readFileSync(path.join(vault,'.obsidian/themes/AnuPpuccin/theme.css'),'utf8')});await page.addStyleTag({content:fs.readFileSync(path.join(root,'build/styles.css'),'utf8')});
  await page.addStyleTag({content:fs.readFileSync(path.join(vault,'.obsidian/snippets/home-widgets-custom.css'),'utf8')});
  await page.addStyleTag({content:'html{overflow:auto}body{display:block;position:static;contain:none;overflow:auto;width:100%;height:auto;min-height:100vh;padding:20px 12px;--interactive-accent:#df8c79;--interactive-accent-hover:#cf7968}'});
  await page.addScriptTag({content:asset('enhance.js')});
  await page.addScriptTag({content:`
    class Component{constructor(){this.cleanups=[];}register(fn){this.cleanups.push(fn);}load(){return this.onload?.();}unload(){for(const fn of this.cleanups.splice(0).reverse())fn();}}
    class Plugin extends Component{constructor(app){super();this.app=app;this.processors={};}async loadData(){return {};}registerEvent(){}registerMarkdownCodeBlockProcessor(name,fn){this.processors[name]=fn;}addRibbonIcon(){}addCommand(){}addSettingTab(){}}
    class MarkdownRenderChild extends Component{constructor(el){super();this.containerEl=el;}}
    const obsidian={Plugin,Component,MarkdownRenderChild,PluginSettingTab:class{},Modal:class{},Setting:class{},Notice:class{},MarkdownRenderer:{},parseYaml:()=>({})};
    window.require=()=>obsidian;window.module={exports:{}};
  `});
  await page.addScriptTag({content:fs.readFileSync(path.join(root,'build/main.js'),'utf8')});await page.addScriptTag({content:calendar.outputFiles[0].text});
  await page.evaluate(async()=>{
    const tasks=(id,title,area)=>({id,type:'tasks',title,span:6,height:260,tint:'plain',background:'',settings:{source:'Home/tasks.md',area,showCompleted:true,limit:20}});
    const calendar=(id,span)=>({id,type:'my-calendar',title:'Calendar',span,tint:'plain',background:'',settings:{showLunar:true,showFestivals:true,showHolidays:true}});
    window.files=new Map([['Home/widgets.json',JSON.stringify({version:2,theme:'native',widgets:[tasks('tasks-work','工作待办','work'),tasks('tasks-life','日常琐事','life'),calendar('calendar-primary',12),calendar('calendar-secondary',6),{id:'unframed',type:'unframed-example',title:'无边框组件',span:6,settings:{}}]})],['Home/tasks.md','- [ ] 工作事项 #area/work ^work\n- [ ] 生活事项 #area/life ^life\n']]);
    const app={plugins:{plugins:{}},vault:{on(){},getName:()=> 'styling-test',adapter:{read:async p=>files.get(p),exists:async p=>files.has(p)},getAbstractFileByPath:path=>({path}),process:async(file,fn)=>{files.set(file.path,fn(files.get(file.path)));}},workspace:{openLinkText(){}}};
    window.plugin=new module.exports(app);await plugin.onload();
    const calendarPlugin={app,events:[],settings:{weekStart:'monday'},onRefresh:()=>()=>{}};
    plugin.api.registerWidget(MyCalendarWidget.createMyCalendarWidget(calendarPlugin),{pluginId:'my-calendar',pluginName:'MyCalendar'});plugin.api.registerWidget({type:'unframed-example',label:'无边框组件',frameless:true,frame:'none',defaults:{},mount:ctx=>{ctx.el.textContent='使用显式无边框样式。';}},{pluginId:'frame-example',pluginName:'样式示例'});
    plugin.processors['home-widgets']('',document.getElementById('home'),{sourcePath:'homepage.md',addChild(child){window.render=child;child.load();}});await render.ready;
  });
  const work=page.locator('[data-widget-id="tasks-work"]'),life=page.locator('[data-widget-id="tasks-life"]'),first=page.locator('[data-widget-id="calendar-primary"]'),second=page.locator('[data-widget-id="calendar-secondary"]');
  await first.locator('.mcw-grid').waitFor();
  const frame=locator=>locator.evaluate(el=>{const style=getComputedStyle(el);return Object.fromEntries(['borderTopWidth','borderTopStyle','borderTopColor','borderRadius','boxShadow','backgroundColor'].map(key=>[key,style[key]]));});
  assert.deepEqual(await frame(first),await frame(work));assert.equal((await frame(first)).borderTopWidth,'1px');assert.equal(await first.locator('.hw-widget-header').isVisible(),false);
  const flat=await frame(page.locator('[data-widget-id="unframed"]'));assert.equal(flat.borderTopWidth,'0px');assert.equal(flat.boxShadow,'none');
  await page.getByRole('button',{name:'⠿ 编辑布局',exact:true}).click();await work.getByRole('button',{name:'设置工作待办',exact:true}).click();
  const dialog=page.getByRole('dialog'),classes=dialog.getByRole('textbox',{name:'CSS 样式类（可选）',exact:true});
  await page.evaluate(()=>{window.inputBeforeStyle=document.querySelector('[data-widget-id="tasks-work"] input');});
  await classes.fill('work-focus compact');await dialog.getByRole('button',{name:'保存',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('[data-widget-id="tasks-work"]').classList.contains('work-focus'));
  assert.equal(await work.getByRole('checkbox',{name:'工作事项',exact:true}).evaluate(el=>el===inputBeforeStyle),true);assert.equal(await life.evaluate(el=>el.classList.contains('work-focus')),false);
  assert.notEqual((await frame(work)).borderTopColor,(await frame(life)).borderTopColor);
  assert.equal(await page.evaluate(()=>Object.hasOwn(JSON.parse(files.get('Home/widgets.json')).widgets[0].settings,'cssClasses')),false);
  await page.screenshot({path:path.join(output,'instance-style.png'),fullPage:true});
  await work.getByRole('button',{name:'设置工作待办',exact:true}).click();assert.equal(await classes.inputValue(),'work-focus compact');await classes.fill('');await dialog.getByRole('button',{name:'保存',exact:true}).click();
  await page.waitForFunction(()=>!document.querySelector('[data-widget-id="tasks-work"]').classList.contains('work-focus'));assert.equal(await work.evaluate(el=>el.classList.contains('hw-fixed')),true);assert.deepEqual(await frame(work),await frame(life));
  await second.getByRole('button',{name:'设置Calendar',exact:true}).click();await classes.fill('soft-card');await dialog.getByRole('button',{name:'保存',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('[data-widget-id="calendar-secondary"]').classList.contains('soft-card'));assert.equal(await first.evaluate(el=>el.classList.contains('soft-card')),false);assert.notEqual((await frame(first)).borderRadius,(await frame(second)).borderRadius);
  await page.getByRole('button',{name:'✓ 完成编辑',exact:true}).click();
  const firstMonth=await first.locator('.mcw-title').textContent(),secondMonth=await second.locator('.mcw-title').textContent();await second.getByRole('button',{name:'›',exact:true}).click();assert.equal(await first.locator('.mcw-title').textContent(),firstMonth);assert.notEqual(await second.locator('.mcw-title').textContent(),secondMonth);
  await page.screenshot({path:path.join(output,'calendar-light.png'),fullPage:true});
  await page.evaluate(()=>{document.body.className='theme-dark';});assert.deepEqual(await frame(first),await frame(life));await page.screenshot({path:path.join(output,'calendar-dark.png'),fullPage:true});
  await page.setViewportSize({width:390,height:900});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:path.join(output,'calendar-narrow.png'),fullPage:true});
  assert.deepEqual(errors,[]);console.log(JSON.stringify({screenshots:output,checks:['real MyCalendar frame matches builtin cards','explicit borderless frame','instance CSS classes save and remove','styling keeps live task controls','same-type instances remain isolated','calendar navigation remains independent','light/dark and 390px layout'],pageErrors:errors}));
 }finally{await browser.close();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
