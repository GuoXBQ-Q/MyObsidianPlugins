import { addDays, fmtDate, parseDateKey } from './utils';
import { getSolarTerm, solarToLunar } from './lunar';

/**
 * 中国法定节假日与调休安排。
 * 放假/调休由国务院办公厅每年年底发布下一年的通知，无法用算法推算，
 * 需要按年维护数据；来源为历年的《国务院办公厅关于 XX 年部分节假日安排的通知》。
 *
 * 新增年份时在 ARRANGEMENTS 里加一条即可。
 */

export interface HolidayInfo {
	/** holiday = 放假日，work = 调休上班日 */
	type: 'holiday' | 'work';
	/** 所属节假日名称，如 '春节' */
	name: string;
}

interface YearArrangement {
	/** 放假区间（含起止两端） */
	ranges: { start: string; end: string; name: string }[];
	/** 调休上班日 */
	workdays: { date: string; name: string }[];
}

// prettier-ignore
const ARRANGEMENTS: Record<number, YearArrangement> = {
	2025: {
		ranges: [
			{ start: '2025-01-01', end: '2025-01-01', name: '元旦' },
			{ start: '2025-01-28', end: '2025-02-04', name: '春节' },
			{ start: '2025-04-04', end: '2025-04-06', name: '清明节' },
			{ start: '2025-05-01', end: '2025-05-05', name: '劳动节' },
			{ start: '2025-05-31', end: '2025-06-02', name: '端午节' },
			{ start: '2025-10-01', end: '2025-10-08', name: '国庆节·中秋节' },
		],
		workdays: [
			{ date: '2025-01-26', name: '春节' },
			{ date: '2025-02-08', name: '春节' },
			{ date: '2025-04-27', name: '劳动节' },
			{ date: '2025-09-28', name: '国庆节' },
			{ date: '2025-10-11', name: '国庆节' },
		],
	},
	2026: {
		ranges: [
			{ start: '2026-01-01', end: '2026-01-03', name: '元旦' },
			{ start: '2026-02-15', end: '2026-02-23', name: '春节' },
			{ start: '2026-04-04', end: '2026-04-06', name: '清明节' },
			{ start: '2026-05-01', end: '2026-05-05', name: '劳动节' },
			{ start: '2026-06-19', end: '2026-06-21', name: '端午节' },
			{ start: '2026-09-25', end: '2026-09-27', name: '中秋节' },
			{ start: '2026-10-01', end: '2026-10-07', name: '国庆节' },
		],
		workdays: [
			{ date: '2026-01-04', name: '元旦' },
			{ date: '2026-02-14', name: '春节' },
			{ date: '2026-02-28', name: '春节' },
			{ date: '2026-05-09', name: '劳动节' },
			{ date: '2026-09-20', name: '国庆节' },
			{ date: '2026-10-10', name: '国庆节' },
		],
	},
};

const cache = new Map<number, Map<string, HolidayInfo>>();

function yearMap(year: number): Map<string, HolidayInfo> | null {
	const hit = cache.get(year);
	if (hit) return hit;
	const arr = ARRANGEMENTS[year];
	if (!arr) return null;
	const map = new Map<string, HolidayInfo>();
	for (const r of arr.ranges) {
		let d = parseDateKey(r.start);
		const end = parseDateKey(r.end);
		while (d <= end) {
			map.set(fmtDate(d), { type: 'holiday', name: r.name });
			d = addDays(d, 1);
		}
	}
	for (const w of arr.workdays) map.set(w.date, { type: 'work', name: w.name });
	cache.set(year, map);
	return map;
}

// ---------------- 在线获取的年份（设置页手动更新） ----------------

export interface HolidayDay {
	date: string;
	name: string;
	/** true = 放假，false = 调休上班 */
	isOffDay: boolean;
}

export interface FetchedArrangement {
	year: number;
	/** 数据来源名称，如 'holiday-cn (jsDelivr CDN)' */
	source: string;
	/** 获取时间戳 */
	updatedAt: number;
	days: HolidayDay[];
}

const fetchedMaps = new Map<number, Map<string, HolidayInfo>>();
const fetchedMeta = new Map<number, FetchedArrangement>();

/** 用 data.json 里保存的在线数据初始化（插件加载时调用） */
export function setFetchedArrangements(list?: FetchedArrangement[]): void {
	fetchedMaps.clear();
	fetchedMeta.clear();
	for (const item of list ?? []) {
		if (!item || typeof item.year !== 'number' || !Array.isArray(item.days)) continue;
		const m = new Map<string, HolidayInfo>();
		for (const d of item.days) {
			if (!d || typeof d.date !== 'string') continue;
			m.set(d.date, { type: d.isOffDay ? 'holiday' : 'work', name: d.name || '节假日' });
		}
		fetchedMaps.set(item.year, m);
		fetchedMeta.set(item.year, item);
	}
}

/** 已有在线数据的年份摘要（设置页展示用） */
export function fetchedYears(): { year: number; source: string; updatedAt: number; dayCount: number }[] {
	return Array.from(fetchedMeta.values())
		.sort((a, b) => a.year - b.year)
		.map((f) => ({ year: f.year, source: f.source, updatedAt: f.updatedAt, dayCount: f.days.length }));
}

/** 内置数据的年份列表 */
export const BUILT_IN_YEARS = Object.keys(ARRANGEMENTS)
	.map(Number)
	.sort((a, b) => a - b);

/** 没有官方安排数据的年份，退化为法定节日的当天单日标记（不含调休，仅供示意） */
function fallbackHoliday(date: Date): HolidayInfo | null {
	const y = date.getFullYear();
	if (fetchedMaps.has(y) || ARRANGEMENTS[y]) return null;
	const m = date.getMonth() + 1;
	const d = date.getDate();
	if (m === 1 && d === 1) return { type: 'holiday', name: '元旦' };
	if (m === 5 && d === 1) return { type: 'holiday', name: '劳动节' };
	if (m === 10 && d === 1) return { type: 'holiday', name: '国庆节' };
	if (getSolarTerm(date) === '清明') return { type: 'holiday', name: '清明节' };
	const l = solarToLunar(date);
	if (l && !l.isLeap) {
		if (l.month === 1 && l.day === 1) return { type: 'holiday', name: '春节' };
		if (l.month === 5 && l.day === 5) return { type: 'holiday', name: '端午节' };
		if (l.month === 8 && l.day === 15) return { type: 'holiday', name: '中秋节' };
	}
	return null;
}

/** 查询某天的法定节假日/调休信息，无则返回 null。在线数据 > 内置数据 > 法定节日估算 */
export function getHolidayInfo(date: Date): HolidayInfo | null {
	const key = fmtDate(date);
	const y = date.getFullYear();
	const fetchedHit = fetchedMaps.get(y)?.get(key);
	if (fetchedHit) return fetchedHit;
	const hit = yearMap(y)?.get(key);
	if (hit) return hit;
	return fallbackHoliday(date);
}
