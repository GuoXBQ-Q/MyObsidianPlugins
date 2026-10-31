import type MyCalendarPlugin from './main';
import type { CalendarEvent } from './types';
import { eventEndDate, isMultiDay, monthRangeSegments, placeRangeBar, type RangeSegment } from './event-range';
import { monthEventLanes, planMonthDrop, type MonthLayoutState } from './month-layout';
import { parseDateKey } from './utils';

export interface MonthDragSurface {
	grid: HTMLElement;
	previous: HTMLElement;
	next: HTMLElement;
	shiftMonth(delta: number): void;
	cellSelector: string;
	chipsSelector: string;
	top: number;
	step: number;
	visibleSingles: number;
	createChip(event: CalendarEvent): HTMLElement;
}

interface DragSession {
	id: string;
	pointerId: number;
	startX: number;
	startY: number;
	x: number;
	y: number;
	active: boolean;
	expected: string;
	events: CalendarEvent[];
	layout: MonthLayoutState;
}

/** The root survives month navigation, so pointer state never belongs to a replaceable chip. */
export class MonthDragController {
	private surface: MonthDragSurface | null = null;
	private session: DragSession | null = null;
	private layer: HTMLElement | null = null;
	private board: HTMLElement | null = null;
	private ghost: HTMLElement | null = null;
	private destination: { date: string; lane: number; valid: boolean } | null = null;
	private hoverDirection = 0;
	private hoverTimer: ReturnType<typeof setTimeout> | null = null;
	private animation = 0;
	private suppressUntil = 0;
	private disposed = false;
	private win: Window;

	constructor(private root: HTMLElement, private plugin: MyCalendarPlugin, private notify: (message: string) => void) {
		this.win = root.ownerDocument.defaultView!;
		root.addEventListener('pointerdown', this.pointerDown, true);
		root.addEventListener('click', this.suppressClick, true);
		root.addEventListener('dragstart', this.preventNativeDrag);
	}

	setSurface(surface: MonthDragSurface | null): void {
		if (!this.session?.active) this.restorePreview();
		this.surface = surface;
		if (!surface) this.cancel();
		else if (this.session?.active) this.updatePreview();
	}

	dispose(): void {
		if (this.disposed) return;
		this.disposed = true;
		this.cancel();
		this.root.removeEventListener('pointerdown', this.pointerDown, true);
		this.root.removeEventListener('click', this.suppressClick, true);
		this.root.removeEventListener('dragstart', this.preventNativeDrag);
		this.surface = null;
	}

	private layout(): MonthLayoutState {
		return this.plugin.monthLayout ?? { version: 1, manualDates: [], lanes: {} };
	}

	private cellAt(x: number, y: number): HTMLElement | undefined {
		const surface = this.surface;
		if (!surface?.grid.isConnected) return;
		const viewport = this.visibleBounds();
		if (x < viewport.left || x >= viewport.right || y < viewport.top || y >= viewport.bottom) return;
		return Array.from(surface.grid.querySelectorAll<HTMLElement>(surface.cellSelector)).find(cell => {
			const box = cell.getBoundingClientRect();
			return x >= box.left && x < box.right && y >= box.top && y < box.bottom;
		});
	}

	private visibleBounds(): { left: number; right: number; top: number; bottom: number } {
		const grid = this.surface!.grid, box = grid.getBoundingClientRect();
		const visible = { left: Math.max(0, box.left), right: Math.min(this.win.innerWidth, box.left + grid.clientWidth), top: Math.max(0, box.top), bottom: Math.min(this.win.innerHeight, box.top + grid.clientHeight) };
		for (let parent = grid.parentElement; parent; parent = parent.parentElement) {
			const style = this.win.getComputedStyle(parent), rect = parent.getBoundingClientRect();
			if (/(auto|scroll|hidden|clip|overlay)/.test(style.overflowX)) { visible.left = Math.max(visible.left, rect.left); visible.right = Math.min(visible.right, rect.right); }
			if (/(auto|scroll|hidden|clip|overlay)/.test(style.overflowY)) { visible.top = Math.max(visible.top, rect.top); visible.bottom = Math.min(visible.bottom, rect.bottom); }
		}
		return visible;
	}

