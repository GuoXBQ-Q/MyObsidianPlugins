const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');
const esbuild = require('esbuild');

function compile(file) {
	const code = esbuild.buildSync({ entryPoints: [path.join(__dirname, '../src', file)], bundle: true, write: false, platform: 'node', format: 'cjs' }).outputFiles[0].text;
	const compiled = new Module(__filename);
	compiled._compile(code, __filename);
	return compiled.exports;
}
const { emptyMonthLayout, normalizeMonthLayout, monthEventLanes, planMonthDrop, reconcileMonthLayout, refreshAutomaticMonthLayout } = compile('month-layout.ts');
const { monthRangeSegments, freeDayLanes, compareEvents, isMultiDay } = compile('event-range.ts');
const event = (id, date, endDate, createdAt = 0, extra = {}) => ({ id, title: id, date, ...(endDate ? { endDate } : {}), color: 'blue', createdAt, ...extra });
const state = (manualDates = [], lanes = {}) => ({ version: 1, manualDates, lanes });
const rows = (events, layout, bottom = true) => Object.fromEntries(monthEventLanes(events, layout, bottom));
const clone = value => JSON.parse(JSON.stringify(value));
const localDate = date => new Date(`${date}T12:00:00`);

function deepFreeze(value) {
	if (value && typeof value === 'object') {
		Object.freeze(value);
		Object.values(value).forEach(deepFreeze);
	}
	return value;
}

test('an untouched month exactly preserves legacy range rows and single-day hole filling under both sort preferences', () => {
	const events = [
		event('old', '2026-11-05', '2026-11-08', 100),
		event('continued', '2026-11-06', '2026-11-10', 200),
		event('Z', '2026-11-09', undefined, 300, { startTime: '12:00' }),
		event('A', '2026-11-09', undefined, 400, { startTime: '09:00' }),
		event('later', '2026-11-11', '2026-12-01', 500),
		event('single', '2026-11-06', undefined, 600),
	];
	for (const bottom of [true, false]) {
		const actual = monthEventLanes(events, emptyMonthLayout(), bottom);
		for (const date of new Set(events.map(item => item.date))) {
			const spans = monthRangeSegments(events, localDate(date), 1, bottom)[0];
			for (const span of spans) assert.equal(actual.get(span.ev.id), span.lane);
			const singles = events.filter(item => item.date === date && !isMultiDay(item)).sort((a, b) => compareEvents(a, b, bottom));
			const slots = freeDayLanes(spans, 0, singles.length);
			singles.forEach((item, i) => assert.equal(actual.get(item.id), slots[i]));
		}
	}
});

test('normalization discards malformed dates, stale IDs, invalid lanes and nonmanual single preferences', () => {
	const events = [event('range', '2026-11-01', '2026-11-03'), event('manual', '2026-11-02'), event('normal', '2026-11-04'), event('invalid', '2026-11-02')];
	const input = { version: 1, manualDates: ['2026-11-02', '2026-11-02', '2026-02-30', '0000-01-01', 7], lanes: { range: 2, manual: 5, normal: 8, invalid: -1, gone: 3 } };
	const before = clone(input);
	assert.deepEqual(normalizeMonthLayout(input, events), state(['2026-11-02'], { range: 2, manual: 5 }));
	assert.deepEqual(input, before);
	assert.deepEqual(normalizeMonthLayout({ ...input, version: 2 }, events), emptyMonthLayout());
	assert.deepEqual(normalizeMonthLayout(null, events), emptyMonthLayout());
});

test('a cross-day single drop inserts at the exact row and leaves the source vacancy and event metadata intact', () => {
	const moved = event('move', '2026-11-05', undefined, 100, { startTime: '08:35', endTime: '10:45', completed: true, countdown: true, important: true, note: '保留备注', color: '#123456' });
	const events = [moved, event('source-peer', '2026-11-05', undefined, 200), event('target-peer', '2026-11-06', undefined, 300)];
	const result = planMonthDrop(events, emptyMonthLayout(), true, 'move', '2026-11-06', 0);
	assert.equal(result.valid, true);
	assert.equal(result.changed, true);
	assert.deepEqual(result.events[0], { ...moved, date: '2026-11-06' });
	assert.deepEqual(rows(result.events, result.layout), { move: 0, 'source-peer': 1, 'target-peer': 1 });
	assert.deepEqual(result.layout.manualDates, ['2026-11-05', '2026-11-06']);
	assert.equal(events[0].date, '2026-11-05');
});

