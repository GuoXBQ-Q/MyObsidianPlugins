import { ItemView, WorkspaceLeaf, setIcon } from 'obsidian';
import type MyCalendarPlugin from './main';
import { CalendarEvent, ViewMode } from './types';
import { EventModal } from './event-modal';
import { getHolidayInfo } from './holidays';
import { dayBadge, lunarFullText, lunarLabel } from './lunar';
import { eventDescription, eventEndDate, indexEvents, isMultiDay, placeRangeBar, rangeSegments } from './event-range';
import {
	addDays,
	addMonths,
	assignLanes,
	colorOf,
	daysInMonth,
	fmtDate,
	fmtTimeShort,
	hexToRgba,
	pad2,
	parseDateKey,
	startOfWeek,
	todayKey,
	toMin,
	weekdayLabels,
	weekdayLong,
	weekdayShort,
} from './utils';

export const VIEW_TYPE_MY_CALENDAR = 'my-calendar-view';

interface ViewState {
	mode: ViewMode;
	y: number;
	m: number;
	d: number;
}

export class CalendarView extends ItemView {
	private state: ViewState;
	private mcTitle!: HTMLElement;
	private prevBtn!: HTMLButtonElement;
	private nextBtn!: HTMLButtonElement;
	private todayBtn!: HTMLButtonElement;
	private bodyEl!: HTMLElement;
	private switcherEl!: HTMLElement;

	constructor(leaf: WorkspaceLeaf, private plugin: MyCalendarPlugin) {
		super(leaf);
		this.navigation = false;
		const t = new Date();
		this.state = {
			mode: plugin.settings.defaultView,
			y: t.getFullYear(),
			m: t.getMonth() + 1,
			d: t.getDate(),
		};
	}

	getViewType(): string {
		return VIEW_TYPE_MY_CALENDAR;
	}

	getDisplayText(): string {
		return 'MyCalendar 日历';
	}

	getIcon(): string {
		return 'calendar-days';
	}

	async onOpen(): Promise<void> {
		const root = this.contentEl;
		root.empty();
		root.addClass('my-calendar-view');

		// 顶部：日期、视图切换和导航共用一行。
		const header = root.createDiv('mc-header');
		this.mcTitle = header.createDiv('mc-title');
		const nav = header.createDiv('mc-nav');
		this.prevBtn = nav.createEl('button', { cls: 'mc-btn mc-nav-arrow', text: '‹' });
		this.prevBtn.addEventListener('click', () => this.shift(-1));
		this.todayBtn = nav.createEl('button', { cls: 'mc-btn', text: '本月' });
		this.todayBtn.addEventListener('click', () => this.goToday());
		this.nextBtn = nav.createEl('button', { cls: 'mc-btn mc-nav-arrow', text: '›' });
		this.nextBtn.addEventListener('click', () => this.shift(1));

		const addBtn = nav.createEl('button', { cls: 'mc-btn mc-btn-accent' });
		const addIcon = addBtn.createSpan('mc-btn-icon');
		setIcon(addIcon, 'plus');
		addBtn.createSpan({ text: '新建' });
		addBtn.addEventListener('click', () => this.openAdd(todayKey()));

		this.switcherEl = header.createDiv('mc-switcher');
		header.insertBefore(this.switcherEl, nav);
		const defs: { mode: ViewMode; label: string; icon: string }[] = [
			{ mode: 'day', label: '日视图', icon: 'sun' },
			{ mode: 'week', label: '周视图', icon: 'calendar-range' },
			{ mode: 'month', label: '月视图', icon: 'calendar-days' },
			{ mode: 'agenda', label: '日程', icon: 'list' },
		];
		for (const def of defs) {
			const btn = this.switcherEl.createDiv({ cls: 'mc-switch-btn', attr: { 'data-mode': def.mode } });
			const ic = btn.createSpan('mc-switch-icon');
			setIcon(ic, def.icon);
			btn.createSpan({ text: def.label });
			btn.addEventListener('click', () => this.setMode(def.mode));
		}
		this.bodyEl = root.createDiv('mc-body');

		this.rerender();
	}

