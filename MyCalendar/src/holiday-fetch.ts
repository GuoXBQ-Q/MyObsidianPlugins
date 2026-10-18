import { requestUrl } from 'obsidian';
import { FetchedArrangement } from './holidays';
import { parseHolidayCN, parseTimor } from './holiday-parse';

interface HolidaySource {
	name: string;
	url: (year: number) => string;
	parse: (text: string, year: number) => ReturnType<typeof parseHolidayCN>;
}

/**
 * 依次尝试多个数据源（前面的在国内网络更可达），全部失败则抛出汇总错误。
 * holiday-cn：社区项目，国务院公告发布后即同步，数据格式规范。
 */
const SOURCES: HolidaySource[] = [
	{
		name: 'holiday-cn (jsDelivr CDN)',
		url: (y) => `https://cdn.jsdelivr.net/gh/NateScarlet/holiday-cn@master/${y}.json`,
		parse: parseHolidayCN,
	},
	{
		name: 'holiday-cn (GitHub)',
		url: (y) => `https://raw.githubusercontent.com/NateScarlet/holiday-cn/master/${y}.json`,
		parse: parseHolidayCN,
	},
	{
		name: 'timor.tech 节假日 API',
		url: (y) => `https://timor.tech/api/holiday/year/${y}`,
		parse: parseTimor,
	},
];

/** 获取指定年份的国务院放假/调休安排 */
export async function fetchYearArrangement(year: number): Promise<FetchedArrangement> {
	const errors: string[] = [];
	for (const src of SOURCES) {
		try {
			const res = await requestUrl({ url: src.url(year), method: 'GET' });
			const days = await Promise.resolve(src.parse(res.text, year));
			return { year, source: src.name, updatedAt: Date.now(), days };
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e);
			errors.push(`· ${src.name}：${msg}`);
		}
	}
	throw new Error(`所有数据源均失败：\n${errors.join('\n')}`);
}
