// Real renderers and Obsidian styles, with synthetic events kept entirely in memory.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),esbuild=require('esbuild');
const {chromium}=require(process.env.MY_CALENDAR_PLAYWRIGHT||'playwright');
const root=path.resolve(__dirname,'..'),output=path.join(root,'build','event-lanes-preview');
function asset(name){const dir=path.join(process.env.APPDATA,'obsidian'),file=path.join(dir,fs.readdirSync(dir).filter(n=>/^obsidian-.*\.asar$/.test(n)).sort().pop());const bytes=fs.readFileSync(file),header=JSON.parse(bytes.subarray(16,16+bytes.readUInt32LE(12))),entry=header.files[name],start=8+bytes.readUInt32LE(4)+Number(entry.offset);return bytes.subarray(start,start+entry.size).toString('utf8');}
const event=(id,title,date,endDate,color='blue')=>({id,title,date,endDate,color,createdAt:0});
const fixtures=[event('conference','中国软件大会','2026-11-05','2026-11-08'),event('inscrypt','Inscrypt 26','2026-11-06','2026-11-10','teal'),event('four','11月4日 · 单日日程','2026-11-04'),event('eleven','11月11日 · 单日日程','2026-11-11'),event('six','11月6日 · 横条下方','2026-11-06'),event('ten','11月10日 · 横条下方','2026-11-10')];
(async()=>{
 fs.mkdirSync(output,{recursive:true});const bundle=await esbuild.build({entryPoints:[path.join(__dirname,'calendar-preview.ts')],bundle:true,write:false,format:'iife',platform:'browser',alias:{obsidian:path.join(__dirname,'preview-obsidian.ts')}});
 const browser=await chromium.launch({headless:true,...(process.env.MY_CALENDAR_BROWSER?{executablePath:process.env.MY_CALENDAR_BROWSER}:{})});
 try{
  const page=await browser.newPage({viewport:{width:1500,height:1100}}),errors=[];page.on('pageerror',error=>errors.push(error.message));await page.route('**/*',route=>route.abort());
  const buttons=['theme','narrow','height-short','height-tall','height-auto','height-tests','alignment-tests','range-tests'].map(id=>`<button id="${id}">${id}</button>`).join('');
  await page.setContent(`<!doctype html><html><head><meta charset="utf-8"></head><body class="theme-light"><nav hidden>${buttons}</nav><main><h2>MyCalendar 月历</h2><section id="calendar"></section><h2>首页日历组件</h2><section id="widget"></section><section id="stage"></section><div id="notice"></div><pre id="results"></pre></main></body></html>`);
  await page.addStyleTag({content:asset('app.css')});await page.addStyleTag({content:fs.readFileSync(path.join(root,'../.obsidian/themes/AnuPpuccin/theme.css'),'utf8')});await page.addStyleTag({content:fs.readFileSync(path.join(root,'styles.css'),'utf8')});
  await page.addStyleTag({content:'html{overflow:auto}body{display:block;position:static;contain:none;overflow:auto;min-height:100vh;height:auto;padding:16px;background:var(--background-primary)}main{max-width:1400px;margin:auto}#calendar{height:800px;min-height:220px}#widget{height:620px;padding:12px;border:1px solid var(--background-modifier-border)}h2{font-size:18px}'});
  await page.addScriptTag({content:bundle.outputFiles[0].text});await page.evaluate(events=>calendarRangePreview.setEvents(events),fixtures);
  for(const weekStart of ['monday','sunday']){
   await page.evaluate(value=>{calendarRangePreview.setWeekStart(value);calendarRangePreview.show('2026-11-06','month');},weekStart);
   for(const width of [1500,420]){
    await page.setViewportSize({width,height:1100});
    const results=await page.evaluate(()=>{
     return [['#calendar','.mc-cell','.mc-other-month','.mc-daynum','.mc-cell-top','.mc-chip','.mc-range-bar'],['#widget','.mcw-cell','.mcw-other','.mcw-num','.mcw-top','.mcw-chip','.mcw-range-bar']].map(([selector,cell,other,num,top,chip,bar])=>{
      const root=document.querySelector(selector),cells=[...root.querySelectorAll(cell)].filter(el=>!el.matches(other)),at=day=>cells.find(el=>el.querySelector(num).textContent===String(day));
      const gaps=[4,11].map(day=>{const target=at(day);return target.querySelector(chip).getBoundingClientRect().top-target.querySelector(top).getBoundingClientRect().bottom;});
      const overlap=[6,10].map(day=>{const target=at(day),box=target.getBoundingClientRect(),single=target.querySelector(chip).getBoundingClientRect();return [...root.querySelectorAll(bar)].every(el=>{const range=el.getBoundingClientRect();return range.right<=box.left||range.left>=box.right||range.bottom<=box.top||range.top>=box.bottom||single.top>=range.bottom-1;});});
      return {selector,gaps,overlap,bars:root.querySelectorAll(bar).length};
     });
    });
    for(const result of results){assert(result.gaps.every(gap=>gap>=0&&gap<=4),`${result.selector}: singles must start at first line (${weekStart}, ${width}px): ${result.gaps}`);assert(result.overlap.every(Boolean),`${result.selector}: singles must not overlap range bars`);assert.equal(result.bars,weekStart==='monday'?3:4);}
    if(weekStart==='monday')await page.screenshot({path:path.join(output,`month-${width}.png`),fullPage:true});
   }
   for(const date of ['2026-11-04','2026-11-11']){
    await page.evaluate(value=>calendarRangePreview.show(value,'week'),date);
    const gaps=await page.evaluate(day=>{const cells=[...document.querySelectorAll('#calendar .mc-allday-cell')],heads=[...document.querySelectorAll('#calendar .mc-week-head-cell')],index=heads.findIndex(el=>el.textContent.includes(String(day)));const cell=cells[index];return cell.querySelector('.mc-chip').getBoundingClientRect().top-cell.getBoundingClientRect().top;},Number(date.slice(-2)));
    assert(gaps<=6,`week all-day entry must start at first line for ${date} (${weekStart}): ${gaps}`);
   }
  }
  assert.deepEqual(errors,[]);console.log(JSON.stringify({output,checks:['November 4 and 11 occupy the first line','range bars remain continuous and do not overlap singles','native month, week and homepage calendar','Monday and Sunday week starts','1500px and 420px layouts'],pageErrors:errors}));
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