test('same-day downward movement extracts before reinserting: A/B/C becomes B/C/A', () => {
	const events = ['A', 'B', 'C'].map((id, i) => event(id, '2026-11-06', undefined, i));
	const result = planMonthDrop(events, emptyMonthLayout(), true, 'A', '2026-11-06', 2);
	assert.equal(result.valid, true);
	assert.deepEqual(rows(result.events, result.layout), { A: 2, B: 0, C: 1 });
	assert.deepEqual(result.events, events, 'reordering does not rewrite timestamps or storage order');
	assert.deepEqual(rows(result.events, result.layout, false), { A: 2, B: 0, C: 1 }, 'manual rows override the fallback sort');
});

test('same-day upward movement changes only month layout', () => {
	const events = ['A', 'B', 'C'].map((id, i) => event(id, '2026-11-06', undefined, i));
	const result = planMonthDrop(events, emptyMonthLayout(), true, 'C', '2026-11-06', 0);
	assert.equal(result.valid, true);
	assert.deepEqual(rows(result.events, result.layout), { A: 1, B: 2, C: 0 });
	assert.deepEqual(result.events, events);
});

test('single events and multi-day events starting on the target date share the insertion order', () => {
	const events = [event('range', '2026-11-06', '2026-11-10', 0), event('single', '2026-11-05', undefined, 1)];
	const result = planMonthDrop(events, emptyMonthLayout(), true, 'single', '2026-11-06', 0);
	assert.equal(result.valid, true);
	assert.deepEqual(rows(result.events, result.layout), { range: 1, single: 0 });
	for (const date of ['2026-11-06', '2026-11-09', '2026-11-10']) {
		assert.equal(monthEventLanes(result.events, clone(result.layout), true).get('range'), 1, date);
	}
});

test('the exact target is rejected if occupied by a continuation even when another row is available', () => {
	const events = [event('range', '2026-11-05', '2026-11-10'), event('move', '2026-11-03')];
	const result = planMonthDrop(events, emptyMonthLayout(), true, 'move', '2026-11-06', 0);
	assert.equal(result.valid, false);
	assert.match(result.reason, /后续日期/);
	assert.equal(result.changed, false);
	assert.strictEqual(result.events, events);
});

test('displaced target events skip fixed continuation rows without moving the continuations', () => {
	const events = [
		event('blocker', '2026-11-05', '2026-11-08', 0),
		event('continued', '2026-11-06', '2026-11-10', 1),
		event('A', '2026-11-09', undefined, 2), event('B', '2026-11-09', undefined, 3), event('move', '2026-11-01', undefined, 4),
	];
	const result = planMonthDrop(events, emptyMonthLayout(), true, 'move', '2026-11-09', 0);
	assert.equal(result.valid, true);
	assert.deepEqual(rows(result.events, result.layout), { blocker: 0, continued: 1, A: 2, B: 3, move: 0 });
});

test('same-day downward movement compacts around a fixed continuation while preserving the requested row', () => {
	const events = [event('continued', '2026-11-05', '2026-11-10'), ...['A', 'B', 'C'].map((id, i) => event(id, '2026-11-06', undefined, i))];
	const result = planMonthDrop(events, emptyMonthLayout(), true, 'A', '2026-11-06', 3);
	assert.equal(result.valid, true);
	assert.deepEqual(rows(result.events, result.layout), { continued: 0, A: 3, B: 1, C: 2 });
});

