import type MyCalendarPlugin from './main';
import { CalendarEvent } from './types';
import { EventModal } from './event-modal';
import { getHolidayInfo } from './holidays';
import { dayBadge, lunarLabel } from './lunar';
import {
	addDays,
	addMonths,
	colorOf,
	fmtDate,
	fmtTimeShort,
	hexToRgba,
	todayKey,
	weekdayLabels,
} from './utils';
import { acquireCalendarWidgetStyles } from './widget-styles';
import { eventDescription, indexEvents, isMultiDay, placeRangeBar, rangeLaneCount, rangeSegments } from './event-range';

/**
 * 注册到 Home Widgets 宿主的组件定义。
 * 结构与宿主的 WidgetDefinition 契约（HomeWidgets/src/widget-contract.d.ts）保持一致；
 * 通过宿主公开的 api.registerWidget 注册，不修改宿主工程。
 */

export interface HomeWidgetField {
	key: string;
	label: string;
	type?: 'text' | 'textarea' | 'number' | 'date' | 'checkbox' | 'select' | 'json';
	help?: string;
}

export interface HomeWidgetContext {
	id: string;
	config: Record<string, unknown>;
	doc: Document;
	el: HTMLElement;
	actions: HTMLElement;
	platform: { vaultId: string; preview?: boolean };
	lifetime: { own(cleanup: () => void): () => void };
	local: Record<string, unknown>;
	notify(text: string, error?: boolean): void;
	[key: string]: unknown;
}

export interface HomeWidgetDefinition {
	supportsMultipleInstances?: boolean;
	type: string;
	label: string;
	icon?: string;
	span?: number;
	frameless?: boolean;
	frame?: 'card' | 'none';
	defaults: Record<string, unknown>;
	fields?: HomeWidgetField[];
	mount(context: HomeWidgetContext): void | (() => void) | Promise<void | (() => void)>;
}

function el(doc: Document, tag: string, cls?: string, text?: string): HTMLElement {
	const e = doc.createElement(tag);
	if (cls) e.className = cls;
	if (text !== undefined) e.textContent = text;
	return e;
}

