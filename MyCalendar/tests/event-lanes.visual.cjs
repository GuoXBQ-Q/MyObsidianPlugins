// Real renderers and Obsidian styles; all fixture changes stay in memory.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict'), esbuild = require('esbuild');
const { chromium } = require(process.env.MY_CALENDAR_PLAYWRIGHT || 'playwright');
const root = path.resolve(__dirname, '..'), output = path.join(root, 'build', 'event-lanes-preview');
function asset(name) {
 const dir = path.join(process.env.APPDATA, 'obsidian');
 const file = path.join(dir, fs.readdirSync(dir).filter(n => /^obsidian-.*\.asar$/.test(n)).sort().pop());
 const bytes = fs.readFileSync(file), header = JSON.parse(bytes.subarray(16, 16 + bytes.readUInt32LE(12)));
 const entry = header.files[name], start = 8 + bytes.readUInt32LE(4) + Number(entry.offset);
 return bytes.subarray(start, start + entry.size).toString('utf8');
}
const event = (id, title, date, endDate, color = 'blue', createdAt = 0) => ({ id, title, date, endDate, color, createdAt });
const fixtures = [
 event('conference', '中国软件大会', '2026-11-05', '2026-11-08'),
 event('inscrypt', 'Inscrypt 26', '2026-11-06', '2026-11-10', 'teal'),
 event('four', '11月4日 · 单日日程', '2026-11-04'),
 event('eleven', '11月11日 · 单日日程', '2026-11-11'),
 event('six', '11月6日 · 横条下方', '2026-11-06'),
 event('nine', '11月9日 · 补第一行', '2026-11-09'),
 event('ten', '11月10日 · 补第一行', '2026-11-10'),
];
(async () => {
 fs.mkdirSync(output, { recursive: true });
 const bundle = await esbuild.build({ entryPoints: [path.join(__dirname, 'calendar-preview.ts')], bundle: true, write: false, format: 'iife', platform: 'browser', alias: { obsidian: path.join(__dirname, 'preview-obsidian.ts') } });
 const browser = await chromium.launch({ headless: true, ...(process.env.MY_CALENDAR_BROWSER ? { executablePath: process.env.MY_CALENDAR_BROWSER } : {}) });
 try {
  const page = await browser.newPage({ viewport: { width: 1500, height: 1100 } }), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => route.abort());
  const buttons = ['theme', 'narrow', 'height-short', 'height-tall', 'height-auto', 'height-tests', 'alignment-tests', 'range-tests'].map(id => `<button id="${id}">${id}</button>`).join('');
  await page.setContent(`<!doctype html><html><head><meta charset="utf-8"></head><body class="theme-light"><nav hidden>${buttons}</nav><main><h2>MyCalendar 跨周固定行号与空位补排</h2><section id="calendar"></section><h2>首页日历组件</h2><section id="widget"></section><section id="stage"></section><div id="notice"></div><pre id="results"></pre></main></body></html>`);
  await page.addStyleTag({ content: asset('app.css') });
  await page.addStyleTag({ content: fs.readFileSync(path.join(root, '../.obsidian/themes/AnuPpuccin/theme.css'), 'utf8') });
  await page.addStyleTag({ content: fs.readFileSync(path.join(root, 'styles.css'), 'utf8') });
  await page.addStyleTag({ content: 'html{overflow:auto}body{display:block;position:static;contain:none;overflow:auto;min-height:100vh;height:auto;padding:16px;background:var(--background-primary)}main{max-width:1400px;margin:auto}#calendar{height:800px;min-height:220px}#widget{height:620px;padding:12px;border:1px solid var(--background-modifier-border)}h2{font-size:18px}' });
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  const setEvents = events => page.evaluate(value => calendarRangePreview.setEvents(value), events);
  const lanes = (host, id) => page.locator(`${host} [data-event-id="${id}"]`).evaluateAll(nodes => nodes.map(node => Number(node.dataset.eventLane)));
  const sameLane = async (host, id, expected) => {
   const values = await lanes(host, id);
   assert(values.length > 0 && values.every(value => value === expected), `${host} ${id}: expected all segments in lane ${expected}, got ${values}`);
  };
  const separated = async () => {
   const checks = await page.evaluate(() => [['#calendar', '.mc-chip'], ['#widget', '.mcw-chip']].map(([selector, chip]) => {
    const nodes = [...document.querySelector(selector).querySelectorAll(chip)];
    const collisions = [];
    for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) {
     const a = nodes[i].getBoundingClientRect(), b = nodes[j].getBoundingClientRect();
     if (a.width > 0 && b.width > 0 && a.right > b.left + 1 && b.right > a.left + 1 && a.bottom > b.top + 1 && b.bottom > a.top + 1) collisions.push([nodes[i].textContent, nodes[j].textContent]);
    }
    return { selector, collisions };
   }));
   for (const check of checks) assert.deepEqual(check.collisions, [], `${check.selector}: event chips must not overlap`);
  };

  await setEvents(fixtures);
  for (const weekStart of ['monday', 'sunday']) {
   await page.evaluate(value => { calendarRangePreview.setWeekStart(value); calendarRangePreview.setMonth(2026, 11); }, weekStart);
   for (const theme of ['light', 'dark']) for (const width of [1500, 420]) {
    await page.evaluate(value => { document.body.classList.remove('theme-light', 'theme-dark'); document.body.classList.add(`theme-${value}`); }, theme);
    await page.setViewportSize({ width, height: 1100 });
    for (const host of ['#calendar', '#widget']) {
     await sameLane(host, 'inscrypt', 1);
     for (const id of ['four', 'eleven', 'nine', 'ten']) await sameLane(host, id, 0);
     await sameLane(host, 'six', 2);
    }
    await separated();
    if (weekStart === 'monday') await page.screenshot({ path: path.join(output, `${theme}-${width}.png`), fullPage: true });
   }
  }
  await page.evaluate(() => { calendarRangePreview.setWeekStart('monday'); calendarRangePreview.setMonth(2026, 11); });
  const fill = event('fill', '新跨天事项 · 补第一行', '2026-11-09', '2026-11-11', 'purple', 100);
  await setEvents([...fixtures, fill]);
  for (const host of ['#calendar', '#widget']) { await sameLane(host, 'inscrypt', 1); await sameLane(host, 'fill', 0); await sameLane(host, 'nine', 2); }
  await separated();
  const blocked = event('blocked', '覆盖日期存在冲突', '2026-11-08', '2026-11-09', 'orange', 200);
  await setEvents([...fixtures, fill, blocked]);
  for (const host of ['#calendar', '#widget']) await sameLane(host, 'blocked', 2);
  await separated();
  await setEvents(fixtures.filter(item => item.id !== 'conference'));
  for (const host of ['#calendar', '#widget']) await sameLane(host, 'inscrypt', 0);

  const crowded = [...fixtures, ...Array.from({ length: 4 }, (_, i) => event(`extra-${i}`, `新增事项 ${i + 1}`, '2026-11-09', undefined, 'blue', 100 + i))];
  await setEvents(crowded);
  const caps = await page.evaluate(() => [['#calendar', '.mc-cell', '.mc-other-month', '.mc-daynum', '.mc-chips', '.mc-more'], ['#widget', '.mcw-cell', '.mcw-other', '.mcw-num', '.mcw-chips', '.mcw-more']].map(([selector, cell, other, num, chips, more]) => {
   const target = [...document.querySelector(selector).querySelectorAll(cell)].find(node => !node.matches(other) && node.querySelector(num).textContent === '9');
   return { selector, visible: target.querySelectorAll(`${chips} [data-event-id]`).length, more: target.querySelector(more).textContent, slots: [...target.querySelector(chips).children].map(node => Number(node.dataset.eventLane)) };
  }));
  assert.deepEqual(caps.map(item => [item.visible, item.more, item.slots]), [[3, '还有 2 项…', [0, 2, 3, 4]], [2, '还有 3 项…', [0, 2, 3]]]);
  await separated();

  const acrossMonths = [event('anchor', '上方跨月事项', '2026-10-28', '2026-11-02'), event('long', '跨三个月保持第二行', '2026-10-30', '2026-12-03', 'teal')];
  await setEvents(acrossMonths);
  for (const month of [10, 11, 12, 11]) {
   await page.evaluate(value => calendarRangePreview.setMonth(2026, value), month);
   for (const host of ['#calendar', '#widget']) await sameLane(host, 'long', 1);
  }
  await setEvents(JSON.parse(JSON.stringify(acrossMonths)));
  for (const host of ['#calendar', '#widget']) await sameLane(host, 'long', 1);

  const highLanes = Array.from({ length: 7 }, (_, i) => event(`high-${i}`, `重叠横条 ${i + 1}`, '2026-11-05', '2026-11-10', 'blue', i));
  await setEvents([...highLanes, event('under-high', '最下方单日事项', '2026-11-09')]);
  const unclipped = await page.evaluate(() => [['#calendar', '.mc-cell', '.mc-other-month', '.mc-daynum'], ['#widget', '.mcw-cell', '.mcw-other', '.mcw-num']].map(([selector, cell, other, num]) => {
   const target = [...document.querySelector(selector).querySelectorAll(cell)].find(node => !node.matches(other) && node.querySelector(num).textContent === '9');
   const bounds = target.getBoundingClientRect(), single = target.querySelector('[data-event-id="under-high"]').getBoundingClientRect();
   const range = document.querySelector(`${selector} [data-event-id="high-6"].${selector === '#calendar' ? 'mc-range-bar' : 'mcw-range-bar'}`).getBoundingClientRect();
   return { selector, fits: single.bottom <= bounds.bottom + 1 && range.height > 0 && single.height > 0 };
  }));
  for (const item of unclipped) assert(item.fits, `${item.selector}: high lanes must remain visible inside expanded cells`);
  await separated();

  await setEvents(fixtures);
  await page.evaluate(() => calendarRangePreview.setMonth(2026, 11));
  for (const mode of ['week', 'day']) {
   await page.evaluate(value => calendarRangePreview.show('2026-11-09', value), mode);
   const top = await page.locator('#calendar .mc-range-bar[data-event-id="inscrypt"]').evaluate(node => parseFloat(node.style.marginTop));
   assert.equal(top, 4, `${mode}: all-day range should compact to the first row`);
  }
  await page.evaluate(() => calendarRangePreview.show('2026-11-11', 'week'));
  const plainDayGap = await page.locator('#calendar .mc-allday-cell').evaluateAll(cells => Math.min(...cells.filter(cell => cell.querySelector('[data-event-id="eleven"]')).map(cell => cell.querySelector('[data-event-id="eleven"]').getBoundingClientRect().top - cell.getBoundingClientRect().top)));
  assert(plainDayGap <= 6, 'day without ranges starts at the first row in week view');
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ output, checks: ['cross-week and cross-month lanes stay stable', 'single and multi-day additions fill free upper rows', 'whole-range conflicts avoid occupied lanes', 'deletion compacts all segments together', '3/2 single-event limits and more indicators reuse free rows', 'seven overlapping ranges remain visible', 'day/week all-day rows remain compact', 'Monday/Sunday week starts, light/dark themes at 1500px/420px'], pageErrors: errors }));
 } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
