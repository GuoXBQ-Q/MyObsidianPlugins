import { Plugin, WorkspaceLeaf } from 'obsidian';
import { CalendarView, VIEW_TYPE_MY_CALENDAR } from './calendar-view';
import { EventModal } from './event-modal';
import { FetchedArrangement, setFetchedArrangements } from './holidays';
import { MyCalendarSettingTab } from './settings';
import { CalendarEvent, DEFAULT_SETTINGS, MyCalendarSettings } from './types';
import { normalizeHex, parseDateKey, todayKey } from './utils';
import { CountdownSource } from './countdown-source';
import { createMyCalendarWidget, type HomeWidgetDefinition } from './widget';
import * as obsidian from 'obsidian';
import { createPluginUpdater, type PluginUpdater } from '../../shared/plugin-updater';
import { emptyMonthLayout, normalizeMonthLayout, planMonthDrop, reconcileMonthLayout, refreshAutomaticMonthLayout, type MonthLayoutState } from './month-layout';

interface MonthStoredState { events: CalendarEvent[]; monthLayout: MonthLayoutState; }
interface MonthMoveUndo { before: MonthStoredState; after: string; expires: number; }

export default class MyCalendarPlugin extends Plugin {
	updater: PluginUpdater | null = null;
	settings: MyCalendarSettings = DEFAULT_SETTINGS;
	events: CalendarEvent[] = [];
	/** 仅月视图使用的手动顺序和横条行位。 */
	monthLayout: MonthLayoutState = emptyMonthLayout();
	/** 从网络获取的年份安排，持久化在 data.json */
	fetchedHolidays: FetchedArrangement[] = [];

	private refreshTargets = new Set<() => void>();
	countdownSource: CountdownSource | null = null;
	homeWidget: HomeWidgetDefinition | null = null;
	private saveQueue: Promise<void> = Promise.resolve();
	private savedEvents: CalendarEvent[] = [];
	private savedMonthSort = DEFAULT_SETTINGS.newEventsAtBottom;
	private monthUndo: MonthMoveUndo | null = null;
	private monthUndoTimer: ReturnType<typeof setTimeout> | null = null;
	private monthUndoNotice: obsidian.Notice | null = null;
	private monthUndoEnabled = true;

	async onload(): Promise<void> {
		await this.loadSettings();
		this.updater = createPluginUpdater(this, obsidian);
		this.countdownSource = new CountdownSource(() => this.savedEvents);
		this.homeWidget = createMyCalendarWidget(this);

		this.registerView(VIEW_TYPE_MY_CALENDAR, (leaf: WorkspaceLeaf) => new CalendarView(leaf, this));

		this.addRibbonIcon('calendar-days', '打开 MyCalendar 日历', () => this.activateView());

		this.addSettingTab(new MyCalendarSettingTab(this.app, this));

		this.addCommand({
			id: 'open-calendar',
			name: '打开日历视图',
			callback: () => this.activateView(),
		});
		this.addCommand({
			id: 'add-event',
			name: '新建日程（今天）',
			callback: () => new EventModal(this.app, this, null, todayKey()).open(),
		});
	}

	onunload(): void {
		this.monthUndoEnabled = false;
		this.clearMonthUndo();
		const source = this.countdownSource;
		this.countdownSource = null; this.homeWidget = null; source?.dispose();
	}

	isCountdownAvailable(): boolean { return this.countdownSource?.canDisplay ?? false; }

	async loadSettings(): Promise<void> {
		const data = (await this.loadData()) as {
			events?: CalendarEvent[];
			settings?: Partial<MyCalendarSettings>;
			fetchedHolidays?: FetchedArrangement[];
			monthLayout?: unknown;
		} | null;
		this.settings = Object.assign({}, DEFAULT_SETTINGS, data?.settings ?? {});
		this.savedMonthSort = this.settings.newEventsAtBottom;
		this.events = Array.isArray(data?.events) ? data.events : [];
		if (this.events.some(event => event.countdown !== undefined && event.countdown !== true)) throw new Error('倒计时关联格式不受支持，请先整理数据');
		this.savedEvents = JSON.parse(JSON.stringify(this.events));
		this.monthLayout = normalizeMonthLayout(data?.monthLayout, this.events);
		this.fetchedHolidays = Array.isArray(data?.fetchedHolidays) ? data.fetchedHolidays : [];
		setFetchedArrangements(this.fetchedHolidays);
	}

	saveAll(): Promise<void> { return this.persist(); }

