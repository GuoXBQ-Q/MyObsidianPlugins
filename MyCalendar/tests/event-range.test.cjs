const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');
const esbuild = require('esbuild');
const code = esbuild.buildSync({ entryPoints: [path.join(__dirname, '../src/event-range.ts')], bundle: true, write: false, platform: 'node', format: 'cjs' }).outputFiles[0].text;
const compiled = new Module(__filename); compiled._compile(code, __filename);
const { indexEvents, rangeSegments, monthRangeSegments, freeDayLanes, rangeLaneCount, eventDescription, isMultiDay, eventEndDate, compareEvents } = compiled.exports;
const ev = (id, date, endDate) => ({ id, title: id, date, endDate, color: 'blue', createdAt: 0 });

test('new events stay below existing events despite earlier times or titles, and editing preserves order', () => {
	const older = { ...ev('Z', '2026-11-06'), startTime: '14:00', createdAt: 100 };
	const newer = { ...ev('A', '2026-11-06'), startTime: '09:00', createdAt: 200 };
	const events = [newer, older];
	const ids = bottom => indexEvents(events, new Date(2026, 10, 6), 1, bottom).get('2026-11-06').map(e => e.id);
	assert.deepEqual(ids(true), ['Z', 'A']);
	assert.deepEqual(ids(false), ['A', 'Z']);
	older.title = '改过的标题'; older.startTime = '18:00';
	assert.deepEqual(ids(true), ['Z', 'A']);
	assert.deepEqual(events, [newer, older], 'sorting does not mutate storage');
	assert(compareEvents(older, newer, true) < 0, 'agenda uses the same comparator');
});

test('equal or missing legacy timestamps preserve saved order; time mode retains title ordering', () => {
	const first = ev('Z', '2026-11-06'), second = ev('A', '2026-11-06');
	delete first.createdAt; delete second.createdAt;
	const events = [first, second];
	assert.deepEqual(indexEvents(events, new Date(2026, 10, 6), 1, true).get(first.date), events);
	assert.deepEqual(indexEvents(events, new Date(2026, 10, 6), 1, false).get(first.date), [second, first]);
	first.createdAt = second.createdAt = 100;
	assert.deepEqual(indexEvents(events, new Date(2026, 10, 6), 1, true).get(first.date), events);
});

test('new overlapping multi-day bars stay below older bars even with earlier start dates', () => {
	const older = { ...ev('old', '2026-11-04', '2026-11-06'), createdAt: 100 };
	const newer = { ...ev('new', '2026-11-02', '2026-11-07'), createdAt: 200 };
	const disjoint = { ...ev('later', '2026-11-08', '2026-11-09'), createdAt: 300 };
	const spans = rangeSegments([older, newer, disjoint], new Date(2026, 10, 2), 7, true);
	assert.deepEqual(spans.map(s => [s.ev.id, s.lane]), [['old', 0], ['new', 1], ['later', 0]]);
	assert.equal(rangeSegments([older, newer], new Date(2026, 10, 2), 7, false)[0].ev, newer);
});

test('single-day events remain single and an inclusive multi-day event uses the same object on every day', () => {
	const meeting = ev('天津会议', '2026-11-06', '2026-11-09'), single = ev('单日', '2026-11-07');
	const map = indexEvents([meeting, single], new Date(2026, 10, 5), 6);
	assert.equal(map.get('2026-11-05').length, 0);
	for (const date of ['06', '07', '08', '09']) assert(map.get('2026-11-' + date).includes(meeting));
	assert.equal(map.get('2026-11-10').length, 0);
	assert.equal(map.get('2026-11-07').length, 2);
	assert.equal(isMultiDay(single), false); assert.equal(eventEndDate(single), single.date);
});

test('range crosses weeks as two clipped segments, with correct continuation ends', () => {
	const meeting = ev('天津会议', '2026-11-06', '2026-11-09');
	const first = rangeSegments([meeting], new Date(2026, 10, 2))[0];
	const second = rangeSegments([meeting], new Date(2026, 10, 9))[0];
	assert.deepEqual([first.start, first.end, first.continuesBefore, first.continuesAfter], [4, 6, false, true]);
	assert.deepEqual([second.start, second.end, second.continuesBefore, second.continuesAfter], [0, 0, true, false]);
	assert.equal(first.ev, second.ev);
});

test('overlapping ranges get different lanes, non-overlapping ranges can share a lane', () => {
	const spans = rangeSegments([ev('a', '2026-11-02', '2026-11-04'), ev('b', '2026-11-04', '2026-11-06'), ev('c', '2026-11-05', '2026-11-08')], new Date(2026, 10, 2));
	assert.notEqual(spans[0].lane, spans[1].lane);
	assert.equal(spans[0].lane, spans[2].lane);
});

