import { CalendarEvent } from './types';
import { addDays, fmtDate } from './utils';

export const eventEndDate = (ev: CalendarEvent): string => ev.endDate ?? ev.date;
export const isMultiDay = (ev: CalendarEvent): boolean => eventEndDate(ev) > ev.date;

export function eventDescription(ev: CalendarEvent): string {
	const when = isMultiDay(ev)
		? `${ev.date}${ev.startTime ? ' ' + ev.startTime : ''} 至 ${eventEndDate(ev)}${ev.endTime ? ' ' + ev.endTime : ''}`
		: ev.startTime ? ev.startTime + (ev.endTime ? '–' + ev.endTime : '') : '全天';
	return `${ev.title} · ${when}${ev.important ? ' · 重要日程' : ''}${ev.note ? ' · ' + ev.note : ''}`;
}

/** Index only visible days, even for a range spanning many years. */
export function indexEvents(events: CalendarEvent[], start: Date, count: number): Map<string, CalendarEvent[]> {
	const map = new Map<string, CalendarEvent[]>();
	for (let i = 0; i < count; i++) {
		const key = fmtDate(addDays(start, i));
		map.set(key, events.filter(ev => ev.date <= key && eventEndDate(ev) >= key)
			.sort((a, b) => (a.startTime ?? '').localeCompare(b.startTime ?? '') || a.title.localeCompare(b.title)));
	}
	return map;
}

export interface RangeSegment {
	ev: CalendarEvent;
	start: number;
	end: number;
	lane: number;
	continuesBefore: boolean;
	continuesAfter: boolean;
}

/** Clip ranges to a visible week/day, assigning non-overlapping horizontal lanes. */
export function rangeSegments(events: CalendarEvent[], start: Date, count = 7): RangeSegment[] {
	const days = Array.from({ length: count }, (_, i) => fmtDate(addDays(start, i)));
	const spans = events.filter(ev => isMultiDay(ev) && ev.date <= days[count - 1] && eventEndDate(ev) >= days[0])
		.map(ev => ({ ev, start: Math.max(0, days.findIndex(day => day >= ev.date)),
			end: days.reduce((end, day, i) => day <= eventEndDate(ev) ? i : end, 0),
			lane: 0, continuesBefore: ev.date < days[0], continuesAfter: eventEndDate(ev) > days[count - 1] }))
		.sort((a, b) => a.start - b.start || b.end - a.end || a.ev.id.localeCompare(b.ev.id));
	const ends: number[] = [];
	for (const span of spans) {
		let lane = ends.findIndex(end => end < span.start);
		if (lane < 0) lane = ends.length;
		span.lane = lane; ends[lane] = span.end;
	}
	return spans;
}

/** Shared grid placement for native calendar and homepage bars. */
export function placeRangeBar(bar: HTMLElement, span: RangeSegment, row: number, top: number, step: number): void {
	bar.style.gridRow = String(row);
	bar.style.gridColumn = `${span.start + 1} / ${span.end + 2}`;
	bar.style.marginTop = `${top + span.lane * step}px`;
	bar.classList.toggle('mc-range-before', span.continuesBefore);
	bar.classList.toggle('mc-range-after', span.continuesAfter);
	bar.setAttribute('aria-label', eventDescription(span.ev));
	bar.dataset.eventId = span.ev.id;
	if (span.continuesBefore) bar.prepend(bar.ownerDocument.createTextNode('‹ '));
	if (span.continuesAfter) bar.append(bar.ownerDocument.createTextNode(' ›'));
}