	async onClose(): Promise<void> {
		this.contentEl.empty();
	}

	// ------------- 状态切换 -------------

	private setMode(mode: ViewMode): void {
		if (mode === this.state.mode) return;
		const s = { ...this.state, mode };
		// 从月视图切到周/日视图时，把锚定日限制在当月内，避免 31 号溢出
		if (this.state.mode === 'month' && (mode === 'week' || mode === 'day')) {
			s.d = Math.min(s.d, daysInMonth(s.y, s.m));
		}
		this.state = s;
		this.rerender();
	}

	private shift(delta: number): void {
		const s = this.state;
		if (s.mode === 'month') {
			const r = addMonths(s.y, s.m, delta);
			this.state = { ...s, y: r.y, m: r.m };
		} else if (s.mode === 'week') {
			const nd = addDays(new Date(s.y, s.m - 1, s.d), delta * 7);
			this.state = { ...s, y: nd.getFullYear(), m: nd.getMonth() + 1, d: nd.getDate() };
		} else if (s.mode === 'day') {
			const nd = addDays(new Date(s.y, s.m - 1, s.d), delta);
			this.state = { ...s, y: nd.getFullYear(), m: nd.getMonth() + 1, d: nd.getDate() };
		} else {
			return;
		}
		this.rerender();
	}

	private goToday(): void {
		const t = new Date();
		this.state = { ...this.state, y: t.getFullYear(), m: t.getMonth() + 1, d: t.getDate() };
		this.rerender();
	}

	jumpTo(date: Date, mode: ViewMode): void {
		this.state = {
			mode,
			y: date.getFullYear(),
			m: date.getMonth() + 1,
			d: date.getDate(),
		};
		this.rerender();
	}

	// ------------- 数据 -------------

	private eventsByDate(start: Date, count = 1): Map<string, CalendarEvent[]> {
		return indexEvents(this.plugin.events, start, count);
	}

	private openAdd(dateKey: string, time?: string): void {
		new EventModal(this.app, this.plugin, null, dateKey, time).open();
	}

	private openEdit(ev: CalendarEvent): void {
		new EventModal(this.app, this.plugin, ev, ev.date).open();
	}

	// ------------- 渲染 -------------

	rerender(): void {
		if (!this.bodyEl) return;
		this.renderHeader();
		this.renderSwitcherState();
		const body = this.bodyEl;
		body.empty();
		switch (this.state.mode) {
			case 'month':
				this.renderMonth(body);
				break;
			case 'week':
				this.renderWeek(body);
				break;
			case 'day':
				this.renderDay(body);
				break;
			case 'agenda':
				this.renderAgenda(body);
				break;
		}
	}

	private renderHeader(): void {
		const s = this.state;
		let title: string;
		if (s.mode === 'month') {
			title = `${s.y} 年 ${s.m} 月`;
		} else if (s.mode === 'day') {
			title = `${s.y} 年 ${s.m} 月 ${s.d} 日`;
		} else if (s.mode === 'week') {
			const start = startOfWeek(new Date(s.y, s.m - 1, s.d), this.plugin.settings.weekStart);
			const end = addDays(start, 6);
			title =
				start.getMonth() === end.getMonth()
					? `${s.y} 年 ${start.getMonth() + 1} 月 ${start.getDate()} – ${end.getDate()} 日`
					: `${start.getMonth() + 1} 月 ${start.getDate()} 日 – ${end.getMonth() + 1} 月 ${end.getDate()} 日`;
		} else {
			title = '日程';
		}
		this.mcTitle.setText(title);
		this.todayBtn.setText(s.mode === 'month' ? '本月' : s.mode === 'week' ? '本周' : '今天');
		const disabled = s.mode === 'agenda';
		this.prevBtn.disabled = disabled;
		this.nextBtn.disabled = disabled;
	}

	private renderSwitcherState(): void {
		for (const el of Array.from(this.switcherEl.querySelectorAll('.mc-switch-btn'))) {
			(el as HTMLElement).classList.toggle('active', (el as HTMLElement).dataset.mode === this.state.mode);
		}
	}