	private pointerDown = (event: PointerEvent): void => {
		if (this.disposed || this.session || !this.surface || event.button !== 0 || event.isPrimary === false || (event.pointerType && event.pointerType !== 'mouse')) return;
		const target = event.target as Element | null;
		if (!target?.closest || target.closest('button, input, a, [data-no-month-drag]')) return;
		const card = target.closest<HTMLElement>('[data-event-id]');
		if (!card || !this.surface.grid.contains(card)) return;
		const item = this.plugin.events.find(item => item.id === card.dataset.eventId);
		if (!item || (isMultiDay(item) && this.cellAt(event.clientX, event.clientY)?.dataset.date !== item.date)) return;
		const layout = this.layout();
		this.session = {
			id: item.id, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY,
			x: event.clientX, y: event.clientY, active: false,
			expected: JSON.stringify({ events: this.plugin.events, layout }),
			events: JSON.parse(JSON.stringify(this.plugin.events)), layout: JSON.parse(JSON.stringify(layout)),
		};
		const doc = this.root.ownerDocument;
		doc.addEventListener('pointermove', this.pointerMove, { capture: true, passive: false });
		doc.addEventListener('pointerup', this.pointerUp, true);
		doc.addEventListener('pointercancel', this.pointerCancel, true);
		doc.addEventListener('keydown', this.keyDown, true);
		doc.addEventListener('scroll', this.onScroll, true);
		this.win.addEventListener('blur', this.pointerCancel);
		this.win.addEventListener('resize', this.onScroll);
	};

	private pointerMove = (event: PointerEvent): void => {
		const session = this.session;
		if (!session || event.pointerId !== session.pointerId) return;
		if (session.active && event.buttons === 0) { this.cancel(); return; }
		session.x = event.clientX; session.y = event.clientY;
		if (!session.active) {
			if (Math.hypot(session.x - session.startX, session.y - session.startY) < 6) return;
			session.active = true;
			this.root.addClass('mc-month-drag-active');
			this.root.ownerDocument.getSelection()?.removeAllRanges();
			this.makeLayer();
			this.animation = this.win.requestAnimationFrame(this.autoScroll);
		}
		event.preventDefault();
		event.stopPropagation();
		this.updateNavigation();
		this.updatePreview();
	};

	private pointerUp = (event: PointerEvent): void => {
		const session = this.session;
		if (!session || event.pointerId !== session.pointerId) return;
		if (!session.active) { this.cancel(); return; }
		event.preventDefault(); event.stopImmediatePropagation();
		session.x = event.clientX; session.y = event.clientY;
		this.updatePreview();
		const destination = this.destination;
		this.cancel();
		if (!destination?.valid) return;
		void this.plugin.moveMonthEvent(session.id, destination.date, destination.lane, session.expected)
			.catch(error => this.notify(error instanceof Error ? error.message : '日程移动失败，请重试'));
	};

	private pointerCancel = (): void => { this.cancel(); };
	private keyDown = (event: KeyboardEvent): void => {
		if (event.key !== 'Escape') return;
		event.preventDefault(); event.stopPropagation(); this.cancel();
	};
	private onScroll = (): void => { if (this.session?.active) this.updatePreview(); };
	private suppressClick = (event: MouseEvent): void => {
		if (Date.now() < this.suppressUntil) { event.preventDefault(); event.stopImmediatePropagation(); }
	};
	private preventNativeDrag = (event: DragEvent): void => {
		if ((event.target as Element | null)?.closest('[data-event-id]')) event.preventDefault();
	};

