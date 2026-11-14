const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const vm = require('node:vm');
const esbuild = require('esbuild');

const code = esbuild.buildSync({ entryPoints: [path.join(__dirname, '../src/date-rollover.ts')], bundle: true, write: false, platform: 'node', format: 'cjs' }).outputFiles[0].text;
const NativeDate = Date;
const key = date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

class Target {
	constructor(parent = null) { this.parent = parent; this.listeners = new Map(); }
	addEventListener(type, callback) {
		if (!this.listeners.has(type)) this.listeners.set(type, new Set());
		this.listeners.get(type).add(callback);
	}
	removeEventListener(type, callback) { this.listeners.get(type)?.delete(callback); }
	emit(type, target = this, extra = {}) {
		const event = { type, target, button: 0, ...extra };
		for (const callback of [...(this.listeners.get(type) ?? [])]) callback(event);
		return event;
	}
	contains(target) {
		for (let node = target; node; node = node.parent) if (node === this) return true;
		return false;
	}
	get listenerCount() { return [...this.listeners.values()].reduce((sum, callbacks) => sum + callbacks.size, 0); }
}

function fixture(start, onChange) {
	let wall = new NativeDate(...start).getTime();
	class ClockDate extends NativeDate {
		constructor(...args) { super(...(args.length ? args : [wall])); }
		static now() { return wall; }
	}
	const win = new Target(), doc = new Target(), root = new Target(), child = new Target(root), outside = new Target();
	const messages = [];
	class Channel {
		constructor() {
			this.port1 = { onmessage: null, close() {} };
			this.port2 = { close() {}, postMessage: () => { const callback = this.port1.onmessage; if (callback) messages.push(callback); } };
		}
	}
	win.setTimeout = win.setInterval = () => { throw new Error('Date checks must not schedule timers'); };
	doc.defaultView = win; root.ownerDocument = doc;
	const module = { exports: {} };
	vm.runInNewContext(code, { module, exports: module.exports, Date: ClockDate, MessageChannel: Channel });
	const changes = [];
	const dispose = module.exports.watchLocalDateChange(root, now => { changes.push(key(now)); return onChange?.(now); });
	return {
		root, child, outside, doc, win, changes, dispose,
		setWall(parts) { wall = new NativeDate(...parts).getTime(); },
		focus() { win.emit('focus'); },
		focusComponent() { root.emit('focusin', child); },
		click(target = child) { doc.emit('click', target); },
		flush() {
			let count = 0;
			while (messages.length) {
				if (++count > 100) throw new Error('Repeated date refresh');
				messages.shift()();
			}
		},
	};
}

test('time passing alone never refreshes or creates a midnight/polling timer', () => {
	const f = fixture([2026, 10, 1, 23, 59, 59]);
	f.setWall([2026, 11, 3, 10]); f.flush();
	assert.deepEqual(f.changes, []);
	f.focus(); f.flush();
	assert.deepEqual(f.changes, ['2026-12-03']); f.dispose();
});

test('window focus checks the latest actual date across sleep, month and year boundaries', () => {
	const f = fixture([2026, 10, 30, 20]);
	f.setWall([2026, 11, 5, 8]); f.focus(); f.flush();
	f.setWall([2027, 0, 2, 9]); f.focus(); f.flush();
	assert.deepEqual(f.changes, ['2026-12-05', '2027-01-02']); f.dispose();
});

test('component keyboard focus and a descendant click detect date changes', () => {
	const f = fixture([2026, 10, 1, 20]);
	f.setWall([2026, 10, 2, 8]); f.focusComponent(); f.flush();
	f.setWall([2026, 10, 3, 8]); f.click(); f.flush();
	assert.deepEqual(f.changes, ['2026-11-02', '2026-11-03']); f.dispose();
});

test('same-day focus/click bursts and unrelated clicks cause no redraw', () => {
	const f = fixture([2026, 10, 1, 8]);
	for (let i = 0; i < 3; i++) { f.focus(); f.focusComponent(); f.click(); }
	f.flush(); assert.deepEqual(f.changes, []);
	f.setWall([2026, 10, 2, 8]); f.click(f.outside); f.flush();
	assert.deepEqual(f.changes, []);
	f.focus(); f.click(); f.flush();
	f.focusComponent(); f.click(); f.flush();
	assert.deepEqual(f.changes, ['2026-11-02']); f.dispose();
});

test('the original click action finishes before refreshing its calendar', () => {
	const order = [];
	const f = fixture([2026, 10, 1, 23], () => { order.push('refresh'); });
	f.setWall([2026, 10, 2, 1]); f.click();
	order.push('original completion/edit/navigation action');
	assert.deepEqual(f.changes, []);
	f.flush();
	assert.deepEqual(order, ['original completion/edit/navigation action', 'refresh']); f.dispose();
});

