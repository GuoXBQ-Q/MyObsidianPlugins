import { Notice, setIcon } from 'obsidian';
import { CalendarEvent, MyCalendarSettings } from './types';
import { pad2 } from './utils';
import { mountDatePicker } from './date-picker';
import { createPickerPopover } from './picker-popover';

export function normalizeTime(value: string): string | null {
	const match = /^(\d{1,2})[:：](\d{1,2})$/.exec(value.trim());
	if (!match || Number(match[1]) > 23 || Number(match[2]) > 59) return null;
	return `${pad2(Number(match[1]))}:${pad2(Number(match[2]))}`;
}

/** Date and time panels float beside their respective controls. */
export function mountTimeFields(container: HTMLElement, ev: CalendarEvent, weekStart: MyCalendarSettings['weekStart'] = 'monday') {
	const rangeToggle = container.createDiv('mc-field mc-check-row');
	const rangeId = `mc-range-${ev.id}`;
	const rangeCheck = rangeToggle.createEl('input', { type: 'checkbox', attr: { id: rangeId, 'aria-label': '跨天日程' } });
	rangeCheck.checked = !!ev.endDate && ev.endDate > ev.date;
	rangeToggle.createEl('label', { text: '跨天日程（包含结束当天）', attr: { for: rangeId } });
	const row = container.createDiv('mc-row3');
	const dateWrap = row.createDiv('mc-date-field');
	const endDateWrap = row.createDiv('mc-end-date-field');
	endDateWrap.hidden = !rangeCheck.checked;
	row.classList.toggle('is-range', rangeCheck.checked);
	const fields: { key: 'startTime' | 'endTime'; label: string; input: HTMLInputElement; button: HTMLButtonElement }[] = [];
	const panel = container.createDiv('mc-time-panel');
	let active: typeof fields[number] | null = null;
	const popover = createPickerPopover(panel, () => { active = null; });
	const closePanel = popover.close;
	const dateControl = mountDatePicker(dateWrap, container, ev, weekStart, () => { closePanel(); endDateControl.close(); });
	const endDateControl = mountDatePicker(endDateWrap, container, ev, weekStart, () => { closePanel(); dateControl.close(); }, 'endDate');
	rangeCheck.addEventListener('change', () => {
		dateControl.close(); endDateControl.close(); closePanel();
		endDateWrap.hidden = !rangeCheck.checked; row.classList.toggle('is-range', rangeCheck.checked);
		if (rangeCheck.checked) endDateControl.setValue(ev.endDate ?? dateControl.input.value);
		else delete ev.endDate;
	});
	const commit = (field: typeof fields[number]): boolean => {
		const raw = field.input.value.trim();
		const time = raw ? normalizeTime(raw) : undefined;
		field.input.setAttribute('aria-invalid', String(time === null));
		if (time === null) return false;
		field.input.value = time ?? '';
		const previous = ev[field.key];
		ev[field.key] = time;
		if (field.key === 'startTime' && previous && !time) {
			ev.endTime = undefined;
			const end = fields.find((f) => f.key === 'endTime');
			if (end) { end.input.value = ''; end.input.setAttribute('aria-invalid', 'false'); }
		}
		return true;
	};
	const openPanel = (field: typeof fields[number]) => {
		dateControl.close();
		endDateControl.close();
		if (active === field) { closePanel(); return; }
		closePanel();
		active = field;
		panel.empty();
		const header = panel.createDiv('mc-time-panel-header');
		header.createEl('span', { text: `选择${field.label}时间` });
		const current = normalizeTime(field.input.value) ?? (field.key === 'endTime' && ev.startTime ? `${pad2(Math.min(23, Number(ev.startTime.slice(0, 2)) + 1))}:${ev.startTime.slice(3)}` : '09:00');
		let [hour, minute] = current.split(':').map(Number);
		const preview = header.createEl('span', { cls: 'mc-time-preview', text: current });
		const parts = panel.createDiv('mc-time-parts');
		const hours = parts.createDiv();
		hours.createDiv({ cls: 'mc-time-part-label', text: '小时' });
		const hourGrid = hours.createDiv('mc-time-grid mc-hours');
		const minutes = parts.createDiv();
		minutes.createDiv({ cls: 'mc-time-part-label', text: '分钟' });
		const minuteGrid = minutes.createDiv('mc-time-grid mc-minutes');
		const hourButtons: HTMLButtonElement[] = [], minuteButtons: HTMLButtonElement[] = [];
		const sync = () => {
			const value = `${pad2(hour)}:${pad2(minute)}`;
			field.input.value = value;
			commit(field);
			preview.setText(value);
			hourButtons.forEach((b, i) => b.setAttribute('aria-pressed', String(i === hour)));
			minuteButtons.forEach((b) => b.setAttribute('aria-pressed', String(Number(b.textContent) === minute)));
		};
		for (let h = 0; h < 24; h++) {
			const b = hourGrid.createEl('button', { cls: 'mc-time-option', text: pad2(h), attr: { type: 'button', 'aria-label': `${field.label} ${h} 时`, 'aria-pressed': String(h === hour) } });
			b.addEventListener('click', () => { hour = h; sync(); });
			hourButtons.push(b);
		}
		for (let m = 0; m < 60; m += 5) {
			const b = minuteGrid.createEl('button', { cls: 'mc-time-option', text: pad2(m), attr: { type: 'button', 'aria-label': `${field.label} ${m} 分`, 'aria-pressed': String(m === minute) } });
			b.addEventListener('click', () => { minute = m; sync(); });
			minuteButtons.push(b);
		}
		const footer = panel.createDiv('mc-time-panel-footer');
		footer.createEl('span', { text: '也可直接输入，如 09:30' });
		footer.createEl('button', { cls: 'mc-btn mc-time-clear', text: field.key === 'startTime' ? '设为全天' : '清除结束', attr: { type: 'button' } }).addEventListener('click', () => {
			field.input.value = ''; commit(field);
			if (field.key === 'startTime') {
				ev.endTime = undefined;
				const end = fields.find((f) => f.key === 'endTime');
				if (end) { end.input.value = ''; end.input.setAttribute('aria-invalid', 'false'); }
			}
			closePanel(); field.input.focus();
		});
		footer.createEl('button', { cls: 'mc-btn mc-btn-accent', text: '确定', attr: { type: 'button' } }).addEventListener('click', () => { sync(); closePanel(); field.button.focus(); });
		popover.open(field.input.parentElement!, field.button);
		hourButtons[hour].focus({ preventScroll: true });
	};
	for (const [key, label, placeholder] of [['startTime', '开始', '全天'], ['endTime', '结束', '可选']] as const) {
		const wrap = row.createDiv('mc-time-field');
		const id = `mc-${key}-${ev.id}`;
		wrap.createEl('label', { text: label, attr: { for: id } });
		const control = wrap.createDiv('mc-time-control');
		const input = control.createEl('input', { type: 'text', placeholder, attr: { id, inputmode: 'numeric', maxlength: '5', 'aria-label': `${label}时间`, autocomplete: 'off' } });
		input.value = ev[key] ?? '';
		const button = control.createEl('button', { cls: 'mc-time-trigger', attr: { type: 'button', 'aria-label': `选择${label}时间`, 'aria-expanded': 'false', 'aria-controls': `mc-time-panel-${ev.id}` } });
		setIcon(button, 'clock-3');
		const field = { key, label, input, button };
		fields.push(field);
		button.addEventListener('click', () => openPanel(field));
		input.addEventListener('input', () => { closePanel(); input.setAttribute('aria-invalid', 'false'); });
		input.addEventListener('blur', () => commit(field));
		input.addEventListener('keydown', (e) => {
			if (e.key === 'ArrowDown') { e.preventDefault(); openPanel(field); }
			if (e.key === 'Enter') { e.preventDefault(); commit(field); closePanel(); }
		});
	}
	panel.id = `mc-time-panel-${ev.id}`;
	panel.setAttribute('role', 'group');
	panel.setAttribute('aria-label', '时间选择');
	return { dispose() { popover.dispose(); dateControl.dispose(); endDateControl.dispose(); }, validate() {
		if (!dateControl.validate()) return false;
		if (rangeCheck.checked) {
			if (!endDateControl.validate()) return false;
			if (ev.endDate! < ev.date) { new Notice('结束日期不能早于开始日期'); endDateControl.input.focus(); return false; }
			if (ev.endDate === ev.date) delete ev.endDate;
		} else delete ev.endDate;
		for (const field of fields) {
			if (!commit(field)) { new Notice('请输入有效时间，如 09:30（00:00–23:59）'); field.input.focus(); return false; }
		}
		if (!ev.startTime && ev.endTime) { new Notice('请先填写开始时间，或清空时间设为全天'); fields[0].input.focus(); return false; }
		return true;
	} };
}