export function createMyCalendarWidget(plugin: MyCalendarPlugin): HomeWidgetDefinition {
	return {
		type: 'my-calendar',
		supportsMultipleInstances: false,
		label: 'MyCalendar 日历',
		icon: '📅',
		span: 12,
		frameless: true,
		frame: 'card',
		defaults: {
			showLunar: true,
			showFestivals: true,
			showHolidays: true,
		},
		fields: [
			{ key: 'showLunar', label: '显示农历', type: 'checkbox' },
			{ key: 'showFestivals', label: '显示节日与节气', type: 'checkbox' },
			{ key: 'showHolidays', label: '显示休/班角标', type: 'checkbox' },
		],
		mount(context) {
			const { doc, config, lifetime, local } = context;
			const showLunar = config.showLunar !== false;
			const showFestivals = config.showFestivals !== false;
			const showHolidays = config.showHolidays !== false;
			const inPreview = !!context.platform.preview;

			lifetime.own(acquireCalendarWidgetStyles(doc));

			// 月份光标存在宿主的实例级 local 里，数据刷新后不丢当前月份
			const now = new Date();
			if (!local.cursor || typeof local.cursor !== 'object') {
				local.cursor = { y: now.getFullYear(), m: now.getMonth() + 1 };
			}
			const cursor = local.cursor as { y: number; m: number };

			const openAdd = (dateKey: string) => new EventModal(plugin.app, plugin, null, dateKey).open();
			const openEdit = (ev: CalendarEvent) => new EventModal(plugin.app, plugin, ev, ev.date).open();

			const root = el(doc, 'div', 'mcw-root');
			const head = el(doc, 'div', 'mcw-head');
			const title = el(doc, 'div', 'mcw-title');
			const nav = el(doc, 'div', 'mcw-nav');
			const prevBtn = el(doc, 'button', 'mcw-btn', '‹');
			const todayBtn = el(doc, 'button', 'mcw-btn', '本月');
			const nextBtn = el(doc, 'button', 'mcw-btn', '›');
			for (const b of [prevBtn, todayBtn, nextBtn]) b.setAttribute('type', 'button');
			// 新建日程按钮放在月份切换右侧，与原始插件头部布局一致
			const addBtn = el(doc, 'button', 'mcw-btn', '＋ 日程');
			addBtn.setAttribute('type', 'button');
			addBtn.addEventListener('click', () => {
				if (inPreview) {
					context.notify('预览模式仅展示，请在 Obsidian 中添加日程');
					return;
				}
				openAdd(todayKey());
			});
			nav.append(prevBtn, todayBtn, nextBtn, addBtn);
			head.append(title, nav);
			const weekdaysEl = el(doc, 'div', 'mcw-weekdays');
			const grid = el(doc, 'div', 'mcw-grid');
			root.append(head, weekdaysEl, grid);
			context.el.append(root);

			const chipEl = (ev: CalendarEvent): HTMLElement => {
				const color = colorOf(ev.color);
				const chip = el(doc, 'div', 'mcw-chip');
				chip.setAttribute('aria-label', eventDescription(ev));
				chip.style.background = hexToRgba(color, 0.16);
				chip.style.setProperty('--mcw-chip-color', color);
				chip.append(el(doc, 'span', 'mcw-dot'));
				if (ev.startTime && !isMultiDay(ev)) chip.append(el(doc, 'span', 'mcw-time', fmtTimeShort(ev.startTime)));
				chip.append(el(doc, 'span', 'mcw-name', ev.title));
				if (ev.important) chip.append(el(doc, 'span', 'mcw-star', '★'));
				chip.addEventListener('click', (e) => {
					e.stopPropagation();
					if (inPreview) {
						context.notify('预览模式仅展示，请在 Obsidian 中编辑日程');
						return;
					}
					openEdit(ev);
				});
				return chip;
			};

			const rerender = (): void => {
				title.textContent = `${cursor.y} 年 ${cursor.m} 月`;
				weekdaysEl.replaceChildren(
					...weekdayLabels(plugin.settings.weekStart).map((label) => el(doc, 'div', 'mcw-weekday', label))
				);

				const today = todayKey();
				const first = new Date(cursor.y, cursor.m - 1, 1);
				const weekStartIdx = plugin.settings.weekStart === 'monday' ? 1 : 0;
				const gridStart = addDays(first, -(first.getDay() - weekStartIdx + 7) % 7);
				const map = indexEvents(plugin.events, gridStart, 42, plugin.settings.newEventsAtBottom);
				const weeks = Array.from({ length: 6 }, (_, i) => rangeSegments(plugin.events, addDays(gridStart, i * 7), 7, plugin.settings.newEventsAtBottom));
				const lanes = weeks.map(spans => Math.max(0, ...spans.map(span => span.lane + 1)));

				grid.replaceChildren();
				for (let i = 0; i < 42; i++) {
					const cellDate = addDays(gridStart, i);
					const key = fmtDate(cellDate);
					const evs = map.get(key) ?? [];
					const important = evs.find((e) => e.important);

					const cell = el(doc, 'div', 'mcw-cell');
					const week = Math.floor(i / 7);
					cell.style.gridRow = String(week + 1); cell.style.gridColumn = String(i % 7 + 1);
					cell.style.minHeight = `${50 + lanes[week] * 18}px`;
					if (cellDate.getMonth() !== cursor.m - 1) cell.classList.add('mcw-other');
					if (key === today) cell.classList.add('mcw-today');
					if (evs.length) cell.classList.add('mcw-has-events');
					const tint = important ?? evs[0];
					if (tint) {
						cell.style.setProperty('--mcw-bg', hexToRgba(colorOf(tint.color), important ? 0.16 : 0.08));
						cell.style.setProperty('--mcw-ring', hexToRgba(colorOf(tint.color), 0.55));
						if (important) cell.classList.add('mcw-special');
					}

					const top = el(doc, 'div', 'mcw-top');
					top.append(el(doc, 'span', 'mcw-num', String(cellDate.getDate())));
					if (showLunar) top.append(el(doc, 'span', 'mcw-lunar', lunarLabel(cellDate)));
					if (showFestivals) {
						const badge = dayBadge(cellDate);
						if (badge) top.append(el(doc, 'span', `mcw-badge mcw-badge-${badge.type}`, badge.text));
					}
					if (showHolidays) {
						const hol = getHolidayInfo(cellDate);
						if (hol) {
							if (hol.type === 'holiday') cell.classList.add('mcw-holiday');
							top.append(el(doc, 'span', `mcw-hol mcw-hol-${hol.type}`, hol.type === 'holiday' ? '休' : '班'));
						}
					}
					cell.append(top);

					const chips = el(doc, 'div', 'mcw-chips');
					chips.style.paddingTop = `${rangeLaneCount(weeks[week], i % 7) * 18}px`;
					const singles = evs.filter(ev => !isMultiDay(ev));
					for (const ev of singles.slice(0, 2)) chips.append(chipEl(ev));
					if (singles.length > 2) {
						const more = el(doc, 'div', 'mcw-chip mcw-more', `还有 ${singles.length - 2} 项…`);
						more.addEventListener('click', (e) => {
							e.stopPropagation();
							if (inPreview) {
								context.notify('预览模式仅展示，请在 Obsidian 中查看');
								return;
							}
							plugin.openDayView(key);
						});
						chips.append(more);
					}
					cell.append(chips);

					cell.addEventListener('click', () => {
						if (inPreview) {
							context.notify('预览模式仅展示，请在 Obsidian 中添加日程');
							return;
						}
						openAdd(key);
					});
					grid.append(cell);
				}
				weeks.forEach((spans, week) => {
					for (const span of spans) {
						const bar = chipEl(span.ev); bar.classList.add('mcw-range-bar');
						placeRangeBar(bar, span, week + 1, 24, 18); grid.append(bar);
					}
				});
			};

			prevBtn.addEventListener('click', () => {
				const r = addMonths(cursor.y, cursor.m, -1);
				cursor.y = r.y;
				cursor.m = r.m;
				rerender();
			});
			nextBtn.addEventListener('click', () => {
				const r = addMonths(cursor.y, cursor.m, 1);
				cursor.y = r.y;
				cursor.m = r.m;
				rerender();
			});
			todayBtn.addEventListener('click', () => {
				const t = new Date();
				cursor.y = t.getFullYear();
				cursor.m = t.getMonth() + 1;
				rerender();
			});

			// 日程数据变化时跟着刷新（插件保存数据后会通知所有刷新目标）
			lifetime.own(plugin.onRefresh(rerender));

			rerender();
		},
	};
}