test('explicitly dropping into an empty lower row preserves gaps across normalization and reload', () => {
	const events = [event('move', '2026-11-05'), event('other', '2026-11-06')];
	const result = planMonthDrop(events, emptyMonthLayout(), true, 'move', '2026-11-06', 5);
	assert.equal(result.valid, true);
	assert.deepEqual(rows(result.events, result.layout), { move: 5, other: 0 });
	assert.deepEqual(rows(clone(result.events), normalizeMonthLayout(clone(result.layout), clone(result.events))), { move: 5, other: 0 });
});

test('a moved range is rejected for a collision on its future final day', () => {
	const events = [event('move', '2026-11-01', '2026-11-03', 0), event('future', '2026-11-12', '2026-11-14', 1)];
	const result = planMonthDrop(events, emptyMonthLayout(), true, 'move', '2026-11-10', 0);
	assert.equal(result.valid, false);
	assert.match(result.reason, /其他日期重叠/);
	assert.deepEqual(result.events, events);
	assert.deepEqual(result.layout, emptyMonthLayout());
});

test('the entire drop is rejected when a displaced target-start range collides in the future', () => {
	const events = [event('starting', '2026-11-06', '2026-11-10', 0), event('future', '2026-11-09', '2026-11-11', 1), event('move', '2026-11-01', undefined, 2)];
	const result = planMonthDrop(events, emptyMonthLayout(), true, 'move', '2026-11-06', 0);
	assert.equal(result.valid, false);
	assert.equal(result.changed, false);
	assert.deepEqual(result.events, events);
	assert.deepEqual(result.layout, emptyMonthLayout());
});

test('future single events can make room for a moved range while preserving their manual order', () => {
	const events = [event('move', '2026-11-01', '2026-11-02'), event('A', '2026-11-07'), event('B', '2026-11-07')];
	const layout = state(['2026-11-07'], { move: 0, A: 0, B: 2 });
	const result = planMonthDrop(events, layout, true, 'move', '2026-11-06', 0);
	assert.equal(result.valid, true);
	assert.deepEqual(rows(result.events, result.layout), { move: 0, A: 1, B: 2 });
	assert.equal(result.layout.lanes.A, 1);
	assert.equal(result.layout.lanes.B, 2);
});

test('cross-month, cross-year and leap-day movement uses calendar days and retains both times', () => {
	for (const [start, end, target, expectedEnd] of [
		['2026-10-30', '2026-11-02', '2026-12-30', '2027-01-02'],
		['2028-02-28', '2028-03-01', '2028-03-02', '2028-03-04'],
		['2026-03-07', '2026-03-09', '2026-11-01', '2026-11-03'],
		['0001-01-01', '0001-01-03', '0099-12-30', '0100-01-01'],
	]) {
		const events = [event('move', start, end, 77, { startTime: '23:45', endTime: '00:10' })];
		const result = planMonthDrop(events, emptyMonthLayout(), true, 'move', target, 2);
		assert.equal(result.valid, true);
		assert.deepEqual(result.events[0], { ...events[0], date: target, endDate: expectedEnd });
	}
});

test('invalid dates, rows, missing events and year overflow cannot change data', () => {
	const events = [event('move', '2026-11-01', '2026-11-03')];
	for (const [id, date, lane] of [['gone', '2026-11-01', 0], ['move', '2026-02-30', 0], ['move', '0000-01-01', 0], ['move', '9999-12-31', 0], ['move', '2026-11-01', -1], ['move', '2026-11-01', 0.5], ['move', '2026-11-01', Infinity]]) {
		const result = planMonthDrop(events, emptyMonthLayout(), true, id, date, lane);
		assert.equal(result.valid, false);
		assert.equal(result.changed, false);
		assert.deepEqual(result.events, events);
	}
});

test('dropping back on the same date and row is a true no-op', () => {
	const events = [event('move', '2026-11-01')];
	const result = planMonthDrop(events, emptyMonthLayout(), true, 'move', '2026-11-01', 0);
	assert.equal(result.valid, true);
	assert.equal(result.changed, false);
	assert.strictEqual(result.events, events);
	assert.deepEqual(result.layout, emptyMonthLayout());
});