	/** 事件 chip（月视图 / 全天列表通用） */
	private chipEl(ev: CalendarEvent): HTMLElement {
		const color = colorOf(ev.color);
		const chip = createDiv('mc-chip');
		chip.style.background = hexToRgba(color, 0.16);
		chip.style.setProperty('--mc-chip-color', color);

		const dot = chip.createSpan('mc-chip-dot');
		dot.style.background = color;
		if (!isMultiDay(ev)) chip.createSpan({ cls: 'mc-chip-time', text: ev.startTime ? fmtTimeShort(ev.startTime) : '全天' });
		chip.createSpan({ cls: 'mc-chip-title', text: ev.title });
		if (ev.important) chip.createSpan({ cls: 'mc-chip-star', text: '★' });
		chip.setAttribute('aria-label', eventDescription(ev));
		chip.addEventListener('click', (e) => {
			e.stopPropagation();
			this.openEdit(ev);
		});
		return chip;
	}

	// ================ 月视图 ================

	private renderMonth(container: HTMLElement): void {
		const { y, m } = this.state;
		const settings = this.plugin.settings;
		const today = todayKey();

		const first = new Date(y, m - 1, 1);
		const weekStartIdx = settings.weekStart === 'monday' ? 1 : 0;
		const offset = (first.getDay() - weekStartIdx + 7) % 7;
		const gridStart = addDays(first, -offset);
		const map = this.eventsByDate(gridStart, 42);
		const weeks = Array.from({ length: 6 }, (_, i) => rangeSegments(this.plugin.events, addDays(gridStart, i * 7)));
		const lanes = weeks.map(spans => Math.max(0, ...spans.map(span => span.lane + 1)));

		const labels = weekdayLabels(settings.weekStart);
		const wd = container.createDiv('mc-weekdays');
		for (const label of labels) wd.createDiv('mc-weekday').setText(label);

		const grid = container.createDiv('mc-month-grid');
		for (let i = 0; i < 42; i++) {
			const cellDate = addDays(gridStart, i);
			const key = fmtDate(cellDate);
			const evs = map.get(key) ?? [];
			const inMonth = cellDate.getMonth() === m - 1;
			const important = evs.find((e) => e.important);

			const cell = grid.createDiv('mc-cell');
			const week = Math.floor(i / 7);
			cell.style.gridRow = String(week + 1); cell.style.gridColumn = String(i % 7 + 1);
			if (!inMonth) cell.addClass('mc-other-month');
			if (key === today) cell.addClass('mc-today');
			if (evs.length) cell.addClass('mc-has-events');
			if (important) cell.addClass('mc-special');

			const tint = important ?? evs[0];
			if (tint) {
				cell.style.setProperty('--mc-cell-bg', hexToRgba(colorOf(tint.color), important ? 0.18 : 0.08));
				cell.style.setProperty('--mc-cell-ring', hexToRgba(colorOf(tint.color), 0.6));
			}

			const top = cell.createDiv('mc-cell-top');
			top.createSpan({ cls: 'mc-daynum', text: String(cellDate.getDate()) });
			if (settings.showLunar) top.createSpan({ cls: 'mc-lunar', text: lunarLabel(cellDate) });
			if (settings.showFestivals) {
				const badge = dayBadge(cellDate);
				if (badge) top.createSpan({ cls: `mc-badge mc-badge-${badge.type}`, text: badge.text });
			}
			const hol = settings.showHolidays ? getHolidayInfo(cellDate) : null;
			if (hol) {
				if (hol.type === 'holiday') cell.addClass('mc-holiday-cell');
				top.createSpan({
					cls: `mc-hol mc-hol-${hol.type}`,
					text: hol.type === 'holiday' ? '休' : '班',
					attr: { 'aria-label': hol.type === 'holiday' ? `${hol.name}（放假）` : `调休上班（${hol.name}）` },
				});
			}
			const addBtn = top.createSpan({ cls: 'mc-cell-add', text: '+' });
			addBtn.addEventListener('click', (e) => {
				e.stopPropagation();
				this.openAdd(key);
			});

			const chips = cell.createDiv('mc-chips');
			chips.style.paddingTop = `${lanes[week] * 22}px`;
			const singles = evs.filter(ev => !isMultiDay(ev));
			const maxChips = 3;
			for (const ev of singles.slice(0, maxChips)) chips.append(this.chipEl(ev));
			if (singles.length > maxChips) {
				const more = chips.createDiv({ cls: 'mc-chip mc-more', text: `还有 ${singles.length - maxChips} 项…` });
				more.addEventListener('click', (e) => {
					e.stopPropagation();
					this.jumpTo(cellDate, 'day');
				});
			}

			cell.addEventListener('click', () => this.openAdd(key));
		}
		weeks.forEach((spans, week) => {
			for (const span of spans) {
				const bar = this.chipEl(span.ev); bar.addClass('mc-range-bar');
				placeRangeBar(bar, span, week + 1, 30, 22); grid.append(bar);
			}
		});
	}

