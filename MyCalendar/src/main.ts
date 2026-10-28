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

export default class MyCalendarPlugin extends Plugin {
	updater: PluginUpdater | null = null;
	settings: MyCalendarSettings = DEFAULT_SETTINGS;
	events: CalendarEvent[] = [];
	/** 从网络获取的年份安排，持久化在 data.json */
	fetchedHolidays: FetchedArrangement[] = [];

	private refreshTargets = new Set<() => void>();
	countdownSource: CountdownSource | null = null;
	homeWidget: HomeWidgetDefinition | null = null;
	private saveQueue: Promise<void> = Promise.resolve();
	private savedEvents: CalendarEvent[] = [];

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
		const source = this.countdownSource;
		this.countdownSource = null; this.homeWidget = null; source?.dispose();
	}

	isCountdownAvailable(): boolean { return this.countdownSource?.canDisplay ?? false; }

	async loadSettings(): Promise<void> {
		const data = (await this.loadData()) as {
			events?: CalendarEvent[];
			settings?: Partial<MyCalendarSettings>;
			fetchedHolidays?: FetchedArrangement[];
		} | null;
		this.settings = Object.assign({}, DEFAULT_SETTINGS, data?.settings ?? {});
		this.events = Array.isArray(data?.events) ? data.events : [];
		if (this.events.some(event => event.countdown !== undefined && event.countdown !== true)) throw new Error('倒计时关联格式不受支持，请先整理数据');
		this.savedEvents = JSON.parse(JSON.stringify(this.events));
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

	private persist(change?: (events: CalendarEvent[]) => CalendarEvent[], customColor?: string): Promise<void> {
		const job = this.saveQueue.catch(() => {}).then(async () => {
			const previous = this.savedEvents;
			const settings = { ...this.settings };
			if (customColor) settings.customColors = [...new Set([customColor, ...settings.customColors])].slice(0, 12);
			const snapshot = JSON.parse(JSON.stringify({
				events: change ? change(this.events) : this.events, settings, fetchedHolidays: this.fetchedHolidays,
			}));
			await this.saveData(snapshot);
			if (change) this.events = snapshot.events;
			if (customColor) this.settings.customColors = snapshot.settings.customColors;
			this.savedEvents = snapshot.events;
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
