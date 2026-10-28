// Real renderers and Obsidian styles; completion fixtures never touch vault data.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict'), esbuild = require('esbuild');
const { chromium } = require(process.env.MY_CALENDAR_PLAYWRIGHT || 'playwright');
const root = path.resolve(__dirname, '..'), output = path.join(root, 'build', 'event-completion-preview');
function asset(name) {
 const dir = path.join(process.env.APPDATA, 'obsidian');
 const file = path.join(dir, fs.readdirSync(dir).filter(n => /^obsidian-.*\.asar$/.test(n)).sort().pop());
 const bytes = fs.readFileSync(file), header = JSON.parse(bytes.subarray(16, 16 + bytes.readUInt32LE(12)));
 const entry = header.files[name], start = 8 + bytes.readUInt32LE(4) + Number(entry.offset);
 return bytes.subarray(start, start + entry.size).toString('utf8');
}
const event = (id, title, extra = {}) => ({ id, title, date: '2026-11-06', color: 'blue', createdAt: 0, ...extra });
const fixtures = [
 event('range', '跨周会议', { endDate: '2026-11-09', color: 'purple' }),
 event('all-day', '整理会议资料', { important: true }),
 event('timed', '项目同步', { startTime: '10:00', endTime: '11:00' }),
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
  await page.setContent(`<!doctype html><html><head><meta charset="utf-8"></head><body class="theme-light"><nav hidden>${buttons}</nav><main><h2>MyCalendar 日程完成状态</h2><section id="calendar"></section><h2>首页日历组件</h2><section id="widget"></section><section id="stage"></section><div id="notice"></div><pre id="results"></pre></main></body></html>`);
  await page.addStyleTag({ content: asset('app.css') });
  await page.addStyleTag({ content: fs.readFileSync(path.join(root, '../.obsidian/themes/AnuPpuccin/theme.css'), 'utf8') });
  await page.addStyleTag({ content: fs.readFileSync(path.join(root, 'styles.css'), 'utf8') });
  await page.addStyleTag({ content: 'html{overflow:auto}body{display:block;position:static;contain:none;overflow:auto;min-height:100vh;height:auto;padding:16px;background:var(--background-primary)}main{max-width:1400px;margin:auto}#calendar{height:700px;min-height:220px}#widget{height:550px;padding:12px;border:1px solid var(--background-modifier-border)}h2{font-size:18px}#stage .modal{position:static;max-width:720px;width:100%;max-height:none}#stage .modal-content{overflow:visible}' });
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  await page.evaluate(events => calendarRangePreview.setEvents(events), fixtures);
  const entry = (host, id) => page.locator(`${host} [data-event-id="${id}"]`);
  const noEditor = async () => assert.equal(await page.locator('.mc-modal').count(), 0, 'ring must not open editor or add modal');
  const allPressed = async (host, id, completed) => {
   const values = await entry(host, id).locator('button').evaluateAll(buttons => buttons.map(button => button.getAttribute('aria-pressed')));
   assert(values.length > 0 && values.every(value => value === String(completed)), `${host} ${id}: all rendered segments agree`);
  };
  const strike = async (host, id, selector) => {
   const styles = await entry(host, id).locator(selector).evaluateAll(nodes => nodes.map(node => ({ strike: getComputedStyle(node).textDecorationLine, color: getComputedStyle(node).color, ring: getComputedStyle(node.parentElement.querySelector('button')).color })));
   assert(styles.length > 0 && styles.every(style => style.strike.includes('line-through') && style.color === style.ring), `${host} ${id}: completed text is grey and struck through`);
  };

  await entry('#calendar', 'all-day').getByRole('button', { name: '标记完成：整理会议资料', exact: true }).click();
  await allPressed('#calendar', 'all-day', true); await allPressed('#widget', 'all-day', true);
  await strike('#calendar', 'all-day', '.mc-chip-title'); await strike('#widget', 'all-day', '.mcw-name'); await noEditor();
  await entry('#widget', 'all-day').getByRole('button', { name: '标记未完成：整理会议资料', exact: true }).click();
  await allPressed('#calendar', 'all-day', false); await allPressed('#widget', 'all-day', false); await noEditor();
  assert.equal(await entry('#calendar', 'all-day').locator('.mc-chip-title').evaluate(node => getComputedStyle(node).textDecorationLine), 'none');

  assert.equal(await entry('#calendar', 'range').count(), 2);
  await entry('#calendar', 'range').first().getByRole('button', { name: '标记完成：跨周会议', exact: true }).click();
  await allPressed('#calendar', 'range', true); await allPressed('#widget', 'range', true); await noEditor();
  await strike('#calendar', 'range', '.mc-chip-title'); await strike('#widget', 'range', '.mcw-name');
  await entry('#widget', 'range').last().getByRole('button', { name: '标记未完成：跨周会议', exact: true }).click();
  await allPressed('#calendar', 'range', false); await allPressed('#widget', 'range', false); await noEditor();

  await page.evaluate(() => calendarRangePreview.show('2026-11-06', 'day'));
  await entry('#calendar', 'timed').getByRole('button', { name: '标记完成：项目同步', exact: true }).press('Space');
  await allPressed('#calendar', 'timed', true); await allPressed('#widget', 'timed', true);
  await strike('#calendar', 'timed', '.mc-tb-title'); await noEditor();
  await page.evaluate(() => calendarRangePreview.show('2026-11-06', 'week'));
  await allPressed('#calendar', 'timed', true); await strike('#calendar', 'timed', '.mc-tb-title');
  await page.evaluate(() => calendarRangePreview.show('2026-11-06', 'agenda'));
  await allPressed('#calendar', 'timed', true); await strike('#calendar', 'timed', '.mc-agenda-title');
  await entry('#calendar', 'timed').getByRole('button', { name: '标记未完成：项目同步', exact: true }).click();
  await allPressed('#calendar', 'timed', false); await allPressed('#widget', 'timed', false); await noEditor();

  await page.evaluate(() => calendarRangePreview.setCompletionError('模拟保存失败'));
  await entry('#calendar', 'all-day').getByRole('button', { name: '标记完成：整理会议资料', exact: true }).click();
  await page.getByText('模拟保存失败', { exact: true }).waitFor();
  await allPressed('#calendar', 'all-day', false); await allPressed('#widget', 'all-day', false);
  assert(await entry('#calendar', 'all-day').getByRole('button', { name: '标记完成：整理会议资料', exact: true }).isEnabled()); await noEditor();
  await page.evaluate(() => { calendarRangePreview.setCompletionError(null); document.getElementById('notice').textContent = ''; });

  await entry('#calendar', 'all-day').getByRole('button', { name: '标记完成：整理会议资料', exact: true }).click();
  await entry('#calendar', 'all-day').locator('.mc-agenda-title').click();
  await page.getByPlaceholder('日程标题…').fill('整理会议资料（已更新）');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await page.locator('.mc-modal').waitFor({ state: 'detached' });
  await allPressed('#calendar', 'all-day', true); await allPressed('#widget', 'all-day', true);
  const saved = await page.evaluate(() => calendarRangePreview.getEvents().find(event => event.id === 'all-day'));
  assert.equal(saved.title, '整理会议资料（已更新）'); assert.equal(saved.completed, true);

  await page.evaluate(() => calendarRangePreview.show('2026-11-06', 'month'));
  for (const theme of ['light', 'dark']) {
   await page.evaluate(theme => { document.body.classList.remove('theme-light', 'theme-dark'); document.body.classList.add(`theme-${theme}`); }, theme);
   for (const width of [1500, 420]) {
    await page.setViewportSize({ width, height: 1100 });
    await strike('#calendar', 'all-day', '.mc-chip-title'); await strike('#widget', 'all-day', '.mcw-name');
    const buttons = await page.locator('[data-event-id] button').evaluateAll(nodes => nodes.map(node => ({ button: node.getBoundingClientRect().height, parent: node.parentElement.getBoundingClientRect().height })));
    assert(buttons.every(size => size.button > 0 && size.button <= size.parent), 'completion buttons fit compact event rows');
    await page.screenshot({ path: path.join(output, `${theme}-${width}.png`), fullPage: true });
   }
  }
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ output, checks: ['native and home widget completion/undo', 'cross-week segments stay in sync', 'day/week timed blocks and agenda retain completion', 'keyboard Space toggles completion', 'ring clicks do not open editors', 'title editing preserves completion', 'save failure restores usable button without changing display', 'light/dark themes at 1500px and 420px'], pageErrors: errors }));
 } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
