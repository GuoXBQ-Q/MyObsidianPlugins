const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const vm = require('node:vm');
const esbuild = require('esbuild');
const clone = value => JSON.parse(JSON.stringify(value));
const event = (id, patch = {}) => ({ id, title: id, date: '2026-11-05', color: 'blue', createdAt: 1, ...patch });

async function fixture(initial, layout) {
	let disk = { events: clone(initial), settings: {}, fetchedHolidays: [], ...(layout ? { monthLayout: clone(layout) } : {}) };
	let fail = false, writes = 0, now = 1_000_000, timerId = 0, nextDelay;
	const timers = new Map(), notices = [];
	const setTimer = (fn, ms) => { const id = ++timerId; timers.set(id, { fn, due: now + ms }); return id; };
	class ClockDate extends Date { static now() { return now; } }
	class Component {
		constructor() { this.cleanups = []; }
		register(fn) { this.cleanups.push(fn); }
		unload() { this.onunload?.(); for (const fn of this.cleanups.splice(0).reverse()) fn(); }
	}
	class Plugin extends Component {
		constructor(app, manifest) { super(); this.app = app; this.manifest = manifest; }
		async loadData() { return clone(disk); }
		async saveData(value) {
			const delay = nextDelay; nextDelay = undefined;
			if (delay) { delay.enter(); await delay.promise; }
			if (fail) throw new Error('disk full');
			writes++; disk = clone(value);
		}
		registerView() {} addRibbonIcon() {} addSettingTab() {} addCommand() {}
	}
	class Notice {
		constructor(message, timeout) { this.message = message; this.timeout = timeout; this.hidden = false; notices.push(this); }
		hide() { this.hidden = true; }
	}
	const obsidian = { Plugin, ItemView: class {}, Modal: class {}, PluginSettingTab: class {}, Notice, Platform: { isDesktopApp: false } };
	const code = esbuild.buildSync({ entryPoints: [path.join(__dirname, '../src/main.ts')], bundle: true, write: false, platform: 'node', format: 'cjs', external: ['obsidian'] }).outputFiles[0].text;
	const module = { exports: {} };
	vm.runInNewContext(code, { module, exports: module.exports, console, Date: ClockDate,
		require: name => name === 'obsidian' ? obsidian : require(name),
		setTimeout: setTimer, clearTimeout: id => timers.delete(id),
		setInterval: setTimer, clearInterval: id => timers.delete(id), window: { setTimeout: setTimer, clearTimeout: id => timers.delete(id) } });
	const plugin = new module.exports.default({ workspace: { getLeavesOfType: () => [] } }, {});
	await plugin.onload();
	return {
		plugin, notices, get disk() { return clone(disk); }, get writes() { return writes; },
		snapshot: () => JSON.stringify({ events: plugin.events, layout: plugin.monthLayout }),
		setFail(value) { fail = value; },
		advance(ms) { now += ms; for (const [id, timer] of [...timers]) if (timer.due <= now) { timers.delete(id); timer.fn(); } },
		delayNextSave() {
			let enter, release;
			const entered = new Promise(resolve => { enter = resolve; });
			const promise = new Promise(resolve => { release = resolve; });
			nextDelay = { enter, promise }; return { entered, release };
		},
	};
}

test('moving and reordering commit as one write, notify both views, and preserve all event fields', async t => {
	const a = event('a', { countdown: true, completed: true, startTime: '10:00', endTime: '11:00', important: true, note: '备注' });
	const b = event('b', { date: '2026-11-06' });
	const f = await fixture([a, b]); t.after(() => f.plugin.unload());
	let refreshes = 0, countdownChanges = 0;
	f.plugin.onRefresh(() => refreshes++); f.plugin.countdownSource.subscribe(() => countdownChanges++);
	assert.equal(await f.plugin.moveMonthEvent('a', '2026-11-06', 0, f.snapshot()), true);
	assert.equal(f.writes, 1); assert.equal(refreshes, 1); assert.equal(countdownChanges, 1);
	assert.deepEqual(f.disk.events.find(e => e.id === 'a'), { ...a, date: '2026-11-06' });
	assert.equal(f.disk.monthLayout.lanes.a, 0); assert.equal(f.disk.monthLayout.lanes.b, 1);
	assert(f.disk.monthLayout.manualDates.includes('2026-11-06'));
	assert.equal(f.notices.at(-1).timeout, 10_000);
	const saved = f.disk.monthLayout;
	await f.plugin.loadSettings(); assert.deepEqual(clone(f.plugin.monthLayout), saved, 'reload restores the committed positions');
});

test('same-day reorder persists without a date change and undo restores the entire layout', async t => {
	const initial = [event('a'), event('b', { createdAt: 2 }), event('c', { createdAt: 3 })];
	const f = await fixture(initial); t.after(() => f.plugin.unload());
	const before = clone(f.plugin.monthLayout);
	assert.equal(await f.plugin.moveMonthEvent('c', '2026-11-05', 0, f.snapshot()), true);
	assert.deepEqual(f.disk.events, initial);
	assert.deepEqual([f.disk.monthLayout.lanes.c, f.disk.monthLayout.lanes.a, f.disk.monthLayout.lanes.b], [0, 1, 2]);
	assert.equal(await f.plugin.undoMonthMove(), true);
	assert.deepEqual(f.disk.events, initial); assert.deepEqual(f.disk.monthLayout, before);
	assert.equal(await f.plugin.undoMonthMove(), false);
});

