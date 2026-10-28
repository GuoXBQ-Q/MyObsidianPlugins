import { CalendarView } from '../src/calendar-view';
import { createMyCalendarWidget } from '../src/widget';
import { CalendarEvent, DEFAULT_SETTINGS } from '../src/types';

const event = (id: string, title: string, date: string, endDate?: string, color = 'blue'): CalendarEvent => ({ id, title, date, endDate, color, createdAt: 0, note: '预览示例，真实日程未被读取或修改' });
const callbacks = new Set<() => void>();
let completionError: string | null = null;
const plugin = {
	isCountdownAvailable: () => false,
	app: {}, settings: { ...DEFAULT_SETTINGS },
	events: [event('tianjin', '天津 · 会议活动', '2026-11-06', '2026-11-09'), event('prep', '会前准备', '2026-11-07', '2026-11-08', 'purple'), event('month', '跨月出差', '2026-10-30', '2026-11-03', 'teal'), { ...event('single', '项目同步', '2026-11-06'), startTime: '10:00', endTime: '11:00' }],
	onRefresh(callback: () => void) { callbacks.add(callback); return () => callbacks.delete(callback); },
	async saveAll() { view.rerender(); for (const callback of callbacks) callback(); },
	async toggleEventCompleted(id: string) {
		if (completionError) throw new Error(completionError);
		this.events = this.events.map(event => event.id === id ? { ...event, completed: !event.completed } : event);
		await this.saveAll();
	},
	async saveEvent(value: CalendarEvent, existing: CalendarEvent | null) {
		const copy = JSON.parse(JSON.stringify(value));
		this.events = existing ? this.events.map(event => event.id === value.id ? copy : event) : [...this.events, copy];
		await this.saveAll();
	},
	async deleteEvent(value: CalendarEvent) { this.events = this.events.filter(event => event.id !== value.id); await this.saveAll(); },
	openDayView(key: string) { view.jumpTo(new Date(key + 'T00:00:00'), 'day'); },
};
const view = new CalendarView({ app: plugin.app } as any, plugin as any);
document.getElementById('calendar')!.append(view.contentEl);
void view.onOpen();
view.jumpTo(new Date(2026, 10, 6), 'month');
const cleanups: (() => void)[] = [];
const widgetLocal = { cursor: { y: 2026, m: 11 } };
void createMyCalendarWidget(plugin as any).mount({
	id: 'preview', config: {}, doc: document, el: document.getElementById('widget')!, actions: document.createElement('div'),
	platform: { vaultId: 'preview', preview: false }, lifetime: { own: cleanup => { cleanups.push(cleanup); return cleanup; } },
	local: widgetLocal, notify: message => { document.getElementById('notice')!.textContent = message; },
});

