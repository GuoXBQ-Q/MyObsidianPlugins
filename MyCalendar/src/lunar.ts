/**
 * 农历、二十四节气、传统节日计算。
 * 农历数据表范围 1900-2100，采用经典查表算法。
 */

// prettier-ignore
const LUNAR_INFO = [
	0x04bd8, 0x04ae0, 0x0a570, 0x054d5, 0x0d260, 0x0d950, 0x16554, 0x056a0, 0x09ad0, 0x055d2, // 1900-1909
	0x04ae0, 0x0a5b6, 0x0a4d0, 0x0d250, 0x1d255, 0x0b540, 0x0d6a0, 0x0ada2, 0x095b0, 0x14977, // 1910-1919
	0x04970, 0x0a4b0, 0x0b4b5, 0x06a50, 0x06d40, 0x1ab54, 0x02b60, 0x09570, 0x052f2, 0x04970, // 1920-1929
	0x06566, 0x0d4a0, 0x0ea50, 0x06e95, 0x05ad0, 0x02b60, 0x186e3, 0x092e0, 0x1c8d7, 0x0c950, // 1930-1939
	0x0d4a0, 0x1d8a6, 0x0b550, 0x056a0, 0x1a5b4, 0x025d0, 0x092d0, 0x0d2b2, 0x0a950, 0x0b557, // 1940-1949
	0x06ca0, 0x0b550, 0x15355, 0x04da0, 0x0a5b0, 0x14573, 0x052b0, 0x0a9a8, 0x0e950, 0x06aa0, // 1950-1959
	0x0aea6, 0x0ab50, 0x04b60, 0x0aae4, 0x0a570, 0x05260, 0x0f263, 0x0d950, 0x05b57, 0x056a0, // 1960-1969
	0x096d0, 0x04dd5, 0x04ad0, 0x0a4d0, 0x0d4d4, 0x0d250, 0x0d558, 0x0b540, 0x0b6a0, 0x195a6, // 1970-1979
	0x095b0, 0x049b0, 0x0a974, 0x0a4b0, 0x0b27a, 0x06a50, 0x06d40, 0x0af46, 0x0ab60, 0x09570, // 1980-1989
	0x04af5, 0x04970, 0x064b0, 0x074a3, 0x0ea50, 0x06b58, 0x055c0, 0x0ab60, 0x096d5, 0x092e0, // 1990-1999
	0x0c960, 0x0d954, 0x0d4a0, 0x0da50, 0x07552, 0x056a0, 0x0abb7, 0x025d0, 0x092d0, 0x0cab5, // 2000-2009
	0x0a950, 0x0b4a0, 0x0baa4, 0x0ad50, 0x055d9, 0x04ba0, 0x0a5b0, 0x15176, 0x052b0, 0x0a930, // 2010-2019
	0x07954, 0x06aa0, 0x0ad50, 0x05b52, 0x04b60, 0x0a6e6, 0x0a4e0, 0x0d260, 0x0ea65, 0x0d530, // 2020-2029
	0x05aa0, 0x076a3, 0x096d0, 0x04afb, 0x04ad0, 0x0a4d0, 0x1d0b6, 0x0d250, 0x0d520, 0x0dd45, // 2030-2039
	0x0b5a0, 0x056d0, 0x055b2, 0x049b0, 0x0a577, 0x0a4b0, 0x0aa50, 0x1b255, 0x06d20, 0x0ada0, // 2040-2049
	0x14b63, 0x09370, 0x049f8, 0x04970, 0x064b0, 0x168a6, 0x0ea50, 0x06b20, 0x1a6c4, 0x0aae0, // 2050-2059
	0x0a2e0, 0x0d2e3, 0x0c960, 0x0d557, 0x0d4a0, 0x0da50, 0x05d55, 0x056a0, 0x0a6d0, 0x055d4, // 2060-2069
	0x052d0, 0x0a9b8, 0x0a950, 0x0b4a0, 0x0b6a6, 0x0ad50, 0x055a0, 0x0aba4, 0x0a5b0, 0x052b0, // 2070-2079
	0x0b273, 0x06930, 0x07337, 0x06aa0, 0x0ad50, 0x14b55, 0x04b60, 0x0a570, 0x054e4, 0x0d160, // 2080-2089
	0x0e968, 0x0d520, 0x0daa0, 0x16aa6, 0x056d0, 0x04ae0, 0x0a9d4, 0x0a2d0, 0x0d150, 0x0f252, // 2090-2099
	0x0d520, // 2100
];

const LUNAR_MONTHS = ['正', '二', '三', '四', '五', '六', '七', '八', '九', '十', '冬', '腊'];
const CN_NUMS = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];

export interface LunarInfo {
	year: number;
	month: number;
	day: number;
	isLeap: boolean;
	/** 如 '初七' / '九月'（初一那天显示月份） */
	label: string;
	/** 如 '九月初七' */
	full: string;
}

export function lunarDayStr(d: number): string {
	if (d === 10) return '初十';
	if (d === 20) return '二十';
	if (d === 30) return '三十';
	if (d < 10) return '初' + CN_NUMS[d - 1];
	if (d < 20) return '十' + CN_NUMS[d - 11];
	return '廿' + CN_NUMS[d - 21];
}

function leapMonth(y: number): number {
	return LUNAR_INFO[y - 1900] & 0xf;
}

function leapDays(y: number): number {
	return leapMonth(y) ? (LUNAR_INFO[y - 1900] & 0x10000 ? 30 : 29) : 0;
}

export function lunarMonthDays(y: number, m: number): number {
	return (LUNAR_INFO[y - 1900] & (0x10000 >> m)) ? 30 : 29;
}