test('focus while pressed waits for click rather than removing the pressed button', () => {
	const f = fixture([2026, 10, 1, 23]);
	f.root.emit('pointerdown', f.child);
	f.setWall([2026, 10, 2, 1]); f.focus(); f.focusComponent(); f.flush();
	assert.deepEqual(f.changes, []);
	f.doc.emit('pointerup', f.child); f.flush();
	assert.deepEqual(f.changes, []);
	f.click(); f.flush();
	assert.deepEqual(f.changes, ['2026-11-02']); f.dispose();
});

test('a focus check still queued at pointerup cannot run ahead of navigation click', () => {
	const order = [];
	const f = fixture([2026, 10, 30, 23], () => { order.push('refresh'); });
	f.root.emit('pointerdown', f.child);
	f.setWall([2026, 11, 1, 1]); f.focus();
	f.doc.emit('pointerup', f.child); f.flush();
	assert.deepEqual(order, []);
	f.click(); order.push('navigate once'); f.flush();
	assert.deepEqual(order, ['navigate once', 'refresh']); f.dispose();
});

test('a consumed drag release finishes a deferred check even when no click is dispatched', () => {
	let busy = true;
	const f = fixture([2026, 10, 30, 23], () => !busy);
	f.root.emit('pointerdown', f.child);
	f.setWall([2026, 11, 1, 1]); f.focus(); f.flush();
	assert.deepEqual(f.changes, []);
	const release = f.doc.emit('pointerup', f.child);
	release.defaultPrevented = true; busy = false;
	f.flush();
	assert.deepEqual(f.changes, ['2026-12-01']); f.dispose();
});

test('deferred drag checks use the latest date and wait for a later interaction without polling', () => {
	let busy = true;
	const f = fixture([2026, 10, 1, 23], () => !busy);
	f.setWall([2026, 10, 2, 1]); f.focus(); f.flush();
	assert.equal(f.changes.length, 1);
	f.setWall([2026, 10, 4, 8]); f.flush();
	assert.equal(f.changes.length, 1, 'no automatic retry');
	busy = false; f.click(); f.flush();
	assert.deepEqual(f.changes, ['2026-11-02', '2026-11-04']);
	f.focus(); f.flush(); assert.equal(f.changes.length, 2); f.dispose();
});

test('Escape, pointer cancellation and releasing outside finish pending checks', () => {
	for (const finish of [
		f => f.doc.emit('keydown', f.child, { key: 'Escape' }),
		f => f.doc.emit('pointercancel', f.child),
		f => f.doc.emit('pointerup', f.outside),
	]) {
		const f = fixture([2026, 10, 1, 23]);
		f.root.emit('pointerdown', f.child);
		f.setWall([2026, 10, 2, 1]); f.focus(); f.flush();
		finish(f); f.flush();
		assert.deepEqual(f.changes, ['2026-11-02']); f.dispose();
	}
});

test('blur clears a press whose release happened outside the window', () => {
	const f = fixture([2026, 10, 1, 23]);
	f.root.emit('pointerdown', f.child); f.win.emit('blur');
	f.setWall([2026, 10, 2, 1]); f.focus(); f.flush();
	assert.deepEqual(f.changes, ['2026-11-02']); f.dispose();
});

test('a right-button press cannot leave keyboard or window focus checks blocked', () => {
	const f = fixture([2026, 10, 1, 23]);
	f.root.emit('pointerdown', f.child, { button: 2 });
	f.setWall([2026, 10, 2, 1]); f.focus(); f.flush();
	assert.deepEqual(f.changes, ['2026-11-02']); f.dispose();
});

test('a reentrant focus only refreshes the same date once', () => {
	let f;
	f = fixture([2026, 10, 1, 23], () => { f.focus(); });
	f.setWall([2026, 10, 2, 1]); f.focus(); f.flush();
	assert.deepEqual(f.changes, ['2026-11-02']); f.dispose();
});

test('disposal removes all listeners and makes an already queued check inert', () => {
	const f = fixture([2026, 10, 1, 23]);
	f.setWall([2026, 10, 2, 1]); f.focus();
	f.dispose(); f.dispose(); f.flush(); f.focus(); f.click(); f.flush();
	assert.deepEqual(f.changes, []);
	assert.equal(f.root.listenerCount + f.doc.listenerCount + f.win.listenerCount, 0);
});

test('documents without a window need no observer or timers', () => {
	const module = { exports: {} };
	vm.runInNewContext(code, { module, exports: module.exports });
	const cleanup = module.exports.watchLocalDateChange({ ownerDocument: { defaultView: null } }, () => { throw new Error('unexpected refresh'); });
	cleanup(); cleanup();
});
