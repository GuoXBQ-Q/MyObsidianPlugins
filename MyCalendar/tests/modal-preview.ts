import { EventModal } from '../src/event-modal';
import { DEFAULT_SETTINGS, CalendarEvent } from '../src/types';
import { colorOf, EVENT_COLORS, normalizeHex } from '../src/utils';
import { normalizeTime } from '../src/time-picker';
import { parsePickerDate } from '../src/date-picker';

const store = {
	settings: { ...DEFAULT_SETTINGS, customColors: ['#a8b5d1'] },
	events: [] as CalendarEvent[],
	async saveAll() { document.getElementById('saved')!.textContent = JSON.stringify({ events: this.events, customColors: this.settings.customColors }, null, 2); },
};
let modal: EventModal;
function open(existing: CalendarEvent | null = null) {
	modal?.close();
	modal = new EventModal({} as any, store as any, existing, '2026-10-17');
	modal.open();
}
document.getElementById('new')!.addEventListener('click', () => open());
document.getElementById('edit')!.addEventListener('click', () => open(store.events[store.events.length - 1] ?? null));
document.getElementById('theme')!.addEventListener('click', () => {
	document.body.classList.toggle('theme-dark'); document.body.classList.toggle('theme-light');
});
document.getElementById('narrow')!.addEventListener('click', () => document.body.classList.toggle('narrow'));
function input(label: string, value: string) {
	const el = document.querySelector<HTMLInputElement>(`[aria-label="${label}"]`)!;
	el.value = value; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('blur')); return el;
}
function click(text: string) {
	const button = [...document.querySelectorAll<HTMLButtonElement>('.mc-modal button')].find((b) => b.textContent === text)!;
	if (!button) throw new Error('Missing button: ' + text); button.click();
}
function assert(value: unknown, message: string) { if (!value) throw new Error(message); }
document.getElementById('tests')!.addEventListener('click', async () => {
	const results: string[] = [];
	try {
		assert(EVENT_COLORS.length === 18, 'palette size');
		assert(colorOf('blue') === '#4c8bf5' && colorOf('#abc') === '#aabbcc' && colorOf('invalid') === '#4c8bf5', 'color compatibility');
		assert(normalizeHex('BAD COLOR') === null && normalizeHex(' #ABC ') === '#aabbcc', 'hex validation');
		assert(normalizeTime('9:5') === '09:05' && normalizeTime('23:59') === '23:59' && normalizeTime('24:00') === null && normalizeTime('12:60') === null, 'time validation');
		results.push('✓ 18 种预设、原有颜色兼容、HEX 与时间校验');
		assert(parsePickerDate('2028-02-29') && !parsePickerDate('2026-02-29') && !parsePickerDate('2026-04-31') && !parsePickerDate('0000-01-01'), 'date validation');
		store.events = []; open();
		document.querySelector<HTMLButtonElement>('[aria-label="选择日期"]')!.click();
		document.querySelector<HTMLButtonElement>('[aria-label="下个月"]')!.click();
		assert(document.querySelector('.mc-date-caption')!.textContent === '2026年11月', 'next month');
		document.querySelector<HTMLButtonElement>('[aria-label="上个月"]')!.click();
		document.querySelector<HTMLButtonElement>('[aria-label="2026年10月24日"]')!.click();
		assert(document.querySelector<HTMLInputElement>('[aria-label="日期"]')!.value === '2026-10-24' && document.querySelector<HTMLElement>('.mc-date-panel')!.hidden, 'date selection');
		document.querySelector<HTMLButtonElement>('[aria-label="选择日期"]')!.click();
		document.querySelector<HTMLButtonElement>('[aria-label="选择开始时间"]')!.click();
		assert(document.querySelector<HTMLElement>('.mc-date-panel')!.hidden, 'time closes date');
		document.querySelector<HTMLButtonElement>('[aria-label="选择日期"]')!.click();
		assert(document.querySelector<HTMLElement>('.mc-time-panel:not(.mc-date-panel)')!.hidden, 'date closes time');
		const dateTitle = document.querySelector<HTMLInputElement>('[placeholder="日程标题…"]')!;
		dateTitle.value = '日期测试'; dateTitle.dispatchEvent(new Event('input'));
		click('保存');
		assert(store.events.length === 1 && store.events[0].date === '2026-10-24', 'selected date save');
		open(store.events[0]); input('日期', '2026-02-29'); click('保存');
		assert(document.querySelector('.mc-modal') && store.events[0].date === '2026-10-24', 'invalid date must not save');
		input('日期', '2028-02-29'); click('保存');
		assert(String(store.events[0].date) === '2028-02-29', 'leap date save');
		results.push('✓ 日期切月/选择/保存、闰年与非法日期校验、日期时间面板互斥');
		open();
		const footerTop = document.querySelector('.mc-modal-footer')!.getBoundingClientRect().top;
		const dateTrigger = document.querySelector<HTMLButtonElement>('[aria-label="选择日期"]')!;
		dateTrigger.click();
		const datePanel = document.querySelector<HTMLElement>('.mc-date-panel')!;
		assert(datePanel.matches(':popover-open') && document.querySelector('.mc-modal-footer')!.getBoundingClientRect().top === footerTop, 'date floats without changing layout');
		datePanel.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
		assert(datePanel.hidden && document.activeElement === dateTrigger && document.querySelector('.mc-modal'), 'escape closes only picker and restores focus');
		const startTrigger = document.querySelector<HTMLButtonElement>('[aria-label="选择开始时间"]')!;
		startTrigger.click();
		const timePanel = document.querySelector<HTMLElement>('.mc-time-panel:not(.mc-date-panel)')!;
		assert(timePanel.matches(':popover-open') && document.querySelector('.mc-modal-footer')!.getBoundingClientRect().top === footerTop, 'time floats without changing layout');
		document.querySelector<HTMLInputElement>('[placeholder="日程标题…"]')!.click();
		assert(timePanel.hidden && startTrigger.getAttribute('aria-expanded') === 'false', 'outside click dismisses picker');
		document.querySelector<HTMLButtonElement>('[aria-label="选择结束时间"]')!.click();
		const endRect = document.querySelector('[aria-label="结束时间"]')!.getBoundingClientRect();
		const floatingRect = timePanel.getBoundingClientRect();
		assert(floatingRect.left >= 0 && floatingRect.right <= window.innerWidth && floatingRect.bottom <= window.innerHeight && floatingRect.top >= 0, 'floating panel stays in viewport');
		assert(Math.abs(floatingRect.top - endRect.bottom) < 12 || floatingRect.bottom <= endRect.top, 'end time anchored to end field');
		modal.close();
		assert(!document.querySelector('.mc-picker-popover:popover-open'), 'modal close disposes floating panels');
		results.push('✓ 日期/起止时间独立悬浮、不挤动表单、外部点击与 Escape 关闭、焦点恢复和关闭清理');
		store.events = []; open();
		const title = document.querySelector<HTMLInputElement>('[placeholder="日程标题…"]')!;
		title.value = '测试日程'; title.dispatchEvent(new Event('input'));
		input('开始时间', '9:5'); input('结束时间', '10:15'); input('自定义颜色色号', '#abc'); click('保存');
		assert(store.events.length === 1 && store.events[0].startTime === '09:05' && store.events[0].color === '#aabbcc', 'custom save');
		assert(store.settings.customColors[0] === '#aabbcc', 'recent save');
		results.push('✓ 自定义颜色保存、最近颜色记忆、时间规范化');
		open(store.events[0]);
		assert(document.querySelector<HTMLInputElement>('[aria-label="开始时间"]')!.value === '09:05', 'reopen time');
		assert(document.querySelector('[aria-label="自定义颜色 #aabbcc"]')?.getAttribute('aria-pressed') === 'true', 'reopen selection');
		input('结束时间', '08:00'); click('保存');
		assert(document.querySelector('.mc-modal') && store.events[0].endTime === '10:15', 'invalid interval must not save');
		input('结束时间', '10:15'); input('自定义颜色色号', 'oops'); click('保存');
		assert(document.querySelector('.mc-modal') && store.events[0].color === '#aabbcc', 'invalid hex must not save');
		click('取消');
		results.push('✓ 重开编辑保持颜色；错误时间/色号阻止保存；取消不改原数据');
		open(store.events[0]);
		document.querySelector<HTMLButtonElement>('[aria-label="选择开始时间"]')!.click();
		document.querySelector<HTMLButtonElement>('[aria-label="开始 14 时"]')!.click();
		document.querySelector<HTMLButtonElement>('[aria-label="开始 35 分"]')!.click(); click('确定');
		assert(document.querySelector<HTMLInputElement>('[aria-label="开始时间"]')!.value === '14:35', 'picker value');
		document.querySelector<HTMLButtonElement>('[aria-label="选择开始时间"]')!.click(); click('设为全天');
		assert(document.querySelector<HTMLInputElement>('[aria-label="结束时间"]')!.value === '', 'all day clears end');
		document.querySelector<HTMLButtonElement>('[aria-label="珊瑚红"]')!.click(); click('保存');
		assert(!store.events[0].startTime && !store.events[0].endTime && store.events[0].color === 'red', 'all day and preset');
		results.push('✓ 小时/分钟面板、全天清空起止时间、新预设颜色保存');
		open(store.events[0]);
		input('开始时间', '25:00'); click('保存');
		assert(document.querySelector('[aria-label="开始时间"]')!.getAttribute('aria-invalid') === 'true', 'invalid time');
		results.push('✓ 非法时间阻止保存');
		open(store.events[0]);
		input('结束时间', '12:30'); click('保存');
		assert(document.querySelector('.mc-modal') && !store.events[0].endTime, 'orphan end must not save');
		input('开始时间', '10:00'); input('结束时间', '12:30');
		input('色盘选色', '#bb6688'); click('保存');
		assert(store.events[0].color === '#bb6688' && store.events[0].endTime === '12:30', 'native palette');
		results.push('✓ 仅结束时间不能保存；色盘选色保存成功');
		const host = window as any, nativeEye = host.EyeDropper;
		try {
			host.EyeDropper = class { async open() { return { sRGBHex: '#123456' }; } };
			open(store.events[0]); click('屏幕取色'); await Promise.resolve(); await Promise.resolve();
			assert(document.querySelector<HTMLInputElement>('[aria-label="自定义颜色色号"]')!.value === '#123456', 'eyedropper result');
			click('保存'); assert(store.events[0].color === '#123456', 'eyedropper save');
			host.EyeDropper = undefined; open(store.events[0]);
			assert(document.querySelector<HTMLButtonElement>('[aria-label="屏幕取色"]')!.disabled, 'unsupported fallback');
			click('取消');
		} finally { host.EyeDropper = nativeEye; }
		results.push('✓ 取色结果保存与不支持时回退（模拟取色接口）');
		modal.close(); store.events = []; store.settings.customColors = ['#a8b5d1'];
		document.getElementById('saved')!.textContent = '测试通过；真实日程数据未被读取或改动。';
		open(); document.getElementById('notice')!.textContent = '';
		results.push('全部通过');
	} catch (error) { results.push('失败：' + (error as Error).message); }
	document.getElementById('results')!.textContent = results.join('\n');
});
open();