	// ================ 周 / 日视图共用时间轴 ================

	private buildAllDayRow(container: HTMLElement, days: Date[], map: Map<string, CalendarEvent[]>): void {
		const today = todayKey();
		const row = container.createDiv('mc-allday');
		const label = row.createDiv('mc-allday-label');
		label.createSpan({ text: '全天' });
		label.createSpan({ text: '跨天' });
		const cells = row.createDiv('mc-allday-days');
		cells.style.gridTemplateColumns = `repeat(${days.length}, minmax(0, 1fr))`;
		const spans = rangeSegments(this.plugin.events, days[0], days.length);
		const lanes = Math.max(0, ...spans.map(span => span.lane + 1));
		for (const [index, day] of days.entries()) {
			const key = fmtDate(day);
			const cellEl = cells.createDiv('mc-allday-cell');
			cellEl.style.gridRow = '1'; cellEl.style.gridColumn = String(index + 1);
			cellEl.style.paddingTop = `${4 + lanes * 22}px`;
			cellEl.style.minHeight = `${34 + lanes * 22}px`;
			if (key === today) cellEl.addClass('mc-today');
			for (const ev of (map.get(key) ?? []).filter((e) => !e.startTime && !isMultiDay(e))) cellEl.append(this.chipEl(ev));
			cellEl.addEventListener('click', () => this.openAdd(key));
		}
		for (const span of spans) {
			const bar = this.chipEl(span.ev); bar.addClass('mc-range-bar');
			placeRangeBar(bar, span, 1, 4, 22); cells.append(bar);
		}
	}

