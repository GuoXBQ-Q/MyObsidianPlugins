/** Keep the panel in the modal's DOM/focus scope while rendering above clipping. */
export function createPickerPopover(panel: HTMLElement, onClose: () => void = () => {}) {
	const doc = panel.ownerDocument;
	const win = doc.defaultView!;
	panel.setAttribute('popover', 'manual');
	panel.classList.add('mc-picker-popover');
	panel.hidden = true;
	let anchor: HTMLElement | null = null;
	let trigger: HTMLButtonElement | null = null;
	let disposed = false;
	const place = () => {
		if (!anchor || panel.hidden) return;
		const margin = 12, gap = 6;
		const rect = anchor.getBoundingClientRect();
		if (rect.bottom < margin || rect.top > win.innerHeight - margin) { close(); return; }
		panel.style.maxHeight = `${Math.max(0, win.innerHeight - margin * 2)}px`;
		const size = panel.getBoundingClientRect();
		const below = Math.max(0, win.innerHeight - rect.bottom - gap - margin);
		const above = Math.max(0, rect.top - gap - margin);
		const down = below >= size.height || below >= above;
		const space = down ? below : above;
		panel.style.maxHeight = `${space}px`;
		const height = Math.min(size.height, space);
		panel.style.left = `${Math.max(margin, Math.min(rect.left, win.innerWidth - size.width - margin))}px`;
		panel.style.top = `${Math.max(margin, Math.min(win.innerHeight - height - margin, down ? rect.bottom + gap : rect.top - gap - height))}px`;
	};
	const outside = (event: Event) => {
		const target = event.target as Node | null;
		if (target && !panel.contains(target) && !anchor?.contains(target)) close();
	};
	const onScroll = (event: Event) => { if (!panel.contains(event.target as Node)) place(); };
	const onKey = (event: KeyboardEvent) => {
		if (event.key !== 'Escape') return;
		event.preventDefault(); event.stopPropagation();
		const button = trigger;
		close(); button?.focus({ preventScroll: true });
	};
	function close() {
		if (panel.matches(':popover-open')) panel.hidePopover();
		panel.hidden = true;
		trigger?.setAttribute('aria-expanded', 'false');
		anchor = null; trigger = null;
		doc.removeEventListener('pointerdown', outside, true);
		doc.removeEventListener('click', outside, true);
		doc.removeEventListener('focusin', outside, true);
		doc.removeEventListener('scroll', onScroll, true);
		doc.removeEventListener('keydown', onKey, true);
		win.removeEventListener('resize', place);
		onClose();
	}
	return {
		close,
		open(field: HTMLElement, button: HTMLButtonElement) {
			if (disposed) return;
			anchor = field; trigger = button;
			panel.hidden = false;
			panel.showPopover(); place();
			button.setAttribute('aria-expanded', 'true');
			doc.addEventListener('pointerdown', outside, true);
			doc.addEventListener('click', outside, true);
			doc.addEventListener('focusin', outside, true);
			doc.addEventListener('scroll', onScroll, true);
			doc.addEventListener('keydown', onKey, true);
			win.addEventListener('resize', place);
		},
		dispose() { disposed = true; close(); },
	};
}