test('failed drag writes expose no partial date or layout and do not notify subscribers', async t => {
	const initial = [event('a'), event('b', { date: '2026-11-06' })];
	const f = await fixture(initial); t.after(() => f.plugin.unload());
	const before = f.snapshot(); let refreshes = 0, changes = 0;
	f.plugin.onRefresh(() => refreshes++); f.plugin.countdownSource.subscribe(() => changes++); f.setFail(true);
	await assert.rejects(f.plugin.moveMonthEvent('a', '2026-11-06', 0, before), /disk full/);
	assert.equal(f.snapshot(), before); assert.deepEqual(f.disk.events, initial);
	assert.equal(f.disk.monthLayout, undefined); assert.equal(refreshes, 0); assert.equal(changes, 0);
	assert.equal(await f.plugin.undoMonthMove(), false);
});

test('a queued second drag is checked against the committed first drag instead of overwriting it', async t => {
	const f = await fixture([event('a'), event('b')]); t.after(() => f.plugin.unload());
	const seen = f.snapshot(), delay = f.delayNextSave();
	const first = f.plugin.moveMonthEvent('a', '2026-11-06', 0, seen);
	await delay.entered;
	const second = f.plugin.moveMonthEvent('b', '2026-11-07', 0, seen);
	const results = Promise.allSettled([first, second]); delay.release();
	const [a, b] = await results;
	assert.equal(a.status, 'fulfilled'); assert.equal(a.value, true);
	assert.equal(b.status, 'rejected'); assert.match(b.reason.message, /已变化/);
	assert.equal(f.disk.events.find(e => e.id === 'a').date, '2026-11-06');
	assert.equal(f.disk.events.find(e => e.id === 'b').date, '2026-11-05'); assert.equal(f.writes, 1);
});

test('invalid fixed continuation and future-span collisions reject without saving', async t => {
	const f = await fixture([event('r', { date: '2026-11-01', endDate: '2026-11-03' }), event('x', { date: '2026-11-07', endDate: '2026-11-09' }), event('s')]);
	t.after(() => f.plugin.unload()); const before = f.snapshot();
	await assert.rejects(f.plugin.moveMonthEvent('r', '2026-11-06', 0, before));
	assert.equal(f.snapshot(), before); assert.equal(f.writes, 0);
	await assert.rejects(f.plugin.moveMonthEvent('s', '2026-11-08', 0, before));
	assert.equal(f.snapshot(), before); assert.equal(f.writes, 0);
});

test('no-op drops neither write nor replace the most recent successful move undo', async t => {
	const f = await fixture([event('a')]); t.after(() => f.plugin.unload());
	await f.plugin.moveMonthEvent('a', '2026-11-06', 0, f.snapshot());
	const writes = f.writes, notices = f.notices.length;
	assert.equal(await f.plugin.moveMonthEvent('a', '2026-11-06', 0, f.snapshot()), false);
	assert.equal(f.writes, writes); assert.equal(f.notices.length, notices);
	assert.equal(await f.plugin.undoMonthMove(), true); assert.equal(f.disk.events[0].date, '2026-11-05');
});

test('only the latest move is undoable and expiration removes that opportunity', async t => {
	const f = await fixture([event('a')]); t.after(() => f.plugin.unload());
	await f.plugin.moveMonthEvent('a', '2026-11-06', 0, f.snapshot());
	const oldNotice = f.notices.at(-1);
	await f.plugin.moveMonthEvent('a', '2026-11-07', 0, f.snapshot()); assert.equal(oldNotice.hidden, true);
	assert.equal(await f.plugin.undoMonthMove(), true); assert.equal(f.disk.events[0].date, '2026-11-06');
	assert.equal(await f.plugin.undoMonthMove(), false);
	await f.plugin.moveMonthEvent('a', '2026-11-08', 0, f.snapshot());
	f.advance(10_001); assert.equal(await f.plugin.undoMonthMove(), false); assert.equal(f.disk.events[0].date, '2026-11-08');
});

test('later edits invalidate undo rather than losing the edited event data', async t => {
	const f = await fixture([event('a')]); t.after(() => f.plugin.unload());
	await f.plugin.moveMonthEvent('a', '2026-11-06', 0, f.snapshot());
	const current = clone(f.plugin.events[0]); await f.plugin.saveEvent({ ...current, title: '新的标题' }, current);
	const saved = f.disk; await assert.rejects(f.plugin.undoMonthMove(), /已再次变化/);
	assert.deepEqual(f.disk, saved); assert.equal(await f.plugin.undoMonthMove(), false);
});

