import { HolidayDay } from './holidays';

/**
 * 解析各数据源返回的 JSON，转成统一的 HolidayDay 列表。
 * 独立成纯函数模块，方便在 node 里做单元测试。
 */

/** holiday-cn (NateScarlet/holiday-cn) 格式：{ "year": 2026, "days": [{"name":"元旦","date":"2026-01-01","isOffDay":true}, ...] } */
export function parseHolidayCN(text: string, year: number): HolidayDay[] {
	let data: any;
	try {
		data = JSON.parse(text);
	} catch {
		throw new Error('返回内容不是有效 JSON');
	}
	if (!data || data.year !== year || !Array.isArray(data.days) || data.days.length === 0) {
		throw new Error('数据格式不符或该年安排尚未发布');
	}
	const days: HolidayDay[] = [];
	for (const d of data.days) {
		if (!d || typeof d.date !== 'string' || typeof d.isOffDay !== 'boolean' || !d.date.startsWith(`${year}-`)) {
			throw new Error('数据字段异常');
		}
		days.push({ date: d.date, name: String(d.name ?? '节假日'), isOffDay: d.isOffDay });
	}
	return days;
}

/** timor.tech 格式：{ "code": 0, "holiday": { "01-01": {"holiday":true,"name":"元旦","date":"2026-01-01",...}, ... } } */
export function parseTimor(text: string, year: number): HolidayDay[] {
	let data: any;
	try {
		data = JSON.parse(text);
	} catch {
		throw new Error('返回内容不是有效 JSON');
	}
	if (!data || typeof data.holiday !== 'object' || data.holiday === null) {
		throw new Error('数据格式不符或该年安排尚未发布');
	}
	const days: HolidayDay[] = [];
	for (const v of Object.values<any>(data.holiday)) {
		if (!v || typeof v.date !== 'string' || !v.date.startsWith(`${year}-`)) continue;
		days.push({ date: v.date, name: String(v.name ?? '节假日'), isOffDay: v.holiday !== false });
	}
	if (days.length === 0) {
		throw new Error('返回数据为空（该年安排可能尚未发布）');
	}
	return days;
}