test('planning remains pure for deeply frozen input and freezes all existing range positions after a valid drop', () => {
	const events = deepFreeze([event('past', '2026-10-01', '2026-10-03'), event('future', '2027-01-01', '2027-01-04'), event('move', '2026-11-01')]);
	const layout = deepFreeze(emptyMonthLayout());
	const result = planMonthDrop(events, layout, true, 'move', '2026-11-06', 2);
	assert.equal(result.valid, true);
	assert.equal(result.layout.lanes.past, 0);
	assert.equal(result.layout.lanes.future, 0);
	assert.equal(result.layout.lanes.move, 2);
	assert.deepEqual(layout, emptyMonthLayout());
	assert.equal(events[2].date, '2026-11-01');
});

test('ordinary creation and editing leave an untouched month in legacy mode', () => {
	const before = [event('old', '2026-11-06')];
	const after = [...before, event('new', '2026-11-06', '2026-11-10')];
	assert.deepEqual(reconcileMonthLayout(before, after, emptyMonthLayout(), true), emptyMonthLayout());
});

test('new singles append below all existing rows on a manual date, regardless of normal sort order', () => {
	const before = [event('old', '2026-11-06', undefined, 100, { startTime: '12:00' })];
	const after = [...before, event('new', '2026-11-06', undefined, 1, { startTime: '06:00' })];
	const result = reconcileMonthLayout(before, after, state(['2026-11-06'], { old: 3 }), false);
	assert.deepEqual(rows(after, result, false), { old: 3, new: 4 });
});

test('a newly added manual-start range searches its full span for an available bottom row', () => {
	const before = [event('single', '2026-11-06'), event('future', '2026-11-08', '2026-11-10')];
	const after = [...before, event('new', '2026-11-06', '2026-11-09')];
	const result = reconcileMonthLayout(before, after, state(['2026-11-06'], { single: 0, future: 1 }), true);
	assert.deepEqual(rows(after, result), { future: 0, new: 2, single: 0 }, 'an unrelated future range can return to its automatic row');
});

test('deleting an event preserves remaining single gaps and fixed continuation rows', () => {
	const before = [event('continued', '2026-11-05', '2026-11-10'), event('deleted', '2026-11-06'), event('other', '2026-11-06')];
	const after = before.filter(item => item.id !== 'deleted');
	const result = reconcileMonthLayout(before, after, state(['2026-11-06'], { continued: 1, deleted: 0, other: 2 }), true);
	assert.deepEqual(rows(after, result), { continued: 1, other: 2 });
	assert.equal(Object.hasOwn(result.lanes, 'deleted'), false);
});

test('title, time and completion edits retain manual rows; an event edited into a manual date appends', () => {
	const before = [event('A', '2026-11-06'), event('B', '2026-11-06'), event('move', '2026-11-05')];
	const original = state(['2026-11-06'], { A: 1, B: 3 });
	const renamed = before.map(item => item.id === 'A' ? { ...item, title: 'Z', startTime: '23:00', completed: true } : item);
	assert.deepEqual(reconcileMonthLayout(before, renamed, original, false), original);
	const moved = renamed.map(item => item.id === 'move' ? { ...item, date: '2026-11-06' } : item);
	const result = reconcileMonthLayout(renamed, moved, original, false);
	assert.deepEqual(rows(moved, result, false), { A: 1, B: 3, move: 4 });
});

test('extending a manually positioned range can find another row without displacing existing ranges', () => {
	const before = [event('edit', '2026-11-06', '2026-11-07'), event('future', '2026-11-08', '2026-11-10')];
	const after = before.map(item => item.id === 'edit' ? { ...item, endDate: '2026-11-09' } : item);
	const result = reconcileMonthLayout(before, after, state(['2026-11-06'], { edit: 0, future: 0 }), true);
	assert.deepEqual(rows(after, result), { edit: 1, future: 0 });
});

test('corrupt duplicate persisted rows recover without overlapping events or mutating the stored state', () => {
	const events = [event('range1', '2026-11-01', '2026-11-05'), event('range2', '2026-11-03', '2026-11-08'), event('single1', '2026-11-04'), event('single2', '2026-11-04')];
	const layout = deepFreeze(state(['2026-11-04'], { range1: 0, range2: 0, single1: 0, single2: 0 }));
	const actual = rows(events, layout);
	assert.equal(new Set(Object.values(actual)).size, 4);
	assert.deepEqual(rows(events, layout), actual);
});

