// Real mouse input against both production month renderers. Fixtures stay in memory.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict'), esbuild = require('esbuild');
const { chromium } = require(process.env.MY_CALENDAR_PLAYWRIGHT || 'playwright');
const root = path.resolve(__dirname, '..'), output = path.join(root, 'build', 'month-drag-preview');
function asset(name) {
	const dir = path.join(process.env.APPDATA, 'obsidian');
	const file = path.join(dir, fs.readdirSync(dir).filter(n => /^obsidian-.*\.asar$/.test(n)).sort().pop());
	const bytes = fs.readFileSync(file), header = JSON.parse(bytes.subarray(16, 16 + bytes.readUInt32LE(12)));
	const entry = header.files[name], start = 8 + bytes.readUInt32LE(4) + Number(entry.offset);
	return bytes.subarray(start, start + entry.size).toString('utf8');
}
const event = (id, patch = {}) => ({ id, title: `日程 ${id}`, date: '2026-11-06', color: 'blue', createdAt: 1, ...patch });
const surfaces = [
	{ host: '#calendar', cell: '.mc-cell', title: '.mc-title', previous: '[data-month-nav="previous"]', next: '[data-month-nav="next"]', top: 30, step: 22 },
	{ host: '#widget', cell: '.mcw-cell', title: '.mcw-title', previous: '[data-month-nav="previous"]', next: '[data-month-nav="next"]', top: 24, step: 18 },
];
(async () => {
	fs.mkdirSync(output, { recursive: true });
	const bundle = await esbuild.build({ entryPoints: [path.join(__dirname, 'calendar-preview.ts')], bundle: true, write: false, format: 'iife', platform: 'browser', alias: { obsidian: path.join(__dirname, 'preview-obsidian.ts') } });
	const browser = await chromium.launch({ headless: true, ...(process.env.MY_CALENDAR_BROWSER ? { executablePath: process.env.MY_CALENDAR_BROWSER } : {}) });
	try {
		const page = await browser.newPage({ viewport: { width: 1500, height: 1100 } }), errors = [], checks = [];
		page.on('pageerror', error => errors.push(error.message));
		await page.route('**/*', route => route.abort());
		const buttons = ['theme', 'narrow', 'height-short', 'height-tall', 'height-auto', 'height-tests', 'alignment-tests', 'range-tests'].map(id => `<button id="${id}">${id}</button>`).join('');
		await page.setContent(`<!doctype html><html><head><meta charset="utf-8"></head><body class="theme-light"><nav hidden>${buttons}</nav><main><h2>月视图拖拽改期与精确排序</h2><section id="calendar"></section><section id="widget"></section><section id="stage"></section><div id="notice" role="status"></div><pre id="results"></pre></main></body></html>`);
		await page.addStyleTag({ content: asset('app.css') });
		const theme = path.join(root, '../.obsidian/themes/AnuPpuccin/theme.css');
		if (fs.existsSync(theme)) await page.addStyleTag({ content: fs.readFileSync(theme, 'utf8') });
		await page.addStyleTag({ content: fs.readFileSync(path.join(root, 'styles.css'), 'utf8') });
		await page.addStyleTag({ content: 'html{overflow:auto}body{display:block;position:static;contain:none;overflow:auto;min-height:100vh;height:auto;padding:16px;background:var(--background-primary)}main{max-width:1400px;margin:auto}#calendar{height:850px;min-height:220px}#widget{height:780px;padding:12px;border:1px solid var(--background-modifier-border);border-radius:12px}h2{font-size:18px}#stage .modal{position:static;max-width:720px;width:100%;max-height:none}#stage .modal-content{overflow:visible}#notice{padding:8px}' });
		await page.addScriptTag({ content: bundle.outputFiles[0].text });
		const reset = async (surface, events, layout) => {
			await page.mouse.up(); await page.keyboard.press('Escape');
			await page.evaluate(({ host, events, layout }) => {
				for (const selector of ['#calendar', '#widget']) document.querySelector(selector).style.display = selector === host ? '' : 'none';
				document.getElementById('calendar').style.height = '850px'; document.getElementById('widget').style.height = '780px';
				document.getElementById('stage').replaceChildren(); document.getElementById('notice').replaceChildren();
				calendarRangePreview.setWeekStart('monday'); calendarRangePreview.setNewEventsAtBottom(true);
				calendarRangePreview.setEvents(events); if (layout) calendarRangePreview.setMonthLayout(layout);
				calendarRangePreview.setMonth(2026, 11); window.scrollTo(0, 0);
			}, { host: surface.host, events, layout });
		};
		const state = () => page.evaluate(() => ({ events: calendarRangePreview.getEvents(), layout: calendarRangePreview.getMonthLayout(), moves: calendarRangePreview.getMoveCount() }));
		const sourcePoint = (surface, id, date) => page.evaluate(({ surface, id, date }) => {
			const root = document.querySelector(surface.host), cell = root.querySelector(`${surface.cell}[data-date="${date}"]`);
			if (!cell) throw Error(`Missing source cell ${date}`);
			const box = cell.getBoundingClientRect();
			for (const card of root.querySelectorAll(`[data-event-id="${id}"]`)) {
				const cardBox = card.getBoundingClientRect(), left = Math.max(box.left, cardBox.left), right = Math.min(box.right, cardBox.right);
				if (right - left > 10 && cardBox.top >= box.top && cardBox.bottom <= box.bottom + 1) return { x: Math.min(right - 5, Math.max(left + 28, (left + right) / 2)), y: cardBox.top + cardBox.height / 2 };
			}
			throw Error(`Missing visible source ${id} at ${date}`);
		}, { surface, id, date });
		const targetPoint = (surface, date, lane) => page.evaluate(({ surface, date, lane }) => {
			const cell = document.querySelector(`${surface.host} ${surface.cell}[data-date="${date}"]`);
			if (!cell) throw Error(`Missing target ${date}`);
			const box = cell.getBoundingClientRect(); return { x: box.left + box.width / 2, y: box.top + surface.top + lane * surface.step + 1 };
		}, { surface, date, lane });
		const startDrag = async (surface, id, sourceDate, targetDate, lane) => {
			const source = await sourcePoint(surface, id, sourceDate), target = await targetPoint(surface, targetDate, lane);
			if (process.env.MY_CALENDAR_DRAG_DEBUG) console.log('drag', { id, sourceDate, targetDate, source, target });
			await page.mouse.move(source.x, source.y); await page.mouse.down();
			await page.mouse.move(source.x + 8, source.y + 1, { steps: 2 });
			if (process.env.MY_CALENDAR_DRAG_DEBUG) console.log('after activation', await targetPoint(surface, targetDate, lane));
			await page.mouse.move(target.x, target.y, { steps: 8 });
			if (process.env.MY_CALENDAR_DRAG_DEBUG) console.log('preview', await page.locator('.mc-month-drag-ghost').allTextContents());
		};
		const finish = async () => { await page.mouse.up(); await page.locator('.mc-month-drag-layer').waitFor({ state: 'detached' }); };
		const assertLane = async (host, id, lane) => {
			const values = await page.locator(`${host} [data-event-id="${id}"]`).evaluateAll(nodes => nodes.map(node => Number(node.dataset.eventLane)));
			assert(values.length > 0 && values.every(value => value === lane), `${host} ${id} expected row ${lane}, got ${values}`);
		};
		// Compare rendered appearance, not preview implementation classes. Geometry
		// can change with a candidate date; the original theme and controls cannot.
		const cardAppearance = selector => page.locator(selector).evaluateAll(nodes => {
			const read = (node, pseudo, fields) => {
				const css = getComputedStyle(node, pseudo);
				return Object.fromEntries(fields.map(field => [field, css[field]]));
			};
			const font = ['fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'color', 'textDecorationLine'];
			const paint = ['backgroundColor', 'borderLeftWidth', 'borderLeftStyle', 'borderLeftColor', 'borderRadius', 'opacity'];
			const ring = ['width', 'height', 'borderRadius', 'borderTopWidth', 'borderTopStyle', 'borderTopColor', 'backgroundColor', 'color'];
			const pseudo = ['content', 'display', 'width', 'height', 'borderTopWidth', 'borderTopStyle', 'borderTopColor', 'borderRightWidth', 'borderRightStyle', 'borderRightColor', 'transform'];
			return nodes.map(node => ({
				card: read(node, null, [...font, ...paint, 'height', 'paddingLeft', 'paddingRight', 'gap']),
				text: node.textContent,
				spans: [...node.children].filter(child => child.tagName === 'SPAN').map(child => ({ text: child.textContent, ...read(child, null, font) })),
				buttons: [...node.querySelectorAll('button')].map(button => ({ pressed: button.getAttribute('aria-pressed'), ...read(button, null, [...font, ...ring]), before: read(button, '::before', pseudo), after: read(button, '::after', pseudo) })),
			}));
		});
		const assertPreviewContinuity = async (surface, appearances, invalid) => {
			assert.equal(await page.locator('.mc-month-drag-layer').count(), 1, 'one preview layer remains throughout a drag');
			assert.equal(await page.locator('.mc-month-drag-ghost.is-invalid').count(), Number(invalid));
			const originalsHidden = await page.locator(`${surface.host} [data-event-id]`).evaluateAll(nodes => nodes.length > 0 && nodes.every(node => getComputedStyle(node).visibility === 'hidden'));
			assert(originalsHidden, 'valid and invalid positions both retain the preview instead of flashing the original cards');
			const passive = await page.locator('.mc-month-drag-board').evaluate(board => {
				const inert = board.inert || !!board.closest('[inert]');
				const hidden = board.getAttribute('aria-hidden') === 'true';
				const buttonsMissHitTesting = [...board.querySelectorAll('button')].every(button => {
					const box = button.getBoundingClientRect(), hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
					return !hit || !board.contains(hit);
				});
				return inert && hidden && buttonsMissHitTesting;
			});
			assert(passive, 'preview controls are inert, hidden from accessibility and excluded from pointer hit testing');
			for (const [id, original] of Object.entries(appearances)) {
				const preview = await cardAppearance(`[data-preview-event-id="${id}"]`);
				assert.deepEqual(preview, original, `${surface.host} ${id}: fill, left border, typography, time, completion circle/check and continuation shape match real cards`);
				assert(preview.every(card => card.buttons.length === 1), 'every preview preserves its visible completion circle');
			}
		};
		for (const surface of surfaces) {
			const label = surface.host.slice(1);
			console.log(`Checking ${label}`);
			await reset(surface, [event('a'), event('b', { createdAt: 2 })]);
			await startDrag(surface, 'b', '2026-11-06', '2026-11-06', 0);
			assert.equal(await page.locator('.mc-month-drag-ghost.is-invalid').count(), 0);
			assert(await page.locator('[data-preview-event-id="b"]').count() > 0, 'valid candidate overlay must render');
			await page.screenshot({ path: path.join(output, `${label}-valid-preview.png`), fullPage: true });
			await finish();
			assert.equal((await state()).moves, 1);
			for (const host of ['#calendar', '#widget']) { await assertLane(host, 'b', 0); await assertLane(host, 'a', 1); }
			assert.equal(await page.locator('.mc-modal').count(), 0, 'drop must not open editor');
			checks.push(`${label}: same-day reorder and shared saved positions`);

			const timed = event('a', { startTime: '10:00', endTime: '11:00', completed: true, important: true, note: '保留备注' });
			await reset(surface, [timed, event('target', { date: '2026-11-07' })]);
			await startDrag(surface, 'a', '2026-11-06', '2026-11-07', 0); await finish();
			assert.deepEqual((await state()).events.find(e => e.id === 'a'), { ...timed, date: '2026-11-07' });
			await page.getByRole('button', { name: '撤销', exact: true }).click();
			assert.equal((await state()).events.find(e => e.id === 'a').date, '2026-11-06');
			checks.push(`${label}: cross-date move preserves content and notice-button undo restores it`);

			await reset(surface, [event('x', { date: '2026-11-05', endDate: '2026-11-09' }), event('a'), event('b', { createdAt: 2 })], { version: 1, manualDates: ['2026-11-06'], lanes: { x: 1, a: 0, b: 2 } });
			await startDrag(surface, 'b', '2026-11-06', '2026-11-06', 0); await finish();
			for (const host of ['#calendar', '#widget']) { await assertLane(host, 'x', 1); await assertLane(host, 'b', 0); await assertLane(host, 'a', 2); }
			checks.push(`${label}: reordering skips fixed continuation rows`);

			for (const movingRange of [false, true]) {
				const movingId = movingRange ? 'style-range' : 'style-single';
				const fixtures = [event('style-fixed', { date: '2026-11-05', endDate: '2026-11-12', color: 'teal', completed: true }),
					event(movingId, movingRange ? { endDate: '2026-11-09', color: 'purple', important: true } : { startTime: '10:00', endTime: '11:00', color: 'orange', completed: true, important: true }),
					event('style-neighbor', { createdAt: 2, ...(movingRange ? { startTime: '14:00', endTime: '15:00', completed: true } : {}) })];
				await reset(surface, fixtures, { version: 1, manualDates: ['2026-11-06'], lanes: { 'style-fixed': 1, [movingId]: 0, 'style-neighbor': 2 } });
				await page.mouse.move(3, 3);
				const beforeStyleDrag = await state(), appearances = {};
				for (const item of fixtures) appearances[item.id] = await cardAppearance(`${surface.host} [data-event-id="${item.id}"]`);
				await startDrag(surface, movingId, '2026-11-06', '2026-11-07', 0);
				await assertPreviewContinuity(surface, appearances, false);
				for (let round = 0; round < 2; round++) {
					const blocked = await targetPoint(surface, '2026-11-07', 1);
					await page.mouse.move(blocked.x, blocked.y, { steps: 3 });
					await assertPreviewContinuity(surface, appearances, true);
					assert.deepEqual(await state(), beforeStyleDrag, 'invalid previews never mutate saved state');
					const valid = await targetPoint(surface, '2026-11-07', 0);
					await page.mouse.move(valid.x, valid.y, { steps: 3 });
					await assertPreviewContinuity(surface, appearances, false);
				}
				const blocked = await targetPoint(surface, '2026-11-07', 1);
				await page.mouse.move(blocked.x, blocked.y, { steps: 3 });
				await assertPreviewContinuity(surface, appearances, true);
				await page.screenshot({ path: path.join(output, `${label}-${movingRange ? 'range' : 'single'}-fixed-row-style-invalid.png`), fullPage: true });
				await finish(); assert.deepEqual(await state(), beforeStyleDrag, 'releasing over a fixed row never commits');
				const originalsVisible = await page.locator(`${surface.host} [data-event-id]`).evaluateAll(nodes => nodes.every(node => getComputedStyle(node).visibility === 'visible'));
				assert(originalsVisible, 'normal cards return only after the drag ends');
			}
			checks.push(`${label}: repeated valid/fixed-row-invalid previews retain real card styles, completion circles, time, strike-through and continuation shape without flashing`);

			const range = event('r', { endDate: '2026-11-09', startTime: '18:00', endTime: '09:00', color: 'purple' });
			await reset(surface, [range]);
			await startDrag(surface, 'r', '2026-11-06', '2026-11-10', 0); await finish();
			assert.deepEqual((await state()).events[0], { ...range, date: '2026-11-10', endDate: '2026-11-13' });
			for (const continuation of ['2026-11-07', '2026-11-09']) {
				await reset(surface, [range]); const before = await state();
				await startDrag(surface, 'r', continuation, '2026-11-10', 0);
				assert.equal(await page.locator('.mc-month-drag-layer').count(), 0, 'only the true start-day area is draggable');
				await page.mouse.up(); assert.deepEqual(await state(), before);
			}
			checks.push(`${label}: whole-range shift, same-week and cross-week continuations cannot be grabbed`);

			await reset(surface, [event('r', { date: '2026-11-01', endDate: '2026-11-03' }), event('x', { date: '2026-11-07', endDate: '2026-11-09', color: 'teal' })]);
			let before = await state(); await startDrag(surface, 'r', '2026-11-01', '2026-11-06', 0);
			assert.equal(await page.locator('.mc-month-drag-ghost.is-invalid').count(), 1);
			assert.equal(await page.locator('.mc-month-drag-marker.is-invalid').count(), 1);
			await page.screenshot({ path: path.join(output, `${label}-invalid-preview.png`), fullPage: true });
			await finish(); assert.deepEqual(await state(), before);
			await reset(surface, [event('r', { endDate: '2026-11-08' }), event('x', { date: '2026-11-07', endDate: '2026-11-10', createdAt: 2 }), event('s', { createdAt: 3 })]);
			before = await state(); await startDrag(surface, 's', '2026-11-06', '2026-11-06', 0);
			assert.equal(await page.locator('.mc-month-drag-ghost.is-invalid').count(), 1, 'a displaced range must also be checked over its full span');
			await finish(); assert.deepEqual(await state(), before);
			checks.push(`${label}: full-span collision and displaced-range collision reject without saving`);

			await reset(surface, [event('a')]); before = await state();
			await startDrag(surface, 'a', '2026-11-06', '2026-11-07', 0); await page.keyboard.press('Escape'); await page.mouse.up();
			assert.equal(await page.locator('.mc-month-drag-layer').count(), 0); assert.deepEqual(await state(), before);
			await startDrag(surface, 'a', '2026-11-06', '2026-11-07', 0); await page.mouse.move(3, 3); await finish();
			assert.deepEqual(await state(), before); assert.equal(await page.locator('.mc-modal').count(), 0);
			await page.waitForTimeout(380);
			await page.locator(`${surface.host} [data-event-id="a"] button`).click();
			assert.equal((await state()).events[0].completed, true); assert.equal(await page.locator('.mc-modal').count(), 0);
			await page.locator(`${surface.host} [data-event-id="a"]`).locator(surface.host === '#calendar' ? '.mc-chip-title' : '.mcw-name').click();
			assert.equal(await page.locator('.mc-modal').count(), 1); await page.getByRole('button', { name: '取消', exact: true }).click();
			checks.push(`${label}: Escape/outside cancellation, normal edit and completion remain distinct`);

			await reset(surface, [event('a')]); before = await state();
			await page.evaluate(() => calendarRangePreview.setMoveError('模拟拖动保存失败'));
			await startDrag(surface, 'a', '2026-11-06', '2026-11-07', 0); await finish();
			await page.getByText('模拟拖动保存失败', { exact: true }).waitFor(); assert.deepEqual(await state(), before);
			checks.push(`${label}: save failure leaves original dates and ordering`);

			await reset(surface, [event('a')]);
			await startDrag(surface, 'a', '2026-11-06', '2026-11-07', 0);
			const nav = page.locator(`${surface.host} ${surface.next}`), navBox = await nav.boundingBox();
			await page.mouse.move(navBox.x + navBox.width / 2, navBox.y + navBox.height / 2, { steps: 5 });
			await page.waitForTimeout(700); assert.match(await page.locator(`${surface.host} ${surface.title}`).textContent(), /12/);
			await page.waitForTimeout(750); assert.match(await page.locator(`${surface.host} ${surface.title}`).textContent(), /12/, 'remaining over the button must not keep flipping');
			assert.equal(await page.locator('.mc-month-drag-layer').count(), 1, 'drag must survive replacing the month DOM');
			await page.mouse.move(navBox.x - 40, navBox.y + navBox.height / 2);
			await page.mouse.move(navBox.x + navBox.width / 2, navBox.y + navBox.height / 2);
			await page.waitForTimeout(700); assert.match(await page.locator(`${surface.host} ${surface.title}`).textContent(), /2027.*1/);
			const newTarget = await targetPoint(surface, '2027-01-06', 0); await page.mouse.move(newTarget.x, newTarget.y, { steps: 8 }); await finish();
			assert.equal((await state()).events[0].date, '2027-01-06'); assert.equal((await state()).moves, 1);
			checks.push(`${label}: 600ms one-shot month navigation, re-entry and drag across DOM replacement`);

			await reset(surface, Array.from({ length: 8 }, (_, i) => event(`scroll-${i}`, { endDate: '2026-11-10', createdAt: i })));
			await page.locator(surface.host).evaluate(node => { node.style.height = '360px'; });
			await startDrag(surface, 'scroll-0', '2026-11-06', '2026-11-06', 0);
			const grid = page.locator(`${surface.host} ${surface.host === '#calendar' ? '.mc-month-grid' : '.mcw-grid'}`), bounds = await grid.boundingBox();
			const beforeScroll = await grid.evaluate(node => node.scrollTop);
			await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height - 5);
			await page.waitForTimeout(220);
			assert(await grid.evaluate(node => node.scrollTop) > beforeScroll, 'dragging near the lower viewport edge scrolls the month');
			await page.keyboard.press('Escape'); await page.mouse.up(); assert.equal((await state()).moves, 0);
			checks.push(`${label}: crowded short calendar autoscroll and cancellation`);
		}

		for (const theme of ['light', 'dark']) for (const width of [1500, 420]) {
			await page.setViewportSize({ width, height: 1100 });
			await page.evaluate(value => { document.body.classList.remove('theme-light', 'theme-dark'); document.body.classList.add(`theme-${value}`); }, theme);
			for (const surface of surfaces) {
				await reset(surface, [event('a', { title: '项目同步 · 保留时间', startTime: '10:00' }), event('b', { title: '会议准备', createdAt: 2 })]);
				await startDrag(surface, 'b', '2026-11-06', '2026-11-07', 0);
				assert.equal(await page.locator('.mc-month-drag-ghost.is-invalid').count(), 0);
				await page.screenshot({ path: path.join(output, `${surface.host.slice(1)}-${theme}-${width}.png`), fullPage: true });
				await finish(); assert.equal((await state()).events.find(e => e.id === 'b').date, '2026-11-07');
			}
		}
		checks.push('light/dark themes and 1500px/420px viewports with real mouse input');
		assert.deepEqual(errors, [], 'browser must not emit uncaught errors');
		console.log(JSON.stringify({ output, checks, pageErrors: errors }, null, 2));
	} finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
