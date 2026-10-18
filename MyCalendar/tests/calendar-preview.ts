import { CalendarView } from '../src/calendar-view';
import { createMyCalendarWidget } from '../src/widget';
import { CalendarEvent, DEFAULT_SETTINGS } from '../src/types';

const event = (id: string, title: string, date: string, endDate?: string, color = 'blue'): CalendarEvent => ({ id, title, date, endDate, color, createdAt: 0, note: '预览示例，真实日程未被读取或修改' });
const callbacks = new Set<() => void>();
const plugin = {
	app: {}, settings: { ...DEFAULT_SETTINGS },
	events: [event('tianjin', '天津 · 会议活动', '2026-11-06', '2026-11-09'), event('prep', '会前准备', '2026-11-07', '2026-11-08', 'purple'), event('month', '跨月出差', '2026-10-30', '2026-11-03', 'teal'), { ...event('single', '项目同步', '2026-11-06'), startTime: '10:00', endTime: '11:00' }],
	onRefresh(callback: () => void) { callbacks.add(callback); return () => callbacks.delete(callback); },
	async saveAll() { view.rerender(); for (const callback of callbacks) callback(); },
	openDayView(key: string) { view.jumpTo(new Date(key + 'T00:00:00'), 'day'); },
};
const view = new CalendarView({ app: plugin.app } as any, plugin as any);
document.getElementById('calendar')!.append(view.contentEl);
void view.onOpen();
view.jumpTo(new Date(2026, 10, 6), 'month');
const cleanups: (() => void)[] = [];
void createMyCalendarWidget(plugin as any).mount({
	id: 'preview', config: {}, doc: document, el: document.getElementById('widget')!, actions: document.createElement('div'),
	platform: { vaultId: 'preview', preview: false }, lifetime: { own: cleanup => { cleanups.push(cleanup); return cleanup; } },
	local: { cursor: { y: 2026, m: 11 } }, notify: message => { document.getElementById('notice')!.textContent = message; },
});
document.getElementById('theme')!.addEventListener('click', () => { document.body.classList.toggle('theme-dark'); document.body.classList.toggle('theme-light'); });
document.getElementById('narrow')!.addEventListener('click', () => document.body.classList.toggle('narrow'));
document.getElementById('range-tests')!.addEventListener('click', () => {
	const lines: string[] = [];
	const assert = (value: unknown, message: string) => { if (!value) throw new Error(message); };
	try {
		view.jumpTo(new Date(2026, 10, 6), 'month');
		assert(view.contentEl.querySelectorAll('.mc-cell').length === 42, '42 days');
		for (const root of [view.contentEl, document.getElementById('widget')!]) {
			const bars = root.querySelectorAll<HTMLElement>('[data-event-id="tianjin"]');
			assert(bars.length === 2 && bars[0].style.gridColumn === '5 / 8' && bars[1].style.gridColumn === '1 / 2', 'both calendars span Friday–Sunday and Monday');
			assert([...bars].every(bar => bar.getBoundingClientRect().height > 0), 'visible range');
			assert([...bars].every(bar => bar.getAttribute('aria-label')!.includes('2026-11-09')), 'full range tooltip');
		}
		lines.push('✓ 独立月历与首页组件：跨周横条、连续日期、完整范围提示');
		view.jumpTo(new Date(2026, 10, 8), 'day');
		assert(view.contentEl.querySelectorAll('[data-event-id="tianjin"]').length === 1, 'middle day visible');
		assert(view.contentEl.querySelectorAll('.mc-time-block').length === 0, 'no duplicated timed range');
		view.jumpTo(new Date(2026, 10, 9), 'week');
		assert(view.contentEl.querySelectorAll('[data-event-id="tianjin"]').length === 1, 'last day week visible');
		view.jumpTo(new Date(2026, 10, 6), 'agenda');
		assert([...view.contentEl.querySelectorAll('.mc-agenda-item')].filter(item => item.textContent!.includes('天津')).length === 1, 'agenda lists once');
		assert(view.contentEl.querySelector('.mc-agenda')!.textContent!.includes('2026-11-09'), 'agenda range');
		lines.push('✓ 日/周视图包含中间日和结束日，日程列表只显示一条完整范围');
		view.jumpTo(new Date(2026, 10, 6), 'month');
		view.contentEl.querySelector<HTMLElement>('[data-event-id="tianjin"]')!.click();
		assert(document.querySelector<HTMLInputElement>('[aria-label="结束日期"]')!.value === '2026-11-09', 'bar opens full event');
		document.querySelector<HTMLInputElement>('[aria-label="结束日期"]')!.value = '2026-11-10';
		const save = [...document.querySelectorAll<HTMLButtonElement>('.mc-modal button')].find(button => button.textContent === '保存')!;
		save.click();
		assert(plugin.events.filter(ev => ev.id === 'tianjin').length === 1 && plugin.events[0].endDate === '2026-11-10', 'edit once updates whole range');
		assert(document.querySelector<HTMLElement>('#widget [data-event-id="tianjin"].mc-range-before')!.style.gridColumn === '1 / 3', 'widget refresh extends bar');
		plugin.events[0].endDate = '2026-11-09'; void plugin.saveAll();
		lines.push('✓ 点击跨周任一段编辑同一条，修改结束日期同步刷新首页');
		lines.push('全部通过');
	} catch (error) { lines.push('失败：' + (error as Error).message); }
	document.getElementById('results')!.textContent = lines.join('\n');
});