	/** Serialize event edits against the latest committed state, including stale editors. */
	saveEvent(event: CalendarEvent, expected: CalendarEvent | null): Promise<void> {
		const draft: CalendarEvent = JSON.parse(JSON.stringify(event));
		if (!draft.title.trim()) return Promise.reject(new Error('请先填写日程标题'));
		draft.title = draft.title.trim();
		if (draft.countdown !== undefined && draft.countdown !== true) return Promise.reject(new Error('倒计时关联格式不受支持'));
		return this.persist(events => {
			const current = events.find(item => item.id === draft.id);
			if (expected ? !current || JSON.stringify(current) !== JSON.stringify(expected) : !!current) throw new Error('日程已变化，请重新打开后再编辑');
			return expected ? events.map(item => item.id === draft.id ? draft : item) : [...events, draft];
		}, normalizeHex(draft.color) ?? undefined);
	}

	deleteEvent(expected: CalendarEvent): Promise<void> {
		return this.persist(events => {
			const current = events.find(item => item.id === expected.id);
			if (!current || JSON.stringify(current) !== JSON.stringify(expected)) throw new Error('日程已变化，请重新打开后再删除');
			return events.filter(item => item.id !== expected.id);
		});
	}

	/** Toggle against the latest state so clicks from different views cannot overwrite edits. */
	toggleEventCompleted(id: string): Promise<void> {
		return this.persist(events => {
			const current = events.find(item => item.id === id);
			if (!current) throw new Error('日程已被删除，请刷新后重试');
			return events.map(item => item.id === id ? { ...item, completed: !current.completed } : item);
		});
	}

	/** Commit a drag and every affected row together, against the snapshot seen at pointer-down. */
	async moveMonthEvent(eventId: string, targetDate: string, targetLane: number, expected?: string): Promise<boolean> {
		let changed = false;
		let before: MonthStoredState | null = null;
		await this.persist((events, layout) => {
			if (expected !== undefined && expected !== JSON.stringify({ events, layout })) throw new Error('日程已变化，请重新拖动');
			const plan = planMonthDrop(events, layout, this.settings.newEventsAtBottom, eventId, targetDate, targetLane);
			if (!plan.valid) throw new Error(plan.reason ?? '此位置不可用');
			if (!plan.changed) return null;
			changed = true;
			before = JSON.parse(JSON.stringify({ events, monthLayout: layout }));
			return { events: plan.events, monthLayout: plan.layout };
		}, undefined, () => {
			if (before) this.offerMonthUndo(before);
		});
		return changed;
	}

	/** The latest move is the only undo opportunity; never overwrite subsequent edits. */
	async undoMonthMove(): Promise<boolean> {
		const undo = this.monthUndo;
		if (!undo) return false;
		let restored = false;
		await this.persist((events, layout) => {
			if (this.monthUndo !== undo) return null;
			if (Date.now() >= undo.expires) { this.clearMonthUndo(); return null; }
			if (undo.after !== JSON.stringify({ events, layout })) {
				this.clearMonthUndo();
				throw new Error('日程已再次变化，无法撤销本次移动');
			}
			restored = true;
			return JSON.parse(JSON.stringify(undo.before));
		}, undefined, () => { if (this.monthUndo === undo) this.clearMonthUndo(); });
		return restored;
	}

	private clearMonthUndo(): void {
		this.monthUndo = null;
		if (this.monthUndoTimer !== null) clearTimeout(this.monthUndoTimer);
		this.monthUndoTimer = null;
		this.monthUndoNotice?.hide?.();
		this.monthUndoNotice = null;
	}

	private offerMonthUndo(before: MonthStoredState): void {
		if (!this.monthUndoEnabled) return;
		this.clearMonthUndo();
		const undo: MonthMoveUndo = { before, after: JSON.stringify({ events: this.events, layout: this.monthLayout }), expires: Date.now() + 10_000 };
		this.monthUndo = undo;
		this.monthUndoTimer = setTimeout(() => { if (this.monthUndo === undo) this.clearMonthUndo(); }, 10_000);
		try {
			if (typeof document === 'undefined') { this.monthUndoNotice = new obsidian.Notice('日程已移动，可在 10 秒内撤销', 10_000); return; }
			const fragment = document.createDocumentFragment();
			fragment.append(document.createTextNode('日程已移动 '));
			const button = document.createElement('button');
			button.textContent = '撤销'; button.type = 'button';
			button.addEventListener('click', () => {
				button.disabled = true;
				void this.undoMonthMove().catch(error => {
					button.disabled = false;
					new obsidian.Notice(error instanceof Error ? error.message : '撤销失败，请重试');
				});
			});
			fragment.append(button);
			this.monthUndoNotice = new obsidian.Notice(fragment, 10_000);
		} catch (error) { console.error('[MyCalendar] 日程已保存，撤销提示显示失败', error); }
	}