	private cancel(): void {
		if (this.session?.active) this.suppressUntil = Date.now() + 350;
		this.session = null; this.destination = null;
		this.clearHoverTimer(); this.hoverDirection = 0;
		if (this.animation) this.win.cancelAnimationFrame(this.animation);
		this.animation = 0;
		const doc = this.root.ownerDocument;
		doc.removeEventListener('pointermove', this.pointerMove, true);
		doc.removeEventListener('pointerup', this.pointerUp, true);
		doc.removeEventListener('pointercancel', this.pointerCancel, true);
		doc.removeEventListener('keydown', this.keyDown, true);
		doc.removeEventListener('scroll', this.onScroll, true);
		this.win.removeEventListener('blur', this.pointerCancel);
		this.win.removeEventListener('resize', this.onScroll);
		this.restorePreview();
		this.root.removeClass('mc-month-drag-active');
		this.layer?.remove(); this.layer = this.board = this.ghost = null;
	}

	private makeLayer(): void {
		const doc = this.root.ownerDocument;
		this.layer = doc.createElement('div'); this.layer.className = 'mc-month-drag-layer';
		this.board = doc.createElement('div');
		this.board.className = `mc-month-drag-board ${this.root.classList.contains('mcw-root') ? 'mcw-root' : 'my-calendar-view'}`;
		this.board.setAttribute('aria-hidden', 'true'); this.board.inert = true;
		const sourceStyle = this.win.getComputedStyle(this.root);
		Object.assign(this.board.style, {
			display: 'block', padding: '0', margin: '0', gap: '0',
			fontFamily: sourceStyle.fontFamily, fontSize: sourceStyle.fontSize, fontWeight: sourceStyle.fontWeight,
			fontStyle: sourceStyle.fontStyle, lineHeight: sourceStyle.lineHeight, letterSpacing: sourceStyle.letterSpacing, color: sourceStyle.color,
		});
		for (let i = 0; i < sourceStyle.length; i++) {
			const name = sourceStyle.item(i);
			if (name.startsWith('--')) this.board.style.setProperty(name, sourceStyle.getPropertyValue(name));
		}
		this.ghost = doc.createElement('div'); this.ghost.className = 'mc-month-drag-ghost'; this.ghost.setAttribute('role', 'status');
		this.layer.append(this.board, this.ghost); doc.body.append(this.layer);
	}

	private updateNavigation(): void {
		const session = this.session, surface = this.surface;
		if (!session?.active || !surface) return;
		let direction = 0;
		for (const [button, delta] of [[surface.previous, -1], [surface.next, 1]] as const) {
			const box = button.getBoundingClientRect();
			if (!button.hasAttribute('disabled') && session.x >= box.left && session.x <= box.right && session.y >= box.top && session.y <= box.bottom) direction = delta;
		}
		if (direction === this.hoverDirection) return;
		this.clearHoverTimer(); this.hoverDirection = direction;
		if (!direction) return;
		const button = direction < 0 ? surface.previous : surface.next;
		button.classList.add('mc-month-drag-nav-hover');
		this.hoverTimer = setTimeout(() => {
			this.hoverTimer = null;
			const box = button.getBoundingClientRect(), current = this.session;
			if (current?.active && this.hoverDirection === direction && current.x >= box.left && current.x <= box.right && current.y >= box.top && current.y <= box.bottom) {
				button.classList.remove('mc-month-drag-nav-hover');
				this.surface?.shiftMonth(direction);
			}
		}, 600);
	}

	private clearHoverTimer(): void {
		if (this.hoverTimer !== null) clearTimeout(this.hoverTimer);
		this.hoverTimer = null;
		this.surface?.previous.classList.remove('mc-month-drag-nav-hover');
		this.surface?.next.classList.remove('mc-month-drag-nav-hover');
	}

	private restorePreview(): void {
		this.root.classList.remove('mc-month-previewing');
		this.board?.replaceChildren();
	}

