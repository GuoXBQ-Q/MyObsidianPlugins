import { App, Modal, Notice, setIcon } from 'obsidian';
import type MyCalendarPlugin from './main';
import { CalendarEvent } from './types';
import { todayKey, uid } from './utils';
import { mountTimeFields } from './time-picker';
import { mountColorPicker } from './color-picker';

/**
 * 新建 / 编辑日程弹窗。
 * 传入 existing 则为编辑模式（含删除按钮），否则为新建模式。
 */
export class EventModal extends Modal {
	private ev: CalendarEvent;
	private timeControl: ReturnType<typeof mountTimeFields> | null = null;
	private colorControl: ReturnType<typeof mountColorPicker> | null = null;
	private saving = false;

	constructor(
		app: App,
		private plugin: MyCalendarPlugin,
		private existing: CalendarEvent | null,
		defaultDate: string,
		defaultTime?: string
	) {
		super(app);
		this.existing = existing ? JSON.parse(JSON.stringify(existing)) : null;
		this.ev = existing
			? JSON.parse(JSON.stringify(existing))
			: {
					id: uid(),
					title: '',
					date: defaultDate || todayKey(),
					startTime: defaultTime,
					endTime: undefined,
					color: 'blue',
					important: false,
					note: '',
					createdAt: Date.now(),
				};
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('mc-modal');
		this.modalEl.addClass('mc-event-modal');
		contentEl.createEl('h3', { text: this.existing ? '编辑日程' : '新建日程' });

		// 标题
		const titleField = contentEl.createDiv('mc-field');
		const titleInput = titleField.createEl('input', { cls: 'mc-input', type: 'text', placeholder: '日程标题…' });
		titleInput.value = this.ev.title;
		titleInput.addEventListener('input', () => (this.ev.title = titleInput.value));
		titleInput.addEventListener('keydown', (e) => {
			if (e.key === 'Enter') this.save();
		});

		// 日期与时间
		this.timeControl = mountTimeFields(contentEl, this.ev, this.plugin.settings.weekStart);

		// 重要事件
		const importantId = `mc-important-${this.ev.id}`;
		const impRow = this.timeControl.optionsEl.createEl('label', { cls: 'mc-option-card', attr: { for: importantId } });
		const impCheck = impRow.createEl('input', { type: 'checkbox', attr: { id: importantId, 'aria-description': '日程覆盖的日期单元格将高亮突出显示' } });
		impCheck.checked = !!this.ev.important;
		impCheck.addEventListener('change', () => (this.ev.important = impCheck.checked));
		const impIcon = impRow.createSpan({ cls: 'mc-option-icon', attr: { 'aria-hidden': 'true' } });
		setIcon(impIcon, 'star');
		impRow.createSpan({ cls: 'mc-option-title', text: '重要事件' });

		if (this.plugin.isCountdownAvailable()) this.renderCountdownSettings(contentEl);
		else if (this.ev.countdown) contentEl.createEl('p', { cls: 'mc-countdown-help', text: '此日程已关联倒计时。Home Widgets 当前未连接，关联设置会保留，恢复连接后继续同步。' });

		// 分类颜色
		this.colorControl = mountColorPicker(contentEl, this.ev, this.plugin.settings);

		// 备注
		contentEl.createEl('label', { cls: 'mc-label', text: '备注' });
		const noteArea = contentEl.createEl('textarea', { cls: 'mc-textarea', attr: { rows: '2', placeholder: '备注（可选）' } });
		noteArea.value = this.ev.note ?? '';
		noteArea.addEventListener('input', () => (this.ev.note = noteArea.value));

		// 底部按钮
		const footer = contentEl.createDiv('mc-modal-footer');
		if (this.existing) {
			const delBtn = footer.createEl('button', { cls: 'mc-btn mc-btn-danger', text: '删除' });
			let armed = false;
			delBtn.addEventListener('click', () => {
				if (!armed) {
					armed = true;
					delBtn.setText('确认删除？');
					delBtn.addClass('mc-armed');
				} else {
					void this.runSave(() => this.plugin.deleteEvent(this.existing!));
				}
			});
		}
		footer.createDiv('mc-flex-spacer');
		footer.createEl('button', { cls: 'mc-btn', text: '取消' }).addEventListener('click', () => this.close());
		footer.createEl('button', { cls: 'mc-btn mc-btn-accent', text: '保存' }).addEventListener('click', () => this.save());

		window.setTimeout(() => titleInput.focus(), 50);
	}

