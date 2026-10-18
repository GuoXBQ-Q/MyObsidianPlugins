import { CalendarEvent } from './types';

export const pad2 = (n: number): string => String(n).padStart(2, '0');

/** Date -> 'YYYY-MM-DD' */
export function fmtDate(d: Date): string {
	return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

export function todayKey(): string {
	return fmtDate(new Date());
}

/** 'YYYY-MM-DD' -> 本地时区 Date */
export function parseDateKey(key: string): Date {
	const [y, m, d] = key.split('-').map(Number);
	return new Date(y, m - 1, d);
}

export function addDays(d: Date, n: number): Date {
	const r = new Date(d);
	r.setDate(r.getDate() + n);
	return r;
}

export function addMonths(y: number, m: number, delta: number): { y: number; m: number } {
	const t = m - 1 + delta;
	return { y: y + Math.floor(t / 12), m: ((t % 12) + 12) % 12 + 1 };
}

export function daysInMonth(y: number, m: number): number {
	return new Date(y, m, 0).getDate();
}

export function startOfWeek(d: Date, weekStart: 'monday' | 'sunday'): Date {
	const day = d.getDay();
	const diff = weekStart === 'monday' ? (day + 6) % 7 : day;
	return addDays(d, -diff);
}

const WD_CN = ['日', '一', '二', '三', '四', '五', '六'];

export function weekdayShort(d: Date): string {
	return WD_CN[d.getDay()];
}

export function weekdayLong(d: Date): string {
	return `星期${WD_CN[d.getDay()]}`;
}

export function weekdayLabels(weekStart: 'monday' | 'sunday'): string[] {
	return weekStart === 'monday' ? ['一', '二', '三', '四', '五', '六', '日'] : ['日', '一', '二', '三', '四', '五', '六'];
}

export function hexToRgba(hex: string, alpha: number): string {
	const h = hex.replace('#', '');
	const r = parseInt(h.slice(0, 2), 16);
	const g = parseInt(h.slice(2, 4), 16);
	const b = parseInt(h.slice(4, 6), 16);
	return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export function uid(): string {
	return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

/** 'HH:mm' -> 分钟数 */
export function toMin(t?: string): number {
	if (!t) return 0;
	const [h, m] = t.split(':').map(Number);
	return h * 60 + (m || 0);
}

/** '09:00' -> '9:00'，去掉多余前导零便于在 chip 内展示 */
export function fmtTimeShort(t?: string): string {
	if (!t) return '';
	const [h, m] = t.split(':').map(Number);
	return m ? `${h}:${pad2(m)}` : `${h}:00`;
}

export interface EventColor {
	id: string;
	label: string;
	color: string;
}

export const EVENT_COLORS: EventColor[] = [
	{ id: 'blue', label: '蓝色', color: '#4c8bf5' },
	{ id: 'green', label: '绿色', color: '#34a853' },
	{ id: 'amber', label: '橙色', color: '#f5a623' },
	{ id: 'purple', label: '紫色', color: '#9b6bf2' },
	{ id: 'pink', label: '粉色', color: '#f06292' },
	{ id: 'teal', label: '青色', color: '#26a69a' },
	{ id: 'red', label: '珊瑚红', color: '#e76f6f' },
	{ id: 'orange', label: '柑橘橙', color: '#ed8936' },
	{ id: 'yellow', label: '向日葵', color: '#d8b53f' },
	{ id: 'lime', label: '青柠绿', color: '#8eac50' },
	{ id: 'mint', label: '薄荷绿', color: '#63b89b' },
	{ id: 'cyan', label: '湖水蓝', color: '#38a9c4' },
	{ id: 'indigo', label: '靛蓝', color: '#6974cf' },
	{ id: 'lavender', label: '薰衣草', color: '#b18bd2' },
	{ id: 'rose', label: '玫瑰红', color: '#c96687' },
	{ id: 'peach', label: '蜜桃色', color: '#d99b83' },
	{ id: 'brown', label: '可可棕', color: '#a0806c' },
	{ id: 'slate', label: '雾灰蓝', color: '#8293a8' },
];

/** Accept #RGB / #RRGGBB, storing custom colors in a single canonical format. */
export function normalizeHex(value: string): string | null {
	const hex = value.trim().replace(/^#/, '');
	if (/^[0-9a-f]{3}$/i.test(hex)) return '#' + [...hex].map((c) => c + c).join('').toLowerCase();
	return /^[0-9a-f]{6}$/i.test(hex) ? '#' + hex.toLowerCase() : null;
}

export function colorOf(id: string): string {
	return EVENT_COLORS.find((c) => c.id === id)?.color ?? normalizeHex(id) ?? EVENT_COLORS[0].color;
}

export interface LaneItem {
	ev: CalendarEvent;
	lane: number;
	total: number;
}

/** 周/日视图时间块的多列排布：时间重叠的事件分配到不同竖列 */
export function assignLanes(evs: CalendarEvent[]): LaneItem[] {
	const items = evs.map((ev) => ({
		ev,
		s: toMin(ev.startTime),
		e: Math.max(toMin(ev.endTime), toMin(ev.startTime) + 30),
	}));
	items.sort((a, b) => a.s - b.s || a.e - b.e);
	const laneEnds: number[] = [];
	const out: LaneItem[] = [];
	for (const it of items) {
		let lane = laneEnds.findIndex((end) => end <= it.s);
		if (lane === -1) {
			lane = laneEnds.length;
			laneEnds.push(0);
		}
		laneEnds[lane] = it.e;
		out.push({ ev: it.ev, lane, total: 1 });
	}
	const total = Math.max(1, laneEnds.length);
	for (const o of out) o.total = total;
	return out;
}
