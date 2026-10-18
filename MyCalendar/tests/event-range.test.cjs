const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');
const esbuild = require('esbuild');
const code = esbuild.buildSync({ entryPoints: [path.join(__dirname, '../src/event-range.ts')], bundle: true, write: false, platform: 'node', format: 'cjs' }).outputFiles[0].text;
const compiled = new Module(__filename); compiled._compile(code, __filename);
const { indexEvents, rangeSegments, eventDescription, isMultiDay, eventEndDate } = compiled.exports;
const ev = (id, date, endDate) => ({ id, title: id, date, endDate, color: 'blue', createdAt: 0 });

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
