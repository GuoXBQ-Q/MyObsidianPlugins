import { App, Modal, Notice, setIcon } from 'obsidian';
import type MyCalendarPlugin from './main';
import { CalendarEvent } from './types';
import { normalizeHex, todayKey, uid } from './utils';
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

	constructor(
		app: App,
		private plugin: MyCalendarPlugin,
		private existing: CalendarEvent | null,
		defaultDate: string,
		defaultTime?: string
	) {
		super(app);
		this.ev = existing
			? { ...existing }
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
					this.plugin.events = this.plugin.events.filter((e) => e.id !== this.ev.id);
					this.plugin.saveAll();
					this.close();
				}
			});
		}
		footer.createDiv('mc-flex-spacer');
		footer.createEl('button', { cls: 'mc-btn', text: '取消' }).addEventListener('click', () => this.close());
		footer.createEl('button', { cls: 'mc-btn mc-btn-accent', text: '保存' }).addEventListener('click', () => this.save());

		window.setTimeout(() => titleInput.focus(), 50);
	}

	private save(): void {
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
		const customColor = normalizeHex(this.ev.color);
		if (customColor) {
			this.plugin.settings.customColors = [...new Set([customColor, ...(this.plugin.settings.customColors ?? [])])].slice(0, 12);
		}
		if (this.existing) {
			const idx = this.plugin.events.findIndex((e) => e.id === this.ev.id);
			if (idx >= 0) this.plugin.events[idx] = { ...this.ev };
		} else {
			this.plugin.events.push({ ...this.ev });
		}
		this.plugin.saveAll();
		this.close();
	}

	onClose(): void {
		this.timeControl?.dispose();
		this.colorControl?.dispose();
		this.contentEl.empty();
	}
}