	private updatePreview(): void {
		const session = this.session, surface = this.surface;
		if (!session?.active || !surface || !this.board || !this.ghost) return;
		// Preview lives entirely in a fixed overlay. Resizing host rows here would
		// move dates underneath a stationary pointer and could change the saved date.
		const cell = this.cellAt(session.x, session.y);
		const date = cell?.dataset.date;
		const lane = cell ? Math.max(0, Math.floor((session.y - cell.getBoundingClientRect().top - surface.top + surface.step / 2) / surface.step)) : 0;
		this.board.replaceChildren();
		this.ghost.style.left = `${Math.min(session.x + 14, Math.max(4, this.win.innerWidth - 250))}px`;
		this.ghost.style.top = `${Math.min(session.y + 16, Math.max(4, this.win.innerHeight - 95))}px`;
		const event = session.events.find(item => item.id === session.id)!;
		this.ghost.replaceChildren();
		const title = this.root.ownerDocument.createElement('strong'); title.textContent = event.title;
		const detail = this.root.ownerDocument.createElement('span'); this.ghost.append(title, detail);
		this.destination = null;
		if (!date || !cell) {
			this.drawCandidate(session.events, session.layout);
			this.ghost.classList.remove('is-invalid'); detail.textContent = this.hoverDirection ? '停留 600 毫秒翻月；移开后可再次翻月' : '拖到目标日期和插入位置；Esc 取消';
			return;
		}
		const stale = session.expected !== JSON.stringify({ events: this.plugin.events, layout: this.layout() });
		const plan = stale ? null : planMonthDrop(session.events, session.layout, this.plugin.settings.newEventsAtBottom, session.id, date, lane);
		const valid = !!plan?.valid;
		this.destination = { date, lane, valid };
		this.ghost.classList.toggle('is-invalid', !valid);
		detail.textContent = stale ? '日程已变化，请重新拖动' : valid ? `${date} · 第 ${lane + 1} 行${plan!.changed ? '' : '（位置不变）'}` : (plan?.reason ?? '此位置不可用');
		if (valid && plan) {
			this.drawCandidate(plan.events, plan.layout);
			this.describeOverflow(plan.events, plan.layout, date, cell);
		} else this.drawCandidate(stale ? this.plugin.events : session.events, stale ? this.layout() : session.layout);
		this.drawMarker(date, lane, valid);
		this.ghost.style.top = `${Math.max(4, Math.min(session.y + 16, this.win.innerHeight - this.ghost.offsetHeight - 4))}px`;
	}

	private boardBounds(): DOMRect {
		const box = this.surface!.grid.getBoundingClientRect();
		const visible = this.visibleBounds(), grid = this.surface!.grid;
		Object.assign(this.board!.style, {
			left: `${box.left}px`, top: `${box.top}px`, width: `${grid.clientWidth}px`, height: `${grid.clientHeight}px`,
			clipPath: `inset(${Math.max(0, visible.top - box.top)}px ${Math.max(0, box.left + grid.clientWidth - visible.right)}px ${Math.max(0, box.top + grid.clientHeight - visible.bottom)}px ${Math.max(0, visible.left - box.left)}px)`,
		});
		return box;
	}