	private renderCountdownSettings(contentEl: HTMLElement): void {
		// 倒计时是 Home Widgets 的日期集合，以日程开始日为目标日期。
		const syncId = `mc-countdown-${this.ev.id}`;
		const syncRow = this.timeControl!.optionsEl.createEl('label', { cls: 'mc-option-card', attr: { for: syncId } });
		const syncCheck = syncRow.createEl('input', { type: 'checkbox', attr: { id: syncId, 'aria-label': '同步到倒计时', 'aria-description': '将日程标题与开始日期单向同步到 Home Widgets；取消同步或删除日程也会移除关联倒计时' } });
		syncCheck.checked = !!this.ev.countdown;
		const syncIcon = syncRow.createSpan({ cls: 'mc-option-icon', attr: { 'aria-hidden': 'true' } });
		setIcon(syncIcon, 'hourglass');
		syncRow.createSpan({ cls: 'mc-option-title', text: '同步到倒计时' });
		const syncSettings = contentEl.createDiv('mc-countdown-settings');
		syncSettings.hidden = !syncCheck.checked;
		const collectionLabel = syncSettings.createEl('label', { cls: 'mc-label', text: '倒计时集合' });
		const collectionInput = syncSettings.createEl('input', { cls: 'mc-input', type: 'text', attr: { id: `${syncId}-collection`, 'aria-label': '倒计时集合', 'aria-describedby': `${syncId}-help`, placeholder: 'default' } });
		collectionLabel.htmlFor = collectionInput.id;
		collectionInput.value = this.ev.countdown?.collection ?? 'default';
		syncSettings.createEl('p', { cls: 'mc-countdown-help', text: '填写倒计时组件使用的「日期集合」（默认为 default）。按开始日期计算天数，不包含具体时间；修改日程会同步更新，取消同步或删除日程也会移除关联倒计时。需启用支持联动的 Home Widgets，重新连接后自动读取最新日程。', attr: { id: `${syncId}-help` } });
		const updateSync = () => {
			syncSettings.hidden = !syncCheck.checked;
			if (syncCheck.checked) this.ev.countdown = { collection: collectionInput.value.trim() };
			else delete this.ev.countdown;
		};
		syncCheck.addEventListener('change', updateSync);
		collectionInput.addEventListener('input', updateSync);
	}

	private async save(): Promise<void> {
		if (this.saving) return;
		if (!this.ev.title.trim()) {
			new Notice('请先填写日程标题');
			return;
		}
		if (!this.timeControl?.validate() || !this.colorControl?.validate()) return;
		if ((!this.ev.endDate || this.ev.endDate === this.ev.date) && this.ev.startTime && this.ev.endTime && this.ev.endTime <= this.ev.startTime) {
			new Notice('结束时间需要晚于开始时间');
			return;
		}
		this.ev.title = this.ev.title.trim();
		await this.runSave(() => this.plugin.saveEvent(this.ev, this.existing));
	}

	private async runSave(action: () => Promise<void>): Promise<void> {
		if (this.saving) return;
		this.saving = true;
		const controls = Array.from(this.contentEl.querySelectorAll<HTMLInputElement | HTMLButtonElement | HTMLTextAreaElement>('input, button, textarea'));
		const disabled = controls.map(control => control.disabled);
		controls.forEach(control => { control.disabled = true; });
		try { await action(); this.close(); }
		catch (error) { new Notice(`日程保存失败：${error instanceof Error ? error.message : String(error)}`, 8000); }
		finally {
			this.saving = false;
			controls.forEach((control, index) => { control.disabled = disabled[index]; });
		}
	}

	onClose(): void {
		this.timeControl?.dispose();
		this.colorControl?.dispose();
		this.contentEl.empty();
	}
}