	private persist(change?: (events: CalendarEvent[], layout: MonthLayoutState) => CalendarEvent[] | MonthStoredState | null, customColor?: string, onCommitted?: () => void): Promise<void> {
		const job = this.saveQueue.catch(() => {}).then(async () => {
			const previous = this.savedEvents;
			const settings = { ...this.settings };
			const result = change?.(this.events, this.monthLayout);
			if (result === null) return;
			const events = Array.isArray(result) ? result : result?.events ?? this.events;
			let monthLayout = Array.isArray(result)
				? reconcileMonthLayout(this.events, events, this.monthLayout, settings.newEventsAtBottom)
				: result?.monthLayout ?? this.monthLayout;
			const sortChanged = settings.newEventsAtBottom !== this.savedMonthSort;
			if (sortChanged) monthLayout = refreshAutomaticMonthLayout(events, monthLayout, settings.newEventsAtBottom);
			if (customColor) settings.customColors = [...new Set([customColor, ...settings.customColors])].slice(0, 12);
			const snapshot = JSON.parse(JSON.stringify({
				events, monthLayout, settings, fetchedHolidays: this.fetchedHolidays,
			}));
			await this.saveData(snapshot);
			if (change) this.events = snapshot.events;
			this.monthLayout = snapshot.monthLayout;
			this.savedMonthSort = snapshot.settings.newEventsAtBottom;
			if (sortChanged) this.clearMonthUndo();
			if (customColor) this.settings.customColors = snapshot.settings.customColors;
			this.savedEvents = snapshot.events;
			try { onCommitted?.(); }
			catch (error) { console.error('[MyCalendar] 日程已保存，保存后回调失败', error); }
			const relevant = (events: CalendarEvent[]) => JSON.stringify(events.filter(event => event.countdown).map(event => [event.id, event.title, event.date]));
			if (relevant(previous) !== relevant(this.savedEvents)) this.countdownSource?.changed();
			try { this.refreshViews(); }
			catch (error) { console.error('[MyCalendar] 日程已保存，界面刷新失败', error); }
		});
		this.saveQueue = job;
		return job;
	}

	/** 新增或替换一个年份的在线安排（按更新时间取最新） */
	async applyFetchedHolidays(item: FetchedArrangement): Promise<void> {
		this.fetchedHolidays = [
			...this.fetchedHolidays.filter((f) => f.year !== item.year),
			item,
		].sort((a, b) => a.year - b.year);
		setFetchedArrangements(this.fetchedHolidays);
		await this.saveAll();
	}

	async removeFetchedHolidays(year: number): Promise<void> {
		this.fetchedHolidays = this.fetchedHolidays.filter((f) => f.year !== year);
		setFetchedArrangements(this.fetchedHolidays);
		await this.saveAll();
	}

	refreshViews(): void {
		for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_MY_CALENDAR)) {
			const view = leaf.view;
			if (view instanceof CalendarView) view.rerender();
		}
		for (const cb of [...this.refreshTargets]) {
			try {
				cb();
			} catch (e) {
				console.error('[MyCalendar] 组件刷新失败', e);
			}
		}
	}

	/** 注册一个数据变化回调（Home Widgets 组件用），返回取消注册函数 */
	onRefresh(cb: () => void): () => void {
		this.refreshTargets.add(cb);
		return () => {
			this.refreshTargets.delete(cb);
		};
	}

	/** 打开日历视图并跳到指定日期的日视图（供组件"还有 N 项"跳转） */
	async openDayView(dateKey: string): Promise<void> {
		await this.activateView();
		const leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE_MY_CALENDAR)[0];
		if (leaf && leaf.view instanceof CalendarView) {
			leaf.view.jumpTo(parseDateKey(dateKey), 'day');
		}
	}

	async activateView(): Promise<void> {
		const { workspace } = this.app;
		const existing = workspace.getLeavesOfType(VIEW_TYPE_MY_CALENDAR);
		let leaf = existing[0];
		if (!leaf) {
			leaf = workspace.getLeaf('tab');
			await leaf.setViewState({ type: VIEW_TYPE_MY_CALENDAR, active: true });
		}
		workspace.revealLeaf(leaf);
	}
}
