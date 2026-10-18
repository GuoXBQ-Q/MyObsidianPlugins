import { Plugin, WorkspaceLeaf } from 'obsidian';
import { CalendarView, VIEW_TYPE_MY_CALENDAR } from './calendar-view';
import { EventModal } from './event-modal';
import { FetchedArrangement, setFetchedArrangements } from './holidays';
import { MyCalendarSettingTab } from './settings';
import { CalendarEvent, DEFAULT_SETTINGS, MyCalendarSettings } from './types';
import { parseDateKey, todayKey } from './utils';
import { createMyCalendarWidget } from './widget';

type HomeWidgetSource = { pluginId: string; pluginName: string };
type HomeWidgetsAPI = { registerWidget: (definition: unknown, source: HomeWidgetSource) => () => void };

export default class MyCalendarPlugin extends Plugin {
	settings: MyCalendarSettings = DEFAULT_SETTINGS;
	events: CalendarEvent[] = [];
	/** 从网络获取的年份安排，持久化在 data.json */
	fetchedHolidays: FetchedArrangement[] = [];

	private refreshTargets = new Set<() => void>();
	private widgetApiUnregister: (() => void) | null = null;
	private widgetRetryTimer: number | null = null;

	async onload(): Promise<void> {
		await this.loadSettings();

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

		// 若安装了 Home Widgets，把月历注册为它的一个组件（宿主可能尚未加载，做带重试的注册）
		this.registerHomeWidget();
	}

	onunload(): void {
		if (this.widgetRetryTimer !== null) {
			window.clearTimeout(this.widgetRetryTimer);
			this.widgetRetryTimer = null;
		}
		this.widgetApiUnregister?.();
		this.widgetApiUnregister = null;
	}

	/** 通过 Home Widgets 公开 API（api.registerWidget）注册组件，插件加载顺序不确定时每秒重试 */
	private registerHomeWidget(attempt = 0): void {
		if (this.widgetApiUnregister) return;
		const api = this.homeWidgetsApi();
		if (api && typeof api.registerWidget === 'function') {
			try {
				this.widgetApiUnregister = api.registerWidget(createMyCalendarWidget(this), { pluginId: this.manifest.id, pluginName: this.manifest.name });
				return;
			} catch (e) {
				console.error('[MyCalendar] 注册 Home Widgets 组件失败', e);
				return;
			}
		}
		if (attempt < 60) {
			this.widgetRetryTimer = window.setTimeout(() => this.registerHomeWidget(attempt + 1), 1000);
		}
	}

	private homeWidgetsApi(): HomeWidgetsAPI | null {
		const hw = (this.app as unknown as { plugins?: { plugins?: Record<string, unknown> } }).plugins?.plugins?.['home-widgets'] as
			| { api?: Partial<HomeWidgetsAPI> & { version?: number } }
			| undefined;
		const api = hw?.api;
		if (!api || api.version !== 2 || typeof api.registerWidget !== 'function') return null;
		return { registerWidget: api.registerWidget.bind(hw) };
	}

	async loadSettings(): Promise<void> {
		const data = (await this.loadData()) as {
			events?: CalendarEvent[];
			settings?: Partial<MyCalendarSettings>;
			fetchedHolidays?: FetchedArrangement[];
		} | null;
		this.settings = Object.assign({}, DEFAULT_SETTINGS, data?.settings ?? {});
		this.events = Array.isArray(data?.events) ? data.events : [];
		this.fetchedHolidays = Array.isArray(data?.fetchedHolidays) ? data.fetchedHolidays : [];
		setFetchedArrangements(this.fetchedHolidays);
	}

	async saveAll(): Promise<void> {
		await this.saveData({
			events: this.events,
			settings: this.settings,
			fetchedHolidays: this.fetchedHolidays,
		});
		this.refreshViews();
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