test('very long ranges remain bounded by event count rather than their duration', () => {
	const events = [event('long', '0001-01-01', '9999-12-31'), event('move', '2026-11-06')];
	const result = planMonthDrop(events, emptyMonthLayout(), true, 'move', '2026-11-07', 3);
	assert.equal(result.valid, true);
	assert.deepEqual(rows(result.events, result.layout), { long: 0, move: 3 });
});

test('changing the fallback sort refreshes unrelated ranges but preserves all manual-date rows', () => {
	const events = [
		event('old', '2026-11-10', '2026-11-12', 100),
		event('new', '2026-11-09', '2026-11-11', 200),
		event('manual', '2026-11-01', undefined, 300),
		event('protected', '2026-10-30', '2026-11-02', 400),
	];
	const layout = state(['2026-11-01'], { old: 0, new: 1, manual: 3, protected: 2 });
	const result = refreshAutomaticMonthLayout(events, layout, false);
	assert.deepEqual(rows(events, result, false), { old: 1, new: 0, protected: 2, manual: 3 });
	assert.deepEqual(result.manualDates, ['2026-11-01']);
	assert.deepEqual(layout.lanes, { old: 0, new: 1, manual: 3, protected: 2 });
	assert.deepEqual(refreshAutomaticMonthLayout(events, emptyMonthLayout(), false), emptyMonthLayout());
});

test('adding a range outside manual dates retains the original automatic sort behavior', () => {
	const before = [event('old', '2026-11-10', '2026-11-12', 100), event('manual', '2026-11-01', undefined, 300)];
	const after = [...before, event('new', '2026-11-09', '2026-11-11', 200)];
	const result = reconcileMonthLayout(before, after, state(['2026-11-01'], { old: 0, manual: 3 }), false);
	assert.deepEqual(rows(after, result, false), { old: 1, new: 0, manual: 3 });
});

test('deleting an unrelated automatic range compacts its automatic continuations without shifting protected continuations', () => {
	const before = [
		event('deleted', '2026-11-10', '2026-11-12', 100),
		event('automatic', '2026-11-11', '2026-11-14', 200),
		event('protected', '2026-10-30', '2026-11-02', 300),
		event('manual', '2026-11-01', undefined, 400),
	];
	const after = before.filter(item => item.id !== 'deleted');
	const result = reconcileMonthLayout(before, after, state(['2026-11-01'], { deleted: 0, automatic: 1, protected: 2, manual: 3 }), true);
	assert.deepEqual(rows(after, result), { automatic: 0, protected: 2, manual: 3 });
});

test('editing automatic range dates refreshes their normal order while metadata edits preserve the drag snapshot', () => {
	const before = [event('old', '2026-11-10', '2026-11-12', 100), event('new', '2026-11-11', '2026-11-13', 200), event('manual', '2026-11-01')];
	const layout = state(['2026-11-01'], { old: 0, new: 1, manual: 2 });
	const metadata = before.map(item => item.id === 'new' ? { ...item, title: 'Changed', completed: true } : item);
	assert.deepEqual(reconcileMonthLayout(before, metadata, layout, false), layout);
	const moved = before.map(item => item.id === 'new' ? { ...item, date: '2026-11-09', endDate: '2026-11-11' } : item);
	const result = reconcileMonthLayout(before, moved, layout, false);
	assert.deepEqual(rows(moved, result, false), { old: 1, new: 0, manual: 2 });
});

test('automatic refresh avoids protected rows throughout their full span', () => {
	const events = [event('protected', '2026-11-01', '2026-11-10'), event('automatic', '2026-11-09', '2026-11-12')];
	const result = refreshAutomaticMonthLayout(events, state(['2026-11-01'], { protected: 0, automatic: 4 }), false);
	assert.deepEqual(rows(events, result, false), { protected: 0, automatic: 1 });
});