function lunarYearDays(y: number): number {
	let sum = 348;
	for (let i = 0x8000; i > 0x8; i >>= 1) sum += (LUNAR_INFO[y - 1900] & i) ? 1 : 0;
	return sum + leapDays(y);
}

/** 公历转农历，超出 1900-2100 范围返回 null */
export function solarToLunar(date: Date): LunarInfo | null {
	const y = date.getFullYear();
	const m = date.getMonth() + 1;
	const d = date.getDate();
	if (y < 1901 || y > 2100) return null;

	let offset = Math.floor((Date.UTC(y, m - 1, d) - Date.UTC(1900, 0, 31)) / 86400000);
	let i = 1900;
	let temp = 0;
	for (; i < 2101 && offset > 0; i++) {
		temp = lunarYearDays(i);
		offset -= temp;
	}
	if (offset < 0) {
		offset += temp;
		i--;
	}
	const lunarYear = i;

	const leap = leapMonth(lunarYear);
	let isLeap = false;
	for (i = 1; i < 13 && offset > 0; i++) {
		if (leap > 0 && i === leap + 1 && isLeap === false) {
			--i;
			isLeap = true;
			temp = leapDays(lunarYear);
		} else {
			temp = lunarMonthDays(lunarYear, i);
		}
		if (isLeap === true && i === leap + 1) isLeap = false;
		offset -= temp;
	}
	if (offset === 0 && leap > 0 && i === leap + 1) {
		if (isLeap) {
			isLeap = false;
		} else {
			isLeap = true;
			--i;
		}
	}
	if (offset < 0) {
		offset += temp;
		--i;
	}
	const lunarMonth = i;
	const lunarDay = offset + 1;

	const monthStr = (isLeap ? '闰' : '') + LUNAR_MONTHS[lunarMonth - 1] + '月';
	const dayStr = lunarDayStr(lunarDay);
	return {
		year: lunarYear,
		month: lunarMonth,
		day: lunarDay,
		isLeap,
		label: lunarDay === 1 ? monthStr : dayStr,
		full: monthStr + dayStr,
	};
}

// ---------------- 二十四节气 ----------------

// prettier-ignore
const TERM_INFO = [
	0, 21208, 42467, 63836, 85337, 107014, 128867, 150921, 173149, 195551,
	218072, 240693, 263343, 285989, 308563, 331033, 353350, 375494, 397447, 419210,
	440795, 462224, 483532, 504758,
];
const TERMS = ['小寒', '大寒', '立春', '雨水', '惊蛰', '春分', '清明', '谷雨', '立夏', '小满', '芒种', '夏至', '小暑', '大暑', '立秋', '处暑', '白露', '秋分', '寒露', '霜降', '立冬', '小雪', '大雪', '冬至'];

function termDay(year: number, n: number): number {
	const d = new Date(31556925974.7 * (year - 1900) + TERM_INFO[n] * 60000 + Date.UTC(1900, 0, 6, 2, 5));
	return d.getUTCDate();
}

/** 当天是否为节气，是则返回节气名 */
export function getSolarTerm(date: Date): string | null {
	const y = date.getFullYear();
	const m = date.getMonth() + 1;
	const d = date.getDate();
	if (y < 1901 || y > 2100) return null;
	const base = (m - 1) * 2;
	if (termDay(y, base) === d) return TERMS[base];
	if (termDay(y, base + 1) === d) return TERMS[base + 1];
	return null;
}

// ---------------- 节日 ----------------

const SOLAR_FESTIVALS: Record<string, string> = {
	'1-1': '元旦',
	'2-14': '情人节',
	'3-8': '妇女节',
	'3-12': '植树节',
	'4-1': '愚人节',
	'5-1': '劳动节',
	'5-4': '青年节',
	'6-1': '儿童节',
	'7-1': '建党节',
	'8-1': '建军节',
	'9-10': '教师节',
	'10-1': '国庆节',
	'12-24': '平安夜',
	'12-25': '圣诞节',
};

const LUNAR_FESTIVALS: Record<string, string> = {
	'1-1': '春节',
	'1-15': '元宵节',
	'2-2': '龙抬头',
	'3-3': '上巳节',
	'5-5': '端午节',
	'7-7': '七夕',
	'7-15': '中元节',
	'8-15': '中秋节',
	'9-9': '重阳节',
	'12-8': '腊八节',
};

/** 当天是否为节日（含除夕），是则返回节日名 */
export function getFestival(date: Date): string | null {
	const solar = SOLAR_FESTIVALS[`${date.getMonth() + 1}-${date.getDate()}`];
	if (solar) return solar;
	const l = solarToLunar(date);
	if (!l) return null;
	if (!l.isLeap) {
		const lun = LUNAR_FESTIVALS[`${l.month}-${l.day}`];
		if (lun) return lun;
		// 除夕：腊月的最后一天
		if (l.month === 12 && l.day === lunarMonthDays(l.year, 12)) return '除夕';
	}
	return null;
}

export interface DayBadge {
	text: string;
	type: 'festival' | 'term';
}

/** 单元格上的红色角标：节日优先于节气 */
export function dayBadge(date: Date): DayBadge | null {
	const f = getFestival(date);
	if (f) return { text: f, type: 'festival' };
	const t = getSolarTerm(date);
	if (t) return { text: t, type: 'term' };
	return null;
}

/** 月视图单元格上的农历短文案：初一显示月份，其余显示日 */
export function lunarLabel(date: Date): string {
	return solarToLunar(date)?.label ?? '';
}

/** 农历完整文案，如 '九月初七' */
export function lunarFullText(date: Date): string {
	return solarToLunar(date)?.full ?? '';
}