	private drawCandidate(events: CalendarEvent[], layout: MonthLayoutState): void {
		const surface = this.surface!;
		const cells = Array.from(surface.grid.querySelectorAll<HTMLElement>(surface.cellSelector));
		const lanes = monthEventLanes(events, layout, this.plugin.settings.newEventsAtBottom);
		const visible = new Map<string, CalendarEvent[]>();
		const moreLanes = new Map<string, number>();
		for (const cell of cells) {
			const date = cell.dataset.date!;
			const singles = events.filter(item => item.date === date && !isMultiDay(item)).sort((a, b) => lanes.get(a.id)! - lanes.get(b.id)!);
			visible.set(date, singles.slice(0, surface.visibleSingles));
			const onDay = events.filter(item => item.date <= date && eventEndDate(item) >= date && (isMultiDay(item) || visible.get(date)!.includes(item)));
			const occupied = new Set(onDay.map(item => lanes.get(item.id)));
			let moreLane = 0; while (occupied.has(moreLane)) moreLane++;
			if (singles.length > surface.visibleSingles) moreLanes.set(date, moreLane);
		}
		const bounds = this.boardBounds();
		this.root.classList.add('mc-month-previewing');
		for (const cell of cells) {
			const box = cell.getBoundingClientRect(), date = cell.dataset.date!;
			const chips = cell.querySelector<HTMLElement>(surface.chipsSelector)!.getBoundingClientRect();
			for (const event of visible.get(date) ?? []) this.previewCard(event, lanes.get(event.id) ?? 0, chips.left, chips.right, box.top, box.bottom, bounds);
			const count = events.filter(item => item.date === date && !isMultiDay(item)).length - surface.visibleSingles;
			if (count > 0) {
				const moreLane = moreLanes.get(date)!;
				const moreTop = box.top + surface.top + moreLane * surface.step;
				if (moreTop >= box.bottom - 2) continue;
				const more = this.root.ownerDocument.createElement('div');
				more.className = `${this.root.classList.contains('mcw-root') ? 'mcw-chip mcw-more' : 'mc-chip mc-more'} mc-month-drag-preview-more`;
				more.textContent = `还有 ${count} 项…`;
				Object.assign(more.style, { left: `${chips.left - bounds.left}px`, top: `${moreTop - bounds.top}px`, width: `${chips.width}px`, height: `${Math.min(surface.step - 2, box.bottom - moreTop - 2)}px` }); this.board!.append(more);
			}
		}
		if (!cells.length) return;
		const weeks = monthRangeSegments(events, parseDateKey(cells[0].dataset.date!), cells.length, this.plugin.settings.newEventsAtBottom);
		weeks.forEach((spans, week) => {
			for (const span of spans) {
				const first = cells[week * 7 + span.start]?.getBoundingClientRect(), last = cells[week * 7 + span.end]?.getBoundingClientRect();
				const inset = this.root.classList.contains('mcw-root') ? 2 : 3;
				if (first && last) this.previewCard(span.ev, lanes.get(span.ev.id) ?? 0, first.left + inset, last.right - inset, first.top, first.bottom, bounds, span);
			}
		});
	}

	private previewCard(event: CalendarEvent, lane: number, left: number, right: number, top: number, bottom: number, bounds: DOMRect, span?: RangeSegment): void {
		const cardTop = top + this.surface!.top + lane * this.surface!.step;
		const height = Math.min(this.surface!.step - 2, bottom - cardTop - 2);
		if (height <= 0) return;
		// Use the live renderer so completion rings, colors, fonts and range ends
		// stay identical when moving between valid and blocked destinations.
		const card = this.surface!.createChip(event);
		card.classList.add('mc-month-drag-preview-card'); card.dataset.previewEventId = event.id;
		if (span) {
			card.classList.add(this.root.classList.contains('mcw-root') ? 'mcw-range-bar' : 'mc-range-bar');
			placeRangeBar(card, span, 1, 0, 0);
		}
		card.removeAttribute('data-event-id'); card.inert = true;
		card.classList.toggle('is-dragged', event.id === this.session?.id);
		Object.assign(card.style, {
			position: 'absolute', boxSizing: 'border-box', gridRow: 'auto', gridColumn: 'auto', alignSelf: 'auto', margin: '0',
			left: `${left - bounds.left}px`, top: `${cardTop - bounds.top}px`,
			width: `${Math.max(0, right - left)}px`, height: `${height}px`,
		});
		this.board!.append(card);
	}

	private describeOverflow(events: CalendarEvent[], layout: MonthLayoutState, date: string, cell: HTMLElement): void {
		const lanes = monthEventLanes(events, layout, this.plugin.settings.newEventsAtBottom);
		const items = events.filter(event => event.date <= date && eventEndDate(event) >= date)
			.sort((a, b) => (lanes.get(a.id) ?? 0) - (lanes.get(b.id) ?? 0));
		const box = cell.getBoundingClientRect(), surface = this.surface!;
		if (!items.some(event => box.top + surface.top + (lanes.get(event.id) ?? 0) * surface.step + surface.step > box.bottom)) return;
		const order = this.root.ownerDocument.createElement('div');
		order.className = 'mc-month-drag-order';
		const label = this.root.ownerDocument.createElement('span'); label.textContent = '重排后：'; order.append(label);
		for (const event of items.slice(0, 7)) {
			const row = this.root.ownerDocument.createElement('span'); row.textContent = `${(lanes.get(event.id) ?? 0) + 1}. ${event.title}`; order.append(row);
		}
		if (items.length > 7) { const more = this.root.ownerDocument.createElement('span'); more.textContent = `其余 ${items.length - 7} 项顺延`; order.append(more); }
		this.ghost!.append(order);
	}