test('failed undo keeps the saved move and can be retried during the same undo window', async t => {
	const f = await fixture([event('a', { countdown: true })]); t.after(() => f.plugin.unload());
	let changes = 0; f.plugin.countdownSource.subscribe(() => changes++);
	await f.plugin.moveMonthEvent('a', '2026-11-06', 0, f.snapshot()); const saved = f.disk;
	f.setFail(true); await assert.rejects(f.plugin.undoMonthMove(), /disk full/);
	assert.deepEqual(f.disk, saved); assert.equal(changes, 1);
	f.setFail(false); assert.equal(await f.plugin.undoMonthMove(), true);
	assert.equal(f.disk.events[0].date, '2026-11-05'); assert.equal(changes, 2);
});

test('new and modal-moved events append on manually ordered dates without reordering other views', async t => {
	const f = await fixture([event('a'), event('b', { createdAt: 2 }), event('elsewhere', { date: '2026-11-10', createdAt: 3 })]);
	t.after(() => f.plugin.unload()); await f.plugin.moveMonthEvent('b', '2026-11-05', 0, f.snapshot());
	await f.plugin.saveEvent(event('new', { createdAt: 0, startTime: '01:00' }), null);
	assert.equal(f.disk.monthLayout.lanes.new, 2);
	const old = clone(f.plugin.events.find(e => e.id === 'elsewhere'));
	await f.plugin.saveEvent({ ...old, date: '2026-11-05' }, old); assert.equal(f.disk.monthLayout.lanes.elsewhere, 3);
	assert.equal(f.disk.events.find(e => e.id === 'new').createdAt, 0, 'manual order never changes creation time');
	await f.plugin.deleteEvent(clone(f.plugin.events.find(e => e.id === 'a')));
	assert.equal(f.disk.monthLayout.lanes.a, undefined, 'deleted records do not leave stale layout entries');
});

test('unloading removes undo and an already pending save cannot install a new notice afterward', async t => {
	const f = await fixture([event('a')]);
	const delay = f.delayNextSave(); const move = f.plugin.moveMonthEvent('a', '2026-11-06', 0, f.snapshot());
	await delay.entered; f.plugin.unload(); delay.release(); await move;
	assert.equal(f.notices.length, 0); assert.equal(await f.plugin.undoMonthMove(), false);
});

const sortingFixture = () => ({
	events: [event('p', { date: '2026-11-05', endDate: '2026-11-08' }), event('a', { date: '2026-11-06' }), event('b', { date: '2026-11-06', createdAt: 2 }),
		event('old', { date: '2026-11-20', endDate: '2026-11-23', createdAt: 100 }), event('new', { date: '2026-11-18', endDate: '2026-11-24', createdAt: 200 })],
	layout: { version: 1, manualDates: ['2026-11-06'], lanes: { p: 1, a: 0, b: 2, old: 0, new: 1 } },
});

test('saving an automatic-sort setting refreshes unrelated dates while retaining manual rows and clearing old undo', async t => {
	const initial = sortingFixture(), f = await fixture(initial.events, initial.layout); t.after(() => f.plugin.unload());
	await f.plugin.moveMonthEvent('b', '2026-11-06', 0, f.snapshot());
	const events = clone(f.plugin.events), notice = f.notices.at(-1);
	f.plugin.settings.newEventsAtBottom = false;
	await f.plugin.saveAll();
	assert.equal(f.disk.settings.newEventsAtBottom, false);
	assert.equal(f.disk.monthLayout.lanes.old, 1); assert.equal(f.disk.monthLayout.lanes.new, 0);
	assert.deepEqual([f.disk.monthLayout.lanes.b, f.disk.monthLayout.lanes.p, f.disk.monthLayout.lanes.a], [0, 1, 2]);
	assert.deepEqual(clone(f.plugin.monthLayout), f.disk.monthLayout, 'saveAll commits layout even without an event change callback');
	assert.deepEqual(f.disk.events, events); assert.equal(notice.hidden, true); assert.equal(await f.plugin.undoMonthMove(), false);
	await f.plugin.loadSettings(); assert.deepEqual(clone(f.plugin.monthLayout), f.disk.monthLayout);
});

test('failed automatic-sort saves leave committed layout and undo intact and retry still recomputes automatic dates', async t => {
	const initial = sortingFixture(), f = await fixture(initial.events, initial.layout); t.after(() => f.plugin.unload());
	await f.plugin.moveMonthEvent('b', '2026-11-06', 0, f.snapshot());
	const before = f.snapshot(), disk = f.disk, notice = f.notices.at(-1);
	f.plugin.settings.newEventsAtBottom = false; f.setFail(true);
	await assert.rejects(f.plugin.saveAll(), /disk full/);
	assert.equal(f.snapshot(), before); assert.deepEqual(f.disk, disk); assert.equal(notice.hidden, false);
	f.setFail(false); await f.plugin.saveAll();
	assert.equal(f.disk.monthLayout.lanes.old, 1); assert.equal(f.disk.monthLayout.lanes.new, 0);
	assert.deepEqual([f.disk.monthLayout.lanes.b, f.disk.monthLayout.lanes.p, f.disk.monthLayout.lanes.a], [0, 1, 2]);
	assert.equal(f.disk.settings.newEventsAtBottom, false); assert.equal(notice.hidden, true); assert.equal(await f.plugin.undoMonthMove(), false);
});
