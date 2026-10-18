import { Notice, setIcon } from 'obsidian';
import { CalendarEvent, MyCalendarSettings } from './types';
import { colorOf, EVENT_COLORS, normalizeHex } from './utils';

interface ScreenPicker {
	open(options?: { signal?: AbortSignal }): Promise<{ sRGBHex: string }>;
}

export function mountColorPicker(container: HTMLElement, ev: CalendarEvent, settings: MyCalendarSettings): { validate: () => boolean; dispose: () => void } {
	const section = container.createDiv('mc-color-section');
	const heading = section.createDiv('mc-color-heading');
	heading.createEl('span', { cls: 'mc-label', text: '分类颜色' });
	const preview = heading.createEl('span', { cls: 'mc-color-preview' });
	const dot = preview.createSpan('mc-color-preview-dot');
	const selectedName = preview.createSpan();
	const row = section.createDiv('mc-color-row');
	row.setAttribute('role', 'group');
	row.setAttribute('aria-label', '预设分类颜色');
	const swatches: { button: HTMLButtonElement; value: string }[] = [];
	const addSwatch = (parent: HTMLElement, value: string, label: string) => {
		const sw = parent.createEl('button', { cls: 'mc-swatch', text: '✓', attr: { type: 'button', 'aria-label': label, title: label } });
		sw.style.setProperty('--mc-swatch-color', colorOf(value));
		sw.addEventListener('click', () => select(value));
		swatches.push({ button: sw, value });
	};
	for (const c of EVENT_COLORS) addSwatch(row, c.id, c.label);
	const recent = [...new Set((Array.isArray(settings.customColors) ? settings.customColors : []).filter((c): c is string => typeof c === 'string').map(normalizeHex).filter((c): c is string => !!c))].slice(0, 12);
	if (recent.length) {
		section.createDiv({ cls: 'mc-color-recent-label', text: '最近使用' });
		const recentRow = section.createDiv('mc-color-row mc-color-recent');
		for (const hex of recent) addSwatch(recentRow, hex, `自定义颜色 ${hex}`);
	}
	const tools = section.createDiv('mc-color-tools');
	const paletteLabel = tools.createEl('label', { cls: 'mc-color-native', attr: { title: '打开色盘选择任意颜色' } });
	const palette = paletteLabel.createEl('input', { type: 'color', attr: { 'aria-label': '色盘选色' } });
	paletteLabel.createSpan({ text: '色盘' });
	const hexInput = tools.createEl('input', { cls: 'mc-input mc-hex-input', type: 'text', attr: { 'aria-label': '自定义颜色色号', placeholder: '#RRGGBB', maxlength: '7', spellcheck: 'false', autocomplete: 'off' } });
	const eyedropper = tools.createEl('button', { cls: 'mc-btn mc-eyedropper', attr: { type: 'button', 'aria-label': '屏幕取色' } });
	setIcon(eyedropper.createSpan(), 'pipette');
	const eyeLabel = eyedropper.createSpan({ text: '屏幕取色' });
	const status = section.createDiv({ cls: 'mc-color-hint', text: '可选色盘或输入 HEX 色号；保存后自动记住自定义颜色。', attr: { 'aria-live': 'polite' } });
	const select = (value: string, updateText = true) => {
		ev.color = value;
		const hex = colorOf(value);
		palette.value = hex;
		if (updateText) hexInput.value = hex.toUpperCase();
		hexInput.setAttribute('aria-invalid', 'false');
		status.setText('可选色盘或输入 HEX 色号；保存后自动记住自定义颜色。');
		dot.style.backgroundColor = hex;
		selectedName.setText(EVENT_COLORS.find((c) => c.id === value)?.label ?? hex.toUpperCase());
		for (const sw of swatches) {
			const selected = sw.value === value;
			sw.button.classList.toggle('active', selected);
			sw.button.setAttribute('aria-pressed', String(selected));
		}
	};
	const validate = () => {
		const hex = normalizeHex(hexInput.value);
		if (!hex) { hexInput.setAttribute('aria-invalid', 'true'); status.setText('请输入 3 位或 6 位 HEX 色号，例如 #A8B5D1。'); return false; }
		// Preserve existing preset IDs when only normalizing the visible value.
		select(hex === colorOf(ev.color) ? ev.color : hex);
		status.setText('可选色盘或输入 HEX 色号；保存后自动记住自定义颜色。');
		return true;
	};
	palette.addEventListener('input', () => { select(palette.value); status.setText('已选择自定义颜色，保存后可再次使用。'); });
	hexInput.addEventListener('input', () => {
		const hex = normalizeHex(hexInput.value);
		if (hex) select(hex, false);
		hexInput.setAttribute('aria-invalid', 'false');
	});
	hexInput.addEventListener('blur', validate);
	const host = container.ownerDocument.defaultView as (Window & { EyeDropper?: new () => ScreenPicker }) | null;
	const EyeDropper = host?.EyeDropper;
	let pickController: AbortController | null = null;
	if (!EyeDropper) {
		eyedropper.disabled = true;
		eyedropper.title = '当前环境不支持屏幕取色，可使用左侧色盘或输入色号';
	}
	eyedropper.addEventListener('click', async () => {
		if (!EyeDropper) return;
		pickController = new AbortController();
		eyedropper.disabled = true;
		eyeLabel.setText('取色中…');
		try {
			const result = await new EyeDropper().open({ signal: pickController.signal });
			const hex = normalizeHex(result.sRGBHex);
			if (hex && section.isConnected) { select(hex); status.setText('已拾取屏幕颜色，保存后可再次使用。'); }
		} catch (error) {
			if ((error as Error).name !== 'AbortError') new Notice('屏幕取色暂不可用，请使用色盘或输入色号');
		} finally {
			eyedropper.disabled = false;
			eyeLabel.setText('屏幕取色');
			pickController = null;
		}
	});
	select(ev.color);
	return {
		validate: () => { if (validate()) return true; new Notice('请填写有效的分类颜色色号'); hexInput.focus(); return false; },
		dispose: () => pickController?.abort(),
	};
}