	private buildTimeGrid(container: HTMLElement, days: Date[], map: Map<string, CalendarEvent[]>, buildHeader: (sticky: HTMLElement) => void): HTMLElement {
		const sh = this.plugin.settings.dayStartHour;
		const eh = this.plugin.settings.dayEndHour;
		const span = Math.max(1, eh - sh);
		const today = todayKey();

		const scroll = container.createDiv('mc-week-scroll');
		// One scrollport gives the headings, all-day row and timed columns identical widths.
		buildHeader(scroll.createDiv('mc-time-sticky'));
		const grid = scroll.createDiv('mc-week-grid');
		grid.style.gridTemplateColumns = `48px repeat(${days.length}, minmax(0, 1fr))`;

		const labels = grid.createDiv('mc-hour-labels');
		for (let h = sh; h <= eh; h++) labels.createDiv('mc-hour-label').setText(`${pad2(h)}:00`);

		const now = new Date();
		const nowMin = now.getHours() * 60 + now.getMinutes();

		for (const day of days) {
			const key = fmtDate(day);
			const col = grid.createDiv('mc-day-col');
			if (key === today) col.addClass('mc-col-today');

			for (let h = sh; h < eh; h++) col.createDiv('mc-hour-line');

			// 时间块
			const timed = (map.get(key) ?? []).filter((e) => e.startTime && !isMultiDay(e));
			for (const item of assignLanes(timed)) {
				const { ev, lane, total } = item;
				const s = toMin(ev.startTime);
				const e = Math.max(toMin(ev.endTime), s + 30);
				const color = colorOf(ev.color);
				const block = col.createDiv('mc-time-block');
				block.style.setProperty('--mc-chip-color', color);
				block.style.background = hexToRgba(color, 0.16);

				let top = ((s / 60 - sh) / span) * 100;
				let height = (Math.min(Math.max((e - s) / 60, 0.5), span) / span) * 100;
				top = Math.max(0, Math.min(top, 98));
				height = Math.min(height, 100 - top);
				block.style.top = `${top}%`;
				block.style.height = `calc(${height}% - 2px)`;
				block.style.left = `calc(${(lane * 100) / total}% + 2px)`;
				block.style.width = `calc(${100 / total}% - 4px)`;

				block.createDiv({ cls: 'mc-tb-title', text: ev.title + (ev.important ? ' ★' : '') });
				block.createDiv({
					cls: 'mc-tb-time',
					text: `${fmtTimeShort(ev.startTime)}${ev.endTime ? ' – ' + fmtTimeShort(ev.endTime) : ''}`,
				});
				block.addEventListener('click', (e) => {
					e.stopPropagation();
					this.openEdit(ev);
				});
			}

			// 当前时间红线
			if (key === today && nowMin / 60 >= sh && nowMin / 60 <= eh) {
				const line = col.createDiv('mc-now-line');
				line.style.top = `${((nowMin / 60 - sh) / span) * 100}%`;
			}

			// 点击空白处新建，时间吸附到 15 分钟
			col.addEventListener('click', (evt: MouseEvent) => {
				const rect = col.getBoundingClientRect();
				const ratio = (evt.clientY - rect.top) / Math.max(1, rect.height);
				const minutes = sh * 60 + ratio * span * 60;
				const snapped = Math.max(sh * 60, Math.min(eh * 60 - 15, Math.round(minutes / 15) * 15));
				this.openAdd(key, `${pad2(Math.floor(snapped / 60))}:${pad2(snapped % 60)}`);
			});
		}
		return scroll;
	}

	private dayHeadCell(container: HTMLElement, day: Date, map: Map<string, CalendarEvent[]>): void {
		const today = todayKey();
		const el = container.createDiv('mc-week-head-cell');
		const num = el.createSpan({ cls: 'mc-week-head-num', text: String(day.getDate()) });
		if (fmtDate(day) === today) num.addClass('mc-circle');
		el.createSpan({ cls: 'mc-week-head-wd', text: `周${weekdayShort(day)}` });
		if (this.plugin.settings.showFestivals) {
			const badge = dayBadge(day);
			if (badge) el.createSpan({ cls: 'mc-week-head-badge', text: badge.text });
		}
		const hol = this.plugin.settings.showHolidays ? getHolidayInfo(day) : null;
		if (hol) {
			el.createSpan({
				cls: `mc-hol mc-hol-${hol.type} mc-week-head-hol`,
				text: hol.type === 'holiday' ? '休' : '班',
				attr: { 'aria-label': hol.type === 'holiday' ? `${hol.name}（放假）` : `调休上班（${hol.name}）` },
			});
		}
		el.addEventListener('click', () => this.jumpTo(day, 'day'));
	}

	// ================ 周视图 ================

	private renderWeek(container: HTMLElement): void {
		const s = this.state;
		const start = startOfWeek(new Date(s.y, s.m - 1, s.d), this.plugin.settings.weekStart);
		const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
		const map = this.eventsByDate(start, 7);

		this.buildTimeGrid(container, days, map, sticky => {
			const head = sticky.createDiv('mc-week-head');
			head.createDiv('mc-week-head-spacer');
			for (const day of days) this.dayHeadCell(head, day, map);
			this.buildAllDayRow(sticky, days, map);
		});
	}

	// ================ 日视图 ================