test('November 4 and 11 reserve no empty rows for ranges on other dates of the same week', () => {
	const events = [ev('conference', '2026-11-05', '2026-11-08'), ev('inscrypt', '2026-11-06', '2026-11-10'), ev('single-4', '2026-11-04'), ev('single-11', '2026-11-11')];
	for (const bottom of [false, true]) {
		const first = rangeSegments(events, new Date(2026, 10, 2), 7, bottom);
		const second = rangeSegments(events, new Date(2026, 10, 9), 7, bottom);
		assert.deepEqual(Array.from({length:7}, (_, day) => rangeLaneCount(first, day)), [0, 0, 0, 1, 2, 2, 2]);
		assert.deepEqual(Array.from({length:7}, (_, day) => rangeLaneCount(second, day)), [1, 1, 0, 0, 0, 0, 0]);
	}
});

test('days intersecting a lower range lane still reserve enough space to avoid overlap', () => {
	const spans = rangeSegments([ev('older', '2026-11-02', '2026-11-03'), ev('newer', '2026-11-02', '2026-11-06')], new Date(2026, 10, 2), 7, true);
	assert.equal(rangeLaneCount(spans, 2), 2, 'preserve the lower bar even when its upper lane is empty on this day');
	assert.equal(rangeLaneCount(spans, 4), 2, 'end date is inclusive');
	assert.equal(rangeLaneCount(spans, 5), 0);assert.equal(rangeLaneCount([], 0), 0);
});

test('cross-month, leap day, year-end, Sunday start and day view boundaries', () => {
	const dates = [
		[ev('月', '2026-10-30', '2026-11-03'), new Date(2026, 10, 1), 3],
		[ev('闰年', '2028-02-28', '2028-03-01'), new Date(2028, 1, 28), 3],
		[ev('年', '2026-12-31', '2027-01-02'), new Date(2026, 11, 31), 3],
	];
	for (const [event, start, count] of dates) for (const values of indexEvents([event], start, count).values()) assert.equal(values[0], event);
	const event = ev('日', '2026-11-06', '2026-11-09');
	const sunday = rangeSegments([event], new Date(2026, 10, 8))[0];
	assert.deepEqual([sunday.start, sunday.end], [0, 1]);
	const day = rangeSegments([event], new Date(2026, 10, 8), 1)[0];
	assert.deepEqual([day.start, day.end, day.continuesBefore, day.continuesAfter], [0, 0, true, true]);
});

test('very long ranges are bounded to the visible window and descriptions retain both times and notes', () => {
	const event = { ...ev('会议', '2026-11-06', '2036-11-09'), startTime: '18:00', endTime: '09:00', note: '天津' };
	assert.equal(indexEvents([event], new Date(2026, 10, 1), 42).size, 42);
	assert.equal(rangeSegments([event], new Date(2027, 0, 1))[0].end, 6);
	assert.match(eventDescription(event), /2026-11-06 18:00 至 2036-11-09 09:00.*天津/);
});

test('month continuations retain their original lanes while daily and weekly views remain compact', () => {
	const events = [ev('conference', '2026-11-05', '2026-11-08'), ev('inscrypt', '2026-11-06', '2026-11-10')];
	for (const bottom of [false, true]) {
		const weeks = monthRangeSegments(events, new Date(2026, 10, 2), 14, bottom);
		assert.deepEqual(weeks[0].map(span => [span.ev.id, span.lane]), [['conference', 0], ['inscrypt', 1]]);
		assert.deepEqual(weeks[1].map(span => [span.ev.id, span.start, span.end, span.lane]), [['inscrypt', 0, 1, 1]]);
		assert.equal(weeks[1][0].continuesBefore, true);
		assert.equal(weeks[1][0].continuesAfter, false);
		assert.equal(rangeSegments(events, new Date(2026, 10, 9), 7, bottom)[0].lane, 0, 'week view compacts its own visible range');
		assert.equal(rangeSegments(events, new Date(2026, 10, 9), 1, bottom)[0].lane, 0, 'day view also remains compact');
	}
});

test('month lanes agree across viewport boundaries and reload even when the original blocker is outside the view', () => {
	const events = [ev('blocker', '2026-10-01', '2026-10-20'), ev('long', '2026-10-15', '2026-11-18')];
	const before = JSON.stringify(events);
	for (const bottom of [false, true]) for (const first of [new Date(2026, 8, 28), new Date(2026, 9, 26), new Date(2026, 10, 2)]) {
		const parts = monthRangeSegments(events, first, 42, bottom).flat().filter(span => span.ev.id === 'long');
		assert(parts.length > 0 && parts.every(span => span.lane === 1));
		const reloaded = JSON.parse(before);
		assert.deepEqual(monthRangeSegments(reloaded, first, 42, bottom).map(week => week.map(span => [span.ev.id, span.lane])),
			monthRangeSegments(events, first, 42, bottom).map(week => week.map(span => [span.ev.id, span.lane])));
	}
	assert.equal(JSON.stringify(events), before, 'layout cannot mutate saved order or events');
});

