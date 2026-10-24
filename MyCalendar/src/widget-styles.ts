/** MyCalendar Home Widgets 组件样式，挂载时注入一次（scope: .mcw-root） */
const styleLeases = new WeakMap<Document, { style: HTMLStyleElement; users: number }>();
export function acquireCalendarWidgetStyles(doc: Document): () => void {
	let lease = styleLeases.get(doc);
	if (!lease) {
		const style = doc.createElement('style'); style.id = 'my-calendar-widget-css'; style.textContent = MY_CALENDAR_WIDGET_CSS;
		doc.head.append(style); lease = { style, users: 0 }; styleLeases.set(doc, lease);
	}
	lease.users++; let released = false;
	return () => {
		if (released) return; released = true;
		if (--lease!.users === 0) { lease!.style.remove(); styleLeases.delete(doc); }
	};
}
export const MY_CALENDAR_WIDGET_CSS = `
.mcw-root {
	--mcw-festival: #d05a5a;
	--mcw-today: #e0566b;
	display: flex;
	flex-direction: column;
	gap: 6px;
	height: 100%;
	min-height: 0;
	font-size: 12px;
	color: var(--text-normal);
}

.mcw-head {
	display: flex;
	align-items: center;
	gap: 6px;
	flex: 0 0 auto;
}

.mcw-title {
	font-weight: 800;
	font-size: 14px;
	letter-spacing: 0.3px;
	flex: 1;
	min-width: 0;
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
}

.mcw-nav {
	display: flex;
	gap: 3px;
}

.mcw-btn {
	border: 1px solid var(--background-modifier-border);
	background: transparent;
	color: var(--text-muted);
	border-radius: 7px;
	padding: 2px 9px;
	cursor: pointer;
	font-size: 11px;
	line-height: 1.6;
	white-space: nowrap;
}

.mcw-btn:hover {
	color: var(--text-normal);
	background: var(--background-modifier-hover);
}

.mcw-weekdays {
	display: grid;
	grid-template-columns: repeat(7, 1fr);
	border-bottom: 1px solid var(--background-modifier-border);
	flex: 0 0 auto;
}

.mcw-weekday {
	text-align: center;
	padding: 2px 0;
	color: var(--text-muted);
	font-weight: 600;
	font-size: 11px;
}

.mcw-grid {
	display: grid;
	grid-template-columns: repeat(7, 1fr);
	grid-template-rows: repeat(6, minmax(50px, auto));
	flex: 1;
	min-height: 0;
}

.mcw-cell {
	border-right: 1px solid var(--background-modifier-border);
	border-bottom: 1px solid var(--background-modifier-border);
	padding: 3px 4px;
	min-height: 50px;
	cursor: pointer;
	display: flex;
	flex-direction: column;
	gap: 2px;
	overflow: hidden;
	background: var(--mcw-bg, transparent);
	transition: box-shadow 0.15s ease;
}

.mcw-cell:nth-child(7n) {
	border-right: none;
}
.mcw-root .mcw-range-bar {
	align-self: start; z-index: 2; min-width: 0; height: 16px; margin: 0 2px;
	box-sizing: border-box; border-left: 2px solid var(--mcw-chip-color);
}
.mcw-range-bar.mc-range-before { border-top-left-radius: 0; border-bottom-left-radius: 0; }
.mcw-range-bar.mc-range-after { border-top-right-radius: 0; border-bottom-right-radius: 0; }
.mcw-top { flex-shrink: 0; }

.mcw-cell:hover {
	box-shadow: inset 0 0 0 1.5px var(--mcw-ring, var(--background-modifier-border));
}

.mcw-cell.mcw-special {
	box-shadow: inset 0 0 0 1.5px var(--mcw-ring, var(--mcw-today));
}

.mcw-other .mcw-num,
.mcw-other .mcw-lunar {
	opacity: 0.4;
}

.mcw-top {
	display: flex;
	align-items: center;
	gap: 3px;
	min-width: 0;
}

.mcw-num {
	font-weight: 700;
	min-width: 18px;
	height: 18px;
	line-height: 18px;
	text-align: center;
	border-radius: 50%;
	flex-shrink: 0;
}

.mcw-today .mcw-num {
	border: 1.5px solid var(--mcw-today);
	color: var(--mcw-today);
}

.mcw-lunar {
	font-size: 10px;
	color: var(--text-muted);
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
}

.mcw-badge {
	font-size: 9.5px;
	color: var(--mcw-festival);
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
}

.mcw-hol {
	flex-shrink: 0;
	margin-left: auto;
	display: inline-flex;
	align-items: center;
	justify-content: center;
	min-width: 13px;
	height: 13px;
	padding: 0 2px;
	border-radius: 3px;
	font-size: 9px;
	font-weight: 700;
	line-height: 1;
	box-sizing: border-box;
}

.mcw-hol-holiday {
	background: rgba(208, 90, 90, 0.14);
	color: var(--mcw-festival);
}

.mcw-hol-work {
	background: rgba(91, 124, 185, 0.16);
	color: #5b7cb9;
}

.mcw-cell.mcw-holiday:not(.mcw-has-events) {
	background: rgba(208, 90, 90, 0.05);
}

.mcw-chips {
	display: flex;
	flex-direction: column;
	gap: 2px;
	min-height: 0;
	overflow: hidden;
}

.mcw-chip {
	display: flex;
	align-items: center;
	gap: 3px;
	font-size: 10px;
	line-height: 1.5;
	padding: 0 4px;
	border-radius: 5px;
	white-space: nowrap;
	overflow: hidden;
	cursor: pointer;
}

.mcw-dot {
	width: 6px;
	height: 6px;
	box-sizing: border-box;
	border-radius: 50%;
	border: 1px solid var(--mcw-chip-color, var(--interactive-accent));
	background: transparent;
	flex-shrink: 0;
}

.mcw-time {
	color: var(--mcw-chip-color, var(--interactive-accent));
	font-weight: 600;
	flex-shrink: 0;
	font-variant-numeric: tabular-nums;
}

.mcw-name {
	overflow: hidden;
	text-overflow: ellipsis;
	opacity: 0.85;
}

.mcw-star {
	color: #f5b400;
	flex-shrink: 0;
}

.mcw-more {
	color: var(--text-muted);
	background: var(--background-secondary);
	justify-content: center;
}
`;
