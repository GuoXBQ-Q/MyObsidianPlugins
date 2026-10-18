import { Notice, setIcon } from 'obsidian';
import { CalendarEvent, MyCalendarSettings } from './types';
import { fmtDate, todayKey, weekdayLabels } from './utils';
import { createPickerPopover } from './picker-popover';

export function parsePickerDate(value: string): Date | null {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith('0000')) return null;
	const [year, month, day] = value.split('-').map(Number);
	const date = new Date(0);
	date.setHours(0, 0, 0, 0);
	date.setFullYear(year, month - 1, day);
	return fmtDate(date) === value ? date : null;
}

/** Shares the time picker's themed floating panel and controls. */
export function mountDatePicker(wrap: HTMLElement, container: HTMLElement, ev: CalendarEvent, weekStart: MyCalendarSettings['weekStart'], beforeOpen: () => void, key: 'date' | 'endDate' = 'date') {
	const label = key === 'date' ? '日期' : '结束日期';
	const id = `mc-${key}-${ev.id}`;
	wrap.createEl('label', { text: label, attr: { for: id } });
	const control = wrap.createDiv('mc-time-control mc-date-control');
	const input = control.createEl('input', { type: 'text', placeholder: 'YYYY-MM-DD', attr: { id, 'aria-label': label, maxlength: '10', autocomplete: 'off' } });
	input.value = ev[key] ?? ev.date;
	const trigger = control.createEl('button', { cls: 'mc-time-trigger', attr: { type: 'button', 'aria-label': `选择${label}`, 'aria-expanded': 'false', 'aria-controls': `${id}-panel` } });
	setIcon(trigger, 'calendar-days');
	const panel = container.createDiv({ cls: 'mc-time-panel mc-date-panel', attr: { id: `${id}-panel`, role: 'group', 'aria-label': `${label}选择` } });
	const popover = createPickerPopover(panel);
	let visibleMonth = parsePickerDate(ev.date) ?? new Date();
	visibleMonth.setDate(1);
	const close = popover.close;
	const commit = () => {
		const value = input.value.trim();
		const valid = !!parsePickerDate(value);
		input.setAttribute('aria-invalid', String(!valid));
		if (valid) { input.value = value; ev[key] = value; }
		return valid;
	};
	const choose = (value: string) => { input.value = value; commit(); close(); trigger.focus(); };
	const render = () => {
		panel.empty();
		const year = visibleMonth.getFullYear(), month = visibleMonth.getMonth();
		const header = panel.createDiv('mc-time-panel-header');
		const previous = header.createEl('button', { cls: 'mc-time-option mc-date-nav', text: '‹', attr: { type: 'button', 'aria-label': '上个月' } });
		previous.disabled = year === 1 && month === 0;
		header.createSpan({ cls: 'mc-date-caption', text: `${year}年${month + 1}月`, attr: { 'aria-live': 'polite' } });
		const next = header.createEl('button', { cls: 'mc-time-option mc-date-nav', text: '›', attr: { type: 'button', 'aria-label': '下个月' } });
		next.disabled = year === 9999 && month === 11;
		previous.addEventListener('click', () => { visibleMonth.setMonth(month - 1); render(); panel.querySelector<HTMLButtonElement>('[aria-label="上个月"]')?.focus(); });
		next.addEventListener('click', () => { visibleMonth.setMonth(month + 1); render(); panel.querySelector<HTMLButtonElement>('[aria-label="下个月"]')?.focus(); });
		const week = panel.createDiv({ cls: 'mc-date-week', attr: { 'aria-hidden': 'true' } });
		for (const label of weekdayLabels(weekStart)) week.createSpan({ text: label });
		const grid = panel.createDiv('mc-date-grid');
		const offset = (visibleMonth.getDay() + (weekStart === 'monday' ? 6 : 0)) % 7;
		const today = todayKey();
		// Six complete weeks keep the floating panel's height stable across months.
		for (let i = 0; i < 42; i++) {
			const date = new Date(visibleMonth);
			date.setDate(i - offset + 1);
			const value = fmtDate(date);
			const button = grid.createEl('button', { cls: `mc-time-option mc-date-day${date.getMonth() !== month ? ' is-outside' : ''}`, text: String(date.getDate()), attr: { type: 'button', 'aria-label': `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`, 'aria-pressed': String(value === input.value.trim()) } });
			button.disabled = date.getFullYear() < 1 || date.getFullYear() > 9999;
			if (value === today) button.setAttribute('aria-current', 'date');
			button.addEventListener('click', () => choose(value));
		}
		const footer = panel.createDiv('mc-time-panel-footer');
		footer.createSpan({ text: '也可直接输入，如 2026-10-24' });
		footer.createEl('button', { cls: 'mc-btn', text: '今天', attr: { type: 'button' } }).addEventListener('click', () => choose(todayKey()));
		footer.createEl('button', { cls: 'mc-btn mc-btn-accent', text: '收起', attr: { type: 'button' } }).addEventListener('click', () => { close(); trigger.focus(); });
	};
	const open = () => {
		if (!panel.hidden) { close(); return; }
		beforeOpen();
		visibleMonth = parsePickerDate(input.value.trim()) ?? new Date();
		visibleMonth.setDate(1);
		render(); popover.open(control, trigger);
		(panel.querySelector<HTMLButtonElement>('[aria-pressed="true"]') ?? panel.querySelector<HTMLButtonElement>('.mc-date-day:not(:disabled)'))?.focus({ preventScroll: true });
	};
	trigger.addEventListener('click', open);
	input.addEventListener('input', () => { close(); input.setAttribute('aria-invalid', 'false'); });
	input.addEventListener('blur', commit);
	input.addEventListener('keydown', (event) => {
		if (event.key === 'ArrowDown') { event.preventDefault(); open(); }
		if (event.key === 'Enter') { event.preventDefault(); commit(); close(); }
	});
	return { close, input, setValue(value: string) { input.value = value; input.setAttribute('aria-invalid', 'false'); }, dispose: popover.dispose, validate() {
		if (commit()) return true;
		new Notice(`请输入有效${label}，格式为 YYYY-MM-DD`); input.focus(); return false;
	} };
}