test('deleting or shortening an upper range recomputes every continuation together', () => {
	const blocker = ev('conference', '2026-11-05', '2026-11-08'), long = ev('inscrypt', '2026-11-06', '2026-11-10');
	const lanes = events => monthRangeSegments(events, new Date(2026, 10, 2), 14, true).flat().filter(span => span.ev.id === 'inscrypt').map(span => span.lane);
	assert.deepEqual(lanes([blocker, long]), [1, 1]);
	assert.deepEqual(lanes([long]), [0, 0]);
	assert.deepEqual(lanes([{ ...blocker, endDate: '2026-11-05' }, long]), [0, 0]);
});

test('new ranges reuse the upper hole only when their entire inclusive interval fits', () => {
	const older = { ...ev('conference', '2026-11-05', '2026-11-08'), createdAt: 100 };
	const continued = { ...ev('inscrypt', '2026-11-06', '2026-11-10'), createdAt: 200 };
	const fit = { ...ev('new', '2026-11-09', '2026-11-11'), createdAt: 300 };
	const lanes = (events, id) => monthRangeSegments(events, new Date(2026, 10, 2), 14, true).flat().filter(span => span.ev.id === id).map(span => span.lane);
	assert.deepEqual(lanes([older, continued, fit], 'new'), [0]);
	assert.deepEqual(lanes([older, continued, { ...fit, date: '2026-11-08' }], 'new'), [2, 2], 'a shared end/start day is occupied');
	const laterBlocker = { ...ev('later blocker', '2026-11-12', '2026-11-13'), createdAt: 250 };
	assert.deepEqual(lanes([older, continued, laterBlocker, { ...fit, endDate: '2026-11-12' }], 'new'), [2], 'a collision later in the range must also prevent reuse');
});

test('month range order uses the existing creation preference and preserves equal legacy ordering', () => {
	const older = { ...ev('Z', '2026-11-04', '2026-11-06'), createdAt: 100 };
	const newer = { ...ev('A', '2026-11-02', '2026-11-07'), createdAt: 200 };
	assert.deepEqual(monthRangeSegments([older, newer], new Date(2026, 10, 2), 7, true)[0].map(span => [span.ev.id, span.lane]), [['Z', 0], ['A', 1]]);
	assert.deepEqual(monthRangeSegments([older, newer], new Date(2026, 10, 2), 7, false)[0].map(span => [span.ev.id, span.lane]), [['A', 0], ['Z', 1]]);
	delete older.createdAt; delete newer.createdAt;
	assert.deepEqual(monthRangeSegments([older, newer], new Date(2026, 10, 2), 7, true)[0].map(span => [span.ev.id, span.lane]), [['Z', 0], ['A', 1]]);
});

test('single-day slots and the overflow link fill holes without displacing continued ranges', () => {
	const spans = monthRangeSegments([ev('conference', '2026-11-05', '2026-11-08'), ev('inscrypt', '2026-11-06', '2026-11-10')], new Date(2026, 10, 2), 14, true);
	assert.deepEqual(freeDayLanes(spans[0], 4, 4), [2, 3, 4, 5], 'occupied first and second lanes are both skipped');
	assert.deepEqual(freeDayLanes(spans[1], 0, 4), [0, 2, 3, 4], 'single items and the more link can use the first lane above a continuation');
	assert.deepEqual(freeDayLanes(spans[1], 2, 4), [0, 1, 2, 3], 'unrelated days keep all rows free');
	assert.deepEqual(freeDayLanes([], 0, 0), []);
	const withSingles = [ev('conference', '2026-11-05', '2026-11-08'), ev('inscrypt', '2026-11-06', '2026-11-10'), ev('single', '2026-11-09')];
	assert.deepEqual(monthRangeSegments(withSingles, new Date(2026, 10, 9), 7, true)[0].map(span => [span.ev.id, span.lane]), [['inscrypt', 1]], 'hidden or visible single items do not move range bars');
});

test('month clipping stays bounded for decades-long ranges, partial weeks and year boundaries', () => {
	const events = [ev('blocker', '1900-01-01', '1900-02-01'), ev('centuries', '1900-01-31', '2099-12-31')];
	const weeks = monthRangeSegments(events, new Date(2026, 11, 28), 10, true);
	assert.equal(weeks.length, 2);
	assert.deepEqual(weeks.map(week => week.map(span => [span.start, span.end, span.lane, span.continuesBefore, span.continuesAfter])),
		[[[0, 6, 1, true, true]], [[0, 2, 1, true, true]]]);
	assert.equal(monthRangeSegments(events, new Date(2026, 11, 28), 0).length, 0);
	const leap = monthRangeSegments([ev('leap', '2028-02-28', '2028-03-01')], new Date(2028, 1, 27), 7)[0][0];
	assert.deepEqual([leap.start, leap.end], [1, 3]);
});
