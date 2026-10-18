// Minimal browser-only Obsidian shell; preview saves stay in memory.
const proto = HTMLElement.prototype as any;
proto.empty = function () { this.replaceChildren(); };
proto.addClass = function (...names: string[]) { this.classList.add(...names); };
proto.setText = function (text: string) { this.textContent = text; };
proto.createEl = function (tag: string, info: any = {}) {
	const el = document.createElement(tag);
	if (typeof info === 'string') el.className = info;
	else {
		if (info.cls) el.className = info.cls;
		if (info.text) el.textContent = info.text;
		if (info.type) el.setAttribute('type', info.type);
		if (info.placeholder) el.setAttribute('placeholder', info.placeholder);
		for (const [key, value] of Object.entries(info.attr ?? {})) el.setAttribute(key, value as string);
	}
	this.append(el);
	return el;
};
proto.createDiv = function (info: any) { return this.createEl('div', info); };
proto.createSpan = function (info: any) { return this.createEl('span', info); };
export class Modal {
	contentEl: HTMLElement;
	modalEl: HTMLElement;
	constructor(public app: unknown) {
		this.modalEl = document.createElement('div'); this.modalEl.className = 'modal';
		this.contentEl = document.createElement('div'); this.contentEl.className = 'modal-content';
		this.modalEl.append(this.contentEl);
	}
	open() { document.getElementById('stage')!.replaceChildren(this.modalEl); (this as any).onOpen(); }
	close() { (this as any).onClose(); this.modalEl.remove(); }
}
export class Notice {
	constructor(message: string) { document.getElementById('notice')!.textContent = message; }
}
export function setIcon(el: HTMLElement, name: string) {
	if (name === 'calendar-days') {
		el.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 11h18M8 15h1m6 0h1m-8 3h1"/></svg>';
		return;
	}
	if (name === 'star') {
		el.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2L12 17.3l-5.6 2.9 1.1-6.2L3 9.6l6.2-.9Z"/></svg>';
		return;
	}
	el.innerHTML = name === 'pipette'
		? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="m14 5 5 5M4 20l4-1 12-12a2.8 2.8 0 0 0-4-4L4 15l-1 5Z"/></svg>'
		: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><circle cx="12" cy="12" r="9"/><path d="M12 6v6l4 2"/></svg>';
}
