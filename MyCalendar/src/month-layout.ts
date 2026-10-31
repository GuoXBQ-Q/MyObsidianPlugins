import type { CalendarEvent } from './types';
import { compareEvents, eventEndDate, isMultiDay } from './event-range';

/** Month-only positions. Other views continue to use the normal event comparator. */
export interface MonthLayoutState {
	version: 1;
	manualDates: string[];
	lanes: Record<string, number>;
}

export interface MonthDropPlan {
	valid: boolean;
	reason?: string;
	events: CalendarEvent[];
	layout: MonthLayoutState;
	changed: boolean;
}

const DAY = 86_400_000;
const validLane = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

function dateNumber(key: unknown): number | null {
	if (typeof key !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(key) || key.startsWith('0000')) return null;
	const [year, month, day] = key.split('-').map(Number);
	const date = new Date(0);
	date.setUTCHours(0, 0, 0, 0);
	date.setUTCFullYear(year, month - 1, day);
	return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
		? date.getTime() / DAY : null;
}

function dateKey(day: number): string | null {
	const date = new Date(day * DAY), year = date.getUTCFullYear();
	if (!Number.isFinite(year) || year < 1 || year > 9999) return null;
	return `${String(year).padStart(4, '0')}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}

const intersects = (a: CalendarEvent, b: CalendarEvent): boolean => a.date <= eventEndDate(b) && b.date <= eventEndDate(a);
const covers = (event: CalendarEvent, date: string): boolean => event.date <= date && eventEndDate(event) >= date;
const sameSpan = (a: CalendarEvent, b: CalendarEvent): boolean => a.date === b.date && eventEndDate(a) === eventEndDate(b);

export function emptyMonthLayout(): MonthLayoutState {
	return { version: 1, manualDates: [], lanes: {} };
}

/** Ignore stale IDs and malformed preferences without changing event data. */
export function normalizeMonthLayout(value: unknown, events: CalendarEvent[]): MonthLayoutState {
	if (!value || typeof value !== 'object' || (value as { version?: unknown }).version !== 1) return emptyMonthLayout();
	const input = value as { manualDates?: unknown; lanes?: unknown };
	const manualDates = Array.isArray(input.manualDates)
		? [...new Set(input.manualDates.filter((date): date is string => dateNumber(date) !== null))].sort() : [];
	const manual = new Set(manualDates);
	const inputLanes = input.lanes && typeof input.lanes === 'object' && !Array.isArray(input.lanes)
		? input.lanes as Record<string, unknown> : {};
	const lanes = Object.fromEntries(events
		.filter(event => (isMultiDay(event) || manual.has(event.date)) && Object.prototype.hasOwnProperty.call(inputLanes, event.id) && validLane(inputLanes[event.id]))
		.map(event => [event.id, inputLanes[event.id] as number]));
	return { version: 1, manualDates, lanes };
}

function rangesInOrder(events: CalendarEvent[], newEventsAtBottom: boolean): CalendarEvent[] {
	return events.filter(isMultiDay).sort((a, b) => newEventsAtBottom
		? compareEvents(a, b, true)
		: a.date.localeCompare(b.date) || eventEndDate(b).localeCompare(eventEndDate(a)) || a.id.localeCompare(b.id));
}

function rangeFits(event: CalendarEvent, lane: number, assigned: Map<string, number>, byId: Map<string, CalendarEvent>): boolean {
	for (const [id, occupiedLane] of assigned) {
		const other = byId.get(id);
		if (id !== event.id && occupiedLane === lane && other && intersects(event, other)) return false;
	}
	return true;
}

function firstRangeLane(event: CalendarEvent, start: number, assigned: Map<string, number>, byId: Map<string, CalendarEvent>): number {
	let lane = start;
	while (!rangeFits(event, lane, assigned, byId)) lane++;
	return lane;
}

function occupiedRangeLanes(events: CalendarEvent[], rangeLanes: Map<string, number>, date: string): Set<number> {
	return new Set(events.filter(event => isMultiDay(event) && covers(event, date)).map(event => rangeLanes.get(event.id)!).filter(validLane));
}

function nextFreeLane(start: number, occupied: Set<number>): number {
	let lane = start;
	while (occupied.has(lane)) lane++;
	return lane;
}

/** Preserve saved single-event order and gaps, moving downward only to avoid ranges. */
function manualSingleLanes(events: CalendarEvent[], manual: Set<string>, rangeLanes: Map<string, number>, preferences: Map<string, number>, newEventsAtBottom: boolean): Map<string, number> {
	const result = new Map<string, number>();
	const dates = new Set(events.filter(event => !isMultiDay(event) && manual.has(event.date)).map(event => event.date));
	for (const date of dates) {
		const occupied = occupiedRangeLanes(events, rangeLanes, date);
		const singles = events.filter(event => !isMultiDay(event) && event.date === date)
			.sort((a, b) => (preferences.get(a.id) ?? Infinity) - (preferences.get(b.id) ?? Infinity) || compareEvents(a, b, newEventsAtBottom));
		let previous = -1;
		for (const event of singles) {
			const lane = nextFreeLane(Math.max(previous + 1, preferences.get(event.id) ?? previous + 1), occupied);
			result.set(event.id, lane);
			previous = lane;
		}
	}
	return result;
}

/** Compute all rows without iterating through the days of a potentially long range. */
export function monthEventLanes(events: CalendarEvent[], state: MonthLayoutState, newEventsAtBottom: boolean): Map<string, number> {
	const layout = normalizeMonthLayout(state, events), manual = new Set(layout.manualDates);
	const byId = new Map(events.map(event => [event.id, event]));
	const ranges = rangesInOrder(events, newEventsAtBottom), assigned = new Map<string, number>();
	// Saved ranges have priority. Conflicting/corrupt preferences recover deterministically.
	for (const event of ranges) {
		const lane = layout.lanes[event.id];
		if (validLane(lane) && rangeFits(event, lane, assigned, byId)) assigned.set(event.id, lane);
	}
	// Unsaved ranges also respect saved single-day rows on manually arranged dates.
	const reserved = new Map(assigned);
	for (const event of events) {
		if (!isMultiDay(event) && manual.has(event.date) && validLane(layout.lanes[event.id])) reserved.set(event.id, layout.lanes[event.id]);
	}
	for (const event of ranges) {
		if (assigned.has(event.id)) continue;
		const lane = firstRangeLane(event, 0, reserved, byId);
		assigned.set(event.id, lane);
		reserved.set(event.id, lane);
	}
	const preferences = new Map(Object.entries(layout.lanes));
	for (const [id, lane] of manualSingleLanes(events, manual, assigned, preferences, newEventsAtBottom)) assigned.set(id, lane);
	const dates = new Set(events.filter(event => !isMultiDay(event) && !manual.has(event.date)).map(event => event.date));
	for (const date of dates) {
		const occupied = occupiedRangeLanes(events, assigned, date);
		const singles = events.filter(event => !isMultiDay(event) && event.date === date).sort((a, b) => compareEvents(a, b, newEventsAtBottom));
		let lane = 0;
		for (const event of singles) {
			lane = nextFreeLane(lane, occupied);
			assigned.set(event.id, lane++);
		}
	}
	return assigned;
}

function saveLayout(events: CalendarEvent[], manualDates: string[], rangeLanes: Map<string, number>, singles: Map<string, number>, newEventsAtBottom: boolean): MonthLayoutState {
	const manual = new Set(manualDates);
	const lanes = new Map(rangeLanes);
	for (const [id, lane] of manualSingleLanes(events, manual, rangeLanes, singles, newEventsAtBottom)) lanes.set(id, lane);
	return normalizeMonthLayout({ version: 1, manualDates, lanes: Object.fromEntries(lanes) }, events);
}

/**
 * Explicit sorting changes and ordinary structural edits refresh the automatic
 * part of the month. A range touching a manual date keeps its shared row on
 * every date; unrelated ranges follow the normal global allocation again.
 * A drag deliberately does not call this: its nonparticipants must stay put.
 */
export function refreshAutomaticMonthLayout(events: CalendarEvent[], state: MonthLayoutState, newEventsAtBottom: boolean): MonthLayoutState {
	const base = normalizeMonthLayout(state, events);
	if (!base.manualDates.length) return emptyMonthLayout();
	const protectedLanes = Object.fromEntries(events
		.filter(event => !isMultiDay(event) || base.manualDates.some(date => covers(event, date)))
		.filter(event => validLane(base.lanes[event.id]))
		.map(event => [event.id, base.lanes[event.id]]));
	const resolved = monthEventLanes(events, { ...base, lanes: protectedLanes }, newEventsAtBottom);
	const ranges = new Map(events.filter(isMultiDay).map(event => [event.id, resolved.get(event.id)!]));
	return saveLayout(events, base.manualDates, ranges, resolved, newEventsAtBottom);
}

/**
 * targetDate is the resulting START date, targetLane is the exact zero-based row.
 * The controller only permits grabbing a range on its true start date.
 */
export function planMonthDrop(events: CalendarEvent[], state: MonthLayoutState, newEventsAtBottom: boolean, eventId: string, targetDate: string, targetLane: number): MonthDropPlan {
	const base = normalizeMonthLayout(state, events);
	const reject = (reason: string): MonthDropPlan => ({ valid: false, reason, events, layout: base, changed: false });
	const moving = events.find(event => event.id === eventId);
	if (!moving) return reject('日程已被删除，请刷新后重试');
	if (!validLane(targetLane) || targetLane > Number.MAX_SAFE_INTEGER - events.length - 1) return reject('请选择有效的日程位置');
	const sourceDay = dateNumber(moving.date), targetDay = dateNumber(targetDate), endDay = dateNumber(eventEndDate(moving));
	if (sourceDay === null || targetDay === null || endDay === null || endDay < sourceDay) return reject('请选择有效日期');
	const newEndDate = dateKey(targetDay + endDay - sourceDay);
	if (!newEndDate) return reject('移动后的日期超出支持范围');
	const previousLanes = monthEventLanes(events, base, newEventsAtBottom);
	if (moving.date === targetDate && previousLanes.get(moving.id) === targetLane) {
		return { valid: true, events, layout: base, changed: false };
	}
	const moved: CalendarEvent = { ...moving, date: targetDate, ...(moving.endDate !== undefined ? { endDate: newEndDate } : {}) };
	const nextEvents = events.map(event => event.id === moving.id ? moved : event);
	const byId = new Map(nextEvents.map(event => [event.id, event]));
	const rangeLanes = new Map(events.filter(isMultiDay).filter(event => event.id !== moving.id).map(event => [event.id, previousLanes.get(event.id)!]));
	const fixed = new Set(events.filter(event => event.id !== moving.id && isMultiDay(event) && event.date < targetDate && covers(event, targetDate)).map(event => previousLanes.get(event.id)!));
	if (fixed.has(targetLane)) return reject('该位置由跨天日程的后续日期占用，不能移动到这里');
	const others = events.filter(event => event.id !== moving.id && event.date === targetDate)
		.sort((a, b) => previousLanes.get(a.id)! - previousLanes.get(b.id)!);
	// A downward same-day move passes the item currently at the destination row.
	const movingDown = moving.date === targetDate && previousLanes.get(moving.id)! < targetLane;
	const before = others.filter(event => movingDown ? previousLanes.get(event.id)! <= targetLane : previousLanes.get(event.id)! < targetLane);
	const after = others.slice(before.length);
	const singlePreferences = new Map(previousLanes);
	const place = (event: CalendarEvent, lane: number) => {
		if (isMultiDay(event)) rangeLanes.set(event.id, lane);
		else singlePreferences.set(event.id, lane);
	};
	let lane = 0;
	for (const event of before) {
		lane = nextFreeLane(lane, fixed);
		if (lane >= targetLane) return reject('该位置没有足够的可用行');
		place(event, lane++);
	}
	place(moved, targetLane);
	lane = targetLane + 1;
	for (const event of after) {
		lane = nextFreeLane(lane, fixed);
		place(event, lane++);
	}
	// Only ranges are immovable obstacles outside the target date. Future singles
	// may make room while retaining their relative order.
	const checked = new Map<string, number>();
	for (const event of nextEvents.filter(isMultiDay)) {
		const row = rangeLanes.get(event.id)!;
		if (!rangeFits(event, row, checked, byId)) return reject('移动会使跨天日程在其他日期重叠，请选择其他位置');
		checked.set(event.id, row);
	}
	const manualDates = [...new Set([...base.manualDates, moving.date, targetDate])];
	const layout = saveLayout(nextEvents, manualDates, rangeLanes, singlePreferences, newEventsAtBottom);
	return { valid: true, events: nextEvents, layout, changed: true };
}

/** Keep manual positions intact across ordinary add/edit/delete operations. */
export function reconcileMonthLayout(previousEvents: CalendarEvent[], nextEvents: CalendarEvent[], state: MonthLayoutState, newEventsAtBottom: boolean): MonthLayoutState {
	const base = normalizeMonthLayout(state, previousEvents);
	if (!base.manualDates.length && !Object.keys(base.lanes).length) return emptyMonthLayout();
	const manual = new Set(base.manualDates), previousById = new Map(previousEvents.map(event => [event.id, event]));
	const previousLanes = monthEventLanes(previousEvents, base, newEventsAtBottom);
	const byId = new Map(nextEvents.map(event => [event.id, event]));
	const assigned = new Map<string, number>();
	const entrants: CalendarEvent[] = [];
	let structuralChange = previousEvents.length !== nextEvents.length;
	for (const event of nextEvents) {
		const previous = previousById.get(event.id);
		if (previous && sameSpan(previous, event)) assigned.set(event.id, previousLanes.get(event.id)!);
		else { entrants.push(event); structuralChange = true; }
	}
	const bottomAt = (date: string): number => Math.max(-1, ...[...assigned].filter(([id]) => {
		const event = byId.get(id)!;
		return covers(event, date) && (isMultiDay(event) || manual.has(date));
	}).map(([, lane]) => lane)) + 1;
	entrants.sort((a, b) => compareEvents(a, b, newEventsAtBottom));
	for (const event of entrants) {
		const previous = previousById.get(event.id);
		if (isMultiDay(event)) {
			const obstacles = new Map([...assigned].filter(([id]) => isMultiDay(byId.get(id)!) || byId.get(id)!.date === event.date && manual.has(event.date)));
			const previousLane = previous && previous.date === event.date && isMultiDay(previous) ? previousLanes.get(event.id) : undefined;
			const lane = previousLane !== undefined && rangeFits(event, previousLane, obstacles, byId)
				? previousLane : firstRangeLane(event, manual.has(event.date) ? bottomAt(event.date) : 0, obstacles, byId);
			assigned.set(event.id, lane);
		} else if (manual.has(event.date)) assigned.set(event.id, bottomAt(event.date));
	}
	const ranges = new Map([...assigned].filter(([id]) => isMultiDay(byId.get(id)!)));
	const layout = saveLayout(nextEvents, base.manualDates, ranges, assigned, newEventsAtBottom);
	return structuralChange ? refreshAutomaticMonthLayout(nextEvents, layout, newEventsAtBottom) : layout;
}
