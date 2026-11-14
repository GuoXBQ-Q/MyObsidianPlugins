// Real renderers and input under a controlled clock; no vault writes or network.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict'), esbuild = require('esbuild');
const { chromium } = require(process.env.MY_CALENDAR_PLAYWRIGHT || 'playwright');
const root = path.resolve(__dirname, '..'), output = path.join(root, 'build', 'date-refresh-preview');
const localTime = value => new Date(`${value}+08:00`);
const surfaces = [
	{ host: '#calendar', title: '.mc-title', cell: '.mc-cell', grid: '.mc-month-grid', today: '.mc-cell.mc-today', top: 30 },
	{ host: '#widget', title: '.mcw-title', cell: '.mcw-cell', grid: '.mcw-grid', today: '.mcw-cell.mcw-today', top: 24 },
];
function asset(name) {
	const dir = path.join(process.env.APPDATA, 'obsidian');
	const file = path.join(dir, fs.readdirSync(dir).filter(name => /^obsidian-.*\.asar$/.test(name)).sort().pop());
	const bytes = fs.readFileSync(file), header = JSON.parse(bytes.subarray(16, 16 + bytes.readUInt32LE(12)));
	const entry = header.files[name], start = 8 + bytes.readUInt32LE(4) + Number(entry.offset);
	return bytes.subarray(start, start + entry.size).toString('utf8');
}
(async () => {
	fs.mkdirSync(output, { recursive: true });
	const bundle = await esbuild.build({ entryPoints: [path.join(__dirname, 'calendar-preview.ts')], bundle: true, write: false, format: 'iife', platform: 'browser', alias: { obsidian: path.join(__dirname, 'preview-obsidian.ts') } });
	const browser = await chromium.launch({ headless: true, ...(process.env.MY_CALENDAR_BROWSER ? { executablePath: process.env.MY_CALENDAR_BROWSER } : {}) });
	const checks = [];
	try {
		const appCss = asset('app.css'), styles = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');
		const themeFile = path.join(root, '../.obsidian/themes/AnuPpuccin/theme.css');
		const theme = fs.existsSync(themeFile) ? fs.readFileSync(themeFile, 'utf8') : '';
		const settle = page => page.evaluate(() => new Promise(resolve => {
			const channel = new MessageChannel();
			channel.port1.onmessage = () => { channel.port1.close(); channel.port2.close(); resolve(); };
			channel.port2.postMessage(null);
		}));
		const click = async (page, selector) => {
			const box = await page.locator(selector).boundingBox();
			assert(box, `visible click target: ${selector}`); await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
			await settle(page);
		};
		const goToday = async (page, surface) => {
			const point = await page.locator(surface.host).evaluate(node => {
				const button = [...node.querySelectorAll('button')].find(button => /^(本月|本周|今天)$/.test(button.textContent.trim()));
				const box = button.getBoundingClientRect(); return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
			});
			await page.mouse.click(point.x, point.y);
			await settle(page);
		};
		const data = page => page.evaluate(() => ({ events: calendarRangePreview.getEvents(), layout: calendarRangePreview.getMonthLayout(), saves: calendarRangePreview.getSaveCount(), moves: calendarRangePreview.getMoveCount() }));
		const ui = page => page.evaluate(() => ({
			calendarTitle: document.querySelector('#calendar .mc-title')?.textContent,
			widgetTitle: document.querySelector('#widget .mcw-title')?.textContent,
			calendarToday: [...document.querySelectorAll('#calendar .mc-cell.mc-today')].map(node => node.dataset.date),
			widgetToday: [...document.querySelectorAll('#widget .mcw-cell.mcw-today')].map(node => node.dataset.date),
		}));
		const bothToday = async (page, date) => {
			const value = await ui(page); assert.deepEqual(value.calendarToday, [date]); assert.deepEqual(value.widgetToday, [date]); return value;
		};
		const wake = async page => { await page.evaluate(() => window.dispatchEvent(new Event('focus'))); await settle(page); };
		const run = async (name, initial, test, { mode = 'month', events = [] } = {}) => {
			if (process.env.MY_CALENDAR_DATE_CASE && process.env.MY_CALENDAR_DATE_CASE !== name) return;
			const context = await browser.newContext({ timezoneId: 'Asia/Shanghai', viewport: { width: 1500, height: 1000 } });
			const page = await context.newPage(), errors = [];
			page.on('pageerror', error => errors.push(error.message)); await page.route('**/*', route => route.abort());
			try {
				const time = localTime(initial); await page.clock.install({ time }); await page.clock.pauseAt(time);
				const buttons = ['theme', 'narrow', 'height-short', 'height-tall', 'height-auto', 'height-tests', 'alignment-tests', 'range-tests'].map(id => `<button id="${id}">${id}</button>`).join('');
				await page.setContent(`<!doctype html><html><head><meta charset="utf-8"></head><body class="theme-light"><nav hidden>${buttons}</nav><h2>日历按需刷新日期 · Asia/Shanghai</h2><main><section id="calendar"></section><section id="widget"></section></main><section id="stage"></section><div id="notice"></div><pre id="results"></pre></body></html>`);
				for (const content of [appCss, theme, styles]) await page.addStyleTag({ content });
				await page.addStyleTag({ content: 'html{overflow:auto}body{display:block;position:static;contain:none;overflow:auto;min-height:100vh;height:auto;padding:16px;background:var(--background-primary)}main{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:16px}#calendar,#widget{height:720px;min-height:220px}#widget{padding:12px;border:1px solid var(--background-modifier-border)}h2{font-size:18px}#stage .modal{position:static;max-width:720px;width:100%}' });
				await page.evaluate(() => {
					window.__dateTimerCalls = 0;
					for (const name of ['setTimeout', 'setInterval']) {
						const original = window[name]; window[name] = (...args) => { window.__dateTimerCalls++; return original(...args); };
					}
				});
				await page.addScriptTag({ content: bundle.outputFiles[0].text });
				await page.evaluate(({ date, mode, events }) => { calendarRangePreview.setEvents(events); calendarRangePreview.show(date, mode); }, { date: initial.slice(0, 10), mode, events });
				for (const surface of surfaces) await goToday(page, surface);
				const initialData = await data(page);
				await test(page, initialData);
				assert.deepEqual(errors, []); checks.push(name); console.log(`Passed ${name}`);
			} catch (error) {
				console.error(name, await ui(page));
				await page.screenshot({ path: path.join(output, `${name}-failure.png`), fullPage: true }).catch(() => {}); throw error;
			} finally { await context.close(); }
		};

		await run('no-background-or-midnight-timer', '2026-11-06T23:59:50', async (page, initialData) => {
			await bothToday(page, '2026-11-06');
			await page.clock.runFor(3_620_000);
			await bothToday(page, '2026-11-06');
			assert.equal(await page.evaluate(() => window.__dateTimerCalls), 0);
			await wake(page); await bothToday(page, '2026-11-07');
			assert.equal(await page.evaluate(() => window.__dateTimerCalls), 0);
			assert.deepEqual(await data(page), initialData);
		});
		await run('window-focus-after-sleep-month-and-year-change', '2026-11-30T20:00:00', async (page, initialData) => {
			await page.clock.setSystemTime(localTime('2026-12-05T09:00:00')); await wake(page);
			let value = await bothToday(page, '2026-12-05'); assert.match(value.calendarTitle, /2026 年 12 月/); assert.match(value.widgetTitle, /2026 年 12 月/);
			await page.clock.setSystemTime(localTime('2027-01-02T09:00:00')); await wake(page);
			value = await bothToday(page, '2027-01-02'); assert.match(value.calendarTitle, /2027 年 1 月/); assert.match(value.widgetTitle, /2027 年 1 月/);
			await page.screenshot({ path: path.join(output, 'focus-after-year-change.png'), fullPage: true });
			assert.deepEqual(await data(page), initialData);
		});
		await run('component-click-and-keyboard-focus', '2026-11-06T12:00:00', async (page, initialData) => {
			await page.clock.setSystemTime(localTime('2026-11-07T09:00:00'));
			await click(page, '#calendar .mc-title');
			let value = await ui(page); assert.deepEqual(value.calendarToday, ['2026-11-07']); assert.deepEqual(value.widgetToday, ['2026-11-06']);
			await click(page, '#widget .mcw-title'); await bothToday(page, '2026-11-07');
			await page.clock.setSystemTime(localTime('2026-11-08T09:00:00'));
			for (const surface of surfaces) await page.locator(`${surface.host} [data-month-nav="next"]`).evaluate(button => button.focus());
			await settle(page);
			await bothToday(page, '2026-11-08'); assert.deepEqual(await data(page), initialData);
		});
		await run('same-day-focus-and-click-do-not-rebuild', '2026-11-06T12:00:00', async (page, initialData) => {
			await page.evaluate(() => { window.__dateGrids = ['#calendar .mc-month-grid', '#widget .mcw-grid'].map(selector => ({ selector, node: document.querySelector(selector), first: document.querySelector(selector).firstElementChild })); });
			for (let i = 0; i < 3; i++) { await wake(page); for (const surface of surfaces) await click(page, `${surface.host} ${surface.title}`); }
			assert(await page.evaluate(() => window.__dateGrids.every(({ selector, node, first }) => document.querySelector(selector) === node && node.firstElementChild === first)));
			assert.deepEqual(await data(page), initialData);
		});
		await run('manual-browsing-and-today-follow', '2026-11-30T12:00:00', async (page, initialData) => {
			for (const surface of surfaces) {
				await click(page, `${surface.host} [data-month-nav="previous"]`); await click(page, `${surface.host} [data-month-nav="next"]`);
			}
			await page.clock.setSystemTime(localTime('2026-12-01T09:00:00')); await wake(page);
			let value = await bothToday(page, '2026-12-01'); assert.match(value.calendarTitle, /2026 年 11 月/); assert.match(value.widgetTitle, /2026 年 11 月/);
			for (const surface of surfaces) await goToday(page, surface);
			await page.clock.setSystemTime(localTime('2027-01-01T09:00:00')); await wake(page);
			value = await bothToday(page, '2027-01-01'); assert.match(value.calendarTitle, /2027 年 1 月/); assert.match(value.widgetTitle, /2027 年 1 月/);
			assert.deepEqual(await data(page), initialData);
		});
		for (const [mode, initial, after, title] of [
			['day', '2026-11-06T23:59:50', '2026-11-07T09:00:00', /2026 年 11 月 7 日/],
			['week', '2026-11-08T23:59:50', '2026-11-09T09:00:00', /11 月 9 – 15 日/],
		]) await run(`${mode}-view-on-focus`, initial, async (page, initialData) => {
			await page.clock.setSystemTime(localTime(after)); await wake(page); assert.match((await ui(page)).calendarTitle, title); assert.deepEqual(await data(page), initialData);
		}, { mode });

		for (const surface of surfaces) {
			await run(`${surface.host.slice(1)}-navigation-click-preserved`, '2026-11-30T23:59:50', async (page, initialData) => {
				await page.clock.setSystemTime(localTime('2026-12-01T09:00:00'));
				await click(page, `${surface.host} [data-month-nav="next"]`);
				assert.match(await page.locator(`${surface.host} ${surface.title}`).textContent(), /2026 年 12 月/, 'next click acts on the month the user actually saw');
				assert.deepEqual(await data(page), initialData);
			});
			const events = [{ id: 'date-interaction', title: '检查日期不丢失点击', date: '2026-11-06', color: 'purple', createdAt: 1 }];
			await run(`${surface.host.slice(1)}-completion-click-preserved`, '2026-11-06T23:59:50', async (page, initialData) => {
				await page.clock.setSystemTime(localTime('2026-11-07T09:00:00'));
				await click(page, `${surface.host} [data-event-id="date-interaction"] button`);
				const value = await data(page); assert.equal(value.events[0].completed, true); assert.equal(value.events[0].date, '2026-11-06');
				assert.equal(value.saves, initialData.saves + 1); assert.equal(value.moves, 0); assert.equal(await page.locator('.mc-modal').count(), 0);
			}, { events });
			await run(`${surface.host.slice(1)}-pressed-edit-survives-window-focus`, '2026-11-06T23:59:50', async (page, initialData) => {
				const selector = `${surface.host} [data-event-id="date-interaction"]`;
				const box = await page.locator(selector).boundingBox();
				await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down();
				await page.locator(selector).evaluate(node => { window.__datePressedCard = node; });
				await page.clock.setSystemTime(localTime('2026-11-07T09:00:00')); await wake(page);
				assert(await page.evaluate(() => window.__datePressedCard.isConnected));
				await page.mouse.up();
				await settle(page);
				assert.equal(await page.locator('.mc-modal').count(), 1);
				assert.equal(await page.getByLabel('开始日期', { exact: true }).inputValue(), '2026-11-06');
				assert.deepEqual(await data(page), initialData);
			}, { events });
			await run(`${surface.host.slice(1)}-drag-focus-and-escape`, '2026-11-06T23:59:50', async (page, initialData) => {
				const box = await page.locator(`${surface.host} [data-event-id="date-interaction"]`).boundingBox();
				await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down(); await page.mouse.move(box.x + box.width / 2 + 9, box.y + box.height / 2, { steps: 2 });
				await page.locator(`${surface.host} ${surface.grid}`).evaluate(node => { window.__dateDragGrid = node; window.__dateDragFirst = node.firstElementChild; });
				await page.clock.setSystemTime(localTime('2026-11-07T09:00:00')); await wake(page); await page.clock.runFor(1500);
				assert(await page.evaluate(() => window.__dateDragGrid.firstElementChild === window.__dateDragFirst));
				assert.equal(await page.locator('.mc-month-drag-layer').count(), 1);
				await page.keyboard.press('Escape'); await page.mouse.up();
				await settle(page);
				assert.deepEqual((await ui(page))[surface.host === '#calendar' ? 'calendarToday' : 'widgetToday'], ['2026-11-07']);
				assert.deepEqual(await data(page), initialData);
			}, { events });
			await run(`${surface.host.slice(1)}-pending-focus-after-successful-drop`, '2026-11-30T23:59:50', async (page, initialData) => {
				const box = await page.locator(`${surface.host} [data-event-id="date-drop"]`).boundingBox();
				const target = await page.locator(`${surface.host} ${surface.cell}[data-date="2026-12-02"]`).boundingBox();
				await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down();
				await page.mouse.move(box.x + box.width / 2 + 9, box.y + box.height / 2, { steps: 2 });
				await page.clock.setSystemTime(localTime('2026-12-01T09:00:00')); await wake(page);
				await page.mouse.move(target.x + target.width / 2, target.y + surface.top + 1, { steps: 5 }); await page.mouse.up(); await settle(page);
				const value = await data(page);
				assert.equal(value.events[0].date, '2026-12-02'); assert.equal(value.moves, 1); assert.equal(value.saves, initialData.saves + 1);
				assert.match(await page.locator(`${surface.host} ${surface.title}`).textContent(), /2026 年 12 月/);
				assert.equal(await page.locator('.mc-modal').count(), 0);
			}, { events: [{ id: 'date-drop', title: '焦点检查不改变拖放日期', date: '2026-11-30', color: 'purple', createdAt: 1 }] });
		}
		await run('disposal-removes-event-listeners-and-queued-work', '2026-11-06T12:00:00', async (page, initialData) => {
			await page.evaluate(async () => {
				await calendarRangePreview.disposeCalendars(); window.__dateDisposedChanges = 0;
				const observer = new MutationObserver(records => { window.__dateDisposedChanges += records.length; });
				for (const selector of ['#calendar', '#widget']) observer.observe(document.querySelector(selector), { childList: true, subtree: true, attributes: true });
			});
			await page.clock.setSystemTime(localTime('2026-12-01T09:00:00')); await wake(page); await page.locator('#calendar').evaluate(node => node.click());
			assert.equal(await page.evaluate(() => window.__dateDisposedChanges), 0); assert.deepEqual(await data(page), initialData);
		});
		console.log(JSON.stringify({ output, timezone: 'Asia/Shanghai', checks, pageErrors: [] }, null, 2));
	} finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