	private renderDay(container: HTMLElement): void {
		const s = this.state;
		const day = new Date(s.y, s.m - 1, s.d);
		const settings = this.plugin.settings;
		const map = this.eventsByDate(day);
		const key = fmtDate(day);

		const info = container.createDiv('mc-day-info');
		info.createSpan({ cls: 'mc-day-info-main', text: `${s.m} 月 ${s.d} 日 · ${weekdayLong(day)}` });
		if (settings.showLunar) info.createSpan({ cls: 'mc-day-info-lunar', text: `农历 ${lunarFullText(day)}` });
		if (settings.showFestivals) {
			const badge = dayBadge(day);
			if (badge) info.createSpan({ cls: 'mc-day-info-badge', text: badge.text });
		}
		const hol = settings.showHolidays ? getHolidayInfo(day) : null;
		if (hol) {
			info.createSpan({
				cls: `mc-hol mc-hol-${hol.type}`,
				text: hol.type === 'holiday' ? `休 · ${hol.name}` : `班 · ${hol.name}调休`,
			});
		}

		this.buildTimeGrid(container, [day], map, sticky => this.buildAllDayRow(sticky, [day], map));
	}

	// ================ 日程（列表） ================

	private renderAgenda(container: HTMLElement): void {
		const settings = this.plugin.settings;
		const scroll = container.createDiv('mc-agenda');

		if (!this.plugin.events.length) {
			const empty = scroll.createDiv('mc-empty');
			const icon = empty.createDiv('mc-empty-icon');
			setIcon(icon, 'calendar-plus');
			empty.createDiv({ cls: 'mc-empty-text', text: '还没有日程' });
			const btn = empty.createEl('button', { cls: 'mc-btn mc-btn-accent', text: '添加第一个日程' });
			btn.addEventListener('click', () => this.openAdd(todayKey()));
			return;
		}

		const sorted = [...this.plugin.events].sort((a, b) => {
			const ak = a.date + (a.startTime ?? '00:00');
			const bk = b.date + (b.startTime ?? '00:00');
			return ak.localeCompare(bk);
		});
		const today = todayKey();
		let lastKey = '';

		for (const ev of sorted) {
			if (ev.date !== lastKey) {
				lastKey = ev.date;
				const d = parseDateKey(ev.date);
				const headEl = scroll.createDiv('mc-agenda-date');
				headEl.createSpan({ cls: 'mc-agenda-date-text', text: `${d.getMonth() + 1} 月 ${d.getDate()} 日 ${weekdayLong(d)}` });
				if (ev.date === today) headEl.createSpan({ cls: 'mc-agenda-today-badge', text: '今天' });
				if (settings.showLunar) headEl.createSpan({ cls: 'mc-agenda-lunar', text: lunarFullText(d) });
				if (settings.showFestivals) {
					const badge = dayBadge(d);
					if (badge) headEl.createSpan({ cls: 'mc-agenda-badge', text: badge.text });
				}
				const hol = settings.showHolidays ? getHolidayInfo(d) : null;
				if (hol) {
					headEl.createSpan({
						cls: `mc-hol mc-hol-${hol.type} mc-agenda-hol`,
						text: hol.type === 'holiday' ? '休' : '班',
						attr: { 'aria-label': hol.type === 'holiday' ? `${hol.name}（放假）` : `调休上班（${hol.name}）` },
					});
				}
				if (ev.date < today) headEl.addClass('mc-past');
			}

			const color = colorOf(ev.color);
			const item = scroll.createDiv('mc-agenda-item');
			if (eventEndDate(ev) < today) item.addClass('mc-past');
			const dot = item.createSpan('mc-agenda-dot');
			dot.style.background = color;
			item.createSpan({
				cls: 'mc-agenda-time',
				text: isMultiDay(ev) ? `${ev.date}${ev.startTime ? ' ' + ev.startTime : ''} 至 ${eventEndDate(ev)}${ev.endTime ? ' ' + ev.endTime : ''}` : ev.startTime ? `${fmtTimeShort(ev.startTime)}${ev.endTime ? ' – ' + fmtTimeShort(ev.endTime) : ''}` : '全天',
			});
			const title = item.createSpan({ cls: 'mc-agenda-title', text: ev.title });
			title.style.setProperty('--mc-chip-color', color);
			if (ev.important) item.createSpan({ cls: 'mc-chip-star', text: '★' });
			if (ev.note) item.createSpan({ cls: 'mc-agenda-note', text: ev.note });
			item.setAttribute('aria-label', eventDescription(ev));
			item.addEventListener('click', () => this.openEdit(ev));
		}
	}
}