	private drawMarker(date: string, lane: number, valid: boolean): void {
		const surface = this.surface!;
		const cell = Array.from(surface.grid.querySelectorAll<HTMLElement>(surface.cellSelector)).find(cell => cell.dataset.date === date);
		if (!cell) return;
		const bounds = this.boardBounds(), box = cell.getBoundingClientRect();
		const marker = this.root.ownerDocument.createElement('div');
		marker.className = `mc-month-drag-marker${valid ? '' : ' is-invalid'}`;
		Object.assign(marker.style, { left: `${box.left + 3 - bounds.left}px`, top: `${Math.min(box.bottom - 3, box.top + surface.top + lane * surface.step) - bounds.top - 1}px`, width: `${box.width - 6}px` });
		this.board!.append(marker);
	}

	private autoScroll = (): void => {
		const session = this.session;
		if (!session?.active || !this.surface) return;
		for (let element: HTMLElement | null = this.surface.grid; element; element = element.parentElement) {
			if (element.scrollHeight <= element.clientHeight + 1 || !/(auto|scroll|overlay)/.test(this.win.getComputedStyle(element).overflowY)) continue;
			const box = element.getBoundingClientRect();
			if (session.x < box.left || session.x > box.right || session.y < box.top || session.y > box.bottom) continue;
			const edge = Math.min(38, box.height / 4);
			const delta = session.y < box.top + edge ? -Math.ceil((box.top + edge - session.y) / 3) : session.y > box.bottom - edge ? Math.ceil((session.y - box.bottom + edge) / 3) : 0;
			if (!delta) continue;
			const before = element.scrollTop; element.scrollTop += delta;
			if (before !== element.scrollTop) { this.updatePreview(); break; }
		}
		this.animation = this.win.requestAnimationFrame(this.autoScroll);
	};
}

/** Also injected by the homepage widget, including into Obsidian pop-out documents. */
export const MONTH_DRAG_CSS = `
.mc-month-drag-active { user-select: none; }
.mc-month-drag-active, .mc-month-drag-active * { cursor: grabbing !important; }
.mc-month-previewing [data-event-id], .mc-month-previewing .mc-more, .mc-month-previewing .mcw-more { visibility: hidden; }
.mc-month-drag-layer { position: fixed; inset: 0; pointer-events: none; z-index: 10000; color: var(--text-normal); font: 12px/1.5 var(--font-interface, sans-serif); }
.mc-month-drag-board { position: fixed; overflow: hidden; pointer-events: none; }
.mc-month-drag-ghost { position: fixed; display: flex; flex-direction: column; gap: 3px; max-width: 240px; padding: 8px 11px; border: 1px solid var(--interactive-accent); border-radius: 8px; background: var(--background-primary); box-shadow: 0 5px 20px #0003; }
.mc-month-drag-ghost strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mc-month-drag-ghost span { font-size: 11px; color: var(--text-muted); }
.mc-month-drag-order { display: flex; flex-direction: column; max-height: 140px; overflow: hidden; border-top: 1px solid var(--background-modifier-border); padding-top: 3px; }
.mc-month-drag-order span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mc-month-drag-ghost.is-invalid { border-color: var(--text-error, #d74b4b); }
.mc-month-drag-ghost.is-invalid span { color: var(--text-error, #d74b4b); }
.mc-month-drag-preview-card, .mc-month-drag-preview-more { position: absolute; box-sizing: border-box; pointer-events: none; }
.mc-month-drag-preview-card.is-dragged { outline: 1px dashed var(--interactive-accent); outline-offset: -1px; }
.mc-month-drag-marker { position: absolute; height: 3px; border-radius: 2px; background: var(--interactive-accent); box-shadow: 0 0 0 1px var(--background-primary); }
.mc-month-drag-marker.is-invalid { background: var(--text-error, #d74b4b); }
.mc-month-drag-nav-hover { outline: 2px solid var(--interactive-accent) !important; outline-offset: 2px; background: var(--background-modifier-hover) !important; }
`;