// Isolated browser regression fixtures; never read or write vault data.
(window as any).calendarRangePreview = {
	setEvents(events: CalendarEvent[]) { plugin.events = events; void plugin.saveAll(); },
	show(date: string, mode: 'month' | 'week' | 'day' | 'agenda') { view.jumpTo(new Date(date + 'T12:00:00'), mode); },
	setWeekStart(value: 'monday' | 'sunday') { plugin.settings.weekStart = value; void plugin.saveAll(); },
	setMonth(y: number, m: number) { widgetLocal.cursor.y = y; widgetLocal.cursor.m = m; view.jumpTo(new Date(y, m - 1, 6), 'month'); void plugin.saveAll(); },
	setNewEventsAtBottom(value: boolean) { plugin.settings.newEventsAtBottom = value; void plugin.saveAll(); },
	getEvents() { return JSON.parse(JSON.stringify(plugin.events)); },
	setCompletionError(message: string | null) { completionError = message; },
};
document.getElementById('theme')!.addEventListener('click', () => { document.body.classList.toggle('theme-dark'); document.body.classList.toggle('theme-light'); });
document.getElementById('narrow')!.addEventListener('click', () => document.body.classList.toggle('narrow'));
for (const size of ['short', 'tall', 'auto']) document.getElementById(`height-${size}`)!.addEventListener('click', () => {
	document.body.classList.toggle('short', size === 'short');
	document.body.classList.toggle('tall', size === 'tall');
});
document.getElementById('height-tests')!.addEventListener('click', () => {
	const host = document.getElementById('calendar')!, previousHeight = host.style.height;
	const lines: string[] = [];
	const assert = (value: unknown, message: string) => { if (!value) throw new Error(message); };
	try {
		for (const mode of ['month', 'week', 'day', 'agenda'] as const) {
			view.jumpTo(new Date(2026, 10, 6), mode);
			for (const height of [360, 820]) {
				host.style.height = height + 'px';
				const root = view.contentEl.getBoundingClientRect(), body = view.contentEl.querySelector('.mc-body')!.getBoundingClientRect();
				assert(Math.abs(root.height - height) < 2, `${mode} fills panel at ${height}px`);
				assert(body.bottom <= root.bottom + 1 && body.height > 0, `${mode} content fits panel`);
				assert(view.contentEl.scrollHeight <= view.contentEl.clientHeight + 1, `${mode} root does not scroll`);
			}
		}
		lines.push('✓ 月/周/日/日程视图随容器高度变化，顶部工具栏保持可见');
		view.jumpTo(new Date(2026, 10, 6), 'month');
		host.style.height = '540px';
		const compactHeight = view.contentEl.querySelector('.mc-cell')!.getBoundingClientRect().height;
		host.style.height = '820px';
		assert(view.contentEl.querySelector('.mc-cell')!.getBoundingClientRect().height > compactHeight + 10, 'month cells expand without rerender');
		host.style.height = '360px';
		const grid = view.contentEl.querySelector<HTMLElement>('.mc-month-grid')!;
		assert(grid.scrollHeight > grid.clientHeight, 'short calendar scrolls internally');
		for (const chips of view.contentEl.querySelectorAll<HTMLElement>('.mc-chips')) assert(chips.scrollHeight <= chips.clientHeight + 1, 'visible event chips retain readable height');
		lines.push('✓ 月历格子自动伸缩，较矮窗口内部滚动，已有日程保留可读高度');
		lines.push('全部通过');
	} catch (error) { lines.push('失败：' + (error as Error).message); }
	finally { host.style.height = previousHeight; view.jumpTo(new Date(2026, 10, 6), 'month'); }
	document.getElementById('results')!.textContent = lines.join('\n');
});
document.getElementById('alignment-tests')!.addEventListener('click', () => {
	const host = document.getElementById('calendar')!, previousHeight = host.style.height, previousWidth = host.style.width;
	const lines: string[] = [];
	const assert = (value: unknown, message: string) => { if (!value) throw new Error(message); };
	try {
		for (const width of [400, 1100]) {
			host.style.width = width + 'px'; host.style.height = '420px';
			view.jumpTo(new Date(2026, 10, 6), 'week');
			const heads = [...view.contentEl.querySelectorAll<HTMLElement>('.mc-week-head-cell')];
			const allDay = [...view.contentEl.querySelectorAll<HTMLElement>('.mc-allday-cell')];
			const columns = [...view.contentEl.querySelectorAll<HTMLElement>('.mc-day-col')];
			const scroll = view.contentEl.querySelector<HTMLElement>('.mc-week-scroll')!;
			for (const position of [0, 140]) {
				scroll.scrollTop = position;
				for (let i = 0; i < 7; i++) {
					const h = heads[i].getBoundingClientRect(), a = allDay[i].getBoundingClientRect(), c = columns[i].getBoundingClientRect();
					assert(Math.abs(h.left - c.left) <= 1 && Math.abs(h.width - c.width) <= 1, `header column ${i} aligned at ${width}px`);
					assert(Math.abs(a.left - c.left) <= 1 && Math.abs(a.width - c.width) <= 1, `all-day column ${i} aligned at ${width}px`);
				}
				assert(Math.abs(heads[0].parentElement!.getBoundingClientRect().top - scroll.getBoundingClientRect().top - scroll.clientTop) <= 1, 'heading remains sticky');
			}
			const root = view.contentEl.getBoundingClientRect(), box = scroll.getBoundingClientRect();
			assert(box.left - root.left >= 15 && root.right - box.right >= 15 && root.bottom - box.bottom >= 15, 'calendar retains edge spacing');
		}
		lines.push('✓ 400px / 1100px 周视图：日期表头、全天栏与时间网格逐列对齐');
		lines.push('✓ 滚动后保持对齐与固定表头，四周边距保留');
		lines.push('全部通过');
	} catch (error) { lines.push('失败：' + (error as Error).message); }
	finally { host.style.height = previousHeight; host.style.width = previousWidth; view.jumpTo(new Date(2026, 10, 6), 'week'); }
	document.getElementById('results')!.textContent = lines.join('\n');
});
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
