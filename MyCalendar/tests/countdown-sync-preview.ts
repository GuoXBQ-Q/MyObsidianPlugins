// Actual source, adapter, persistence and widgets; all business data stays in memory.
import MyCalendarPlugin from '../src/main';
import { EventModal } from '../src/event-modal';
import { CountdownSource } from '../src/countdown-source';
import { createMyCalendarWidget } from '../src/widget';
import { DEFAULT_SETTINGS } from '../src/types';
import { createPluginDataStore } from '../../HomeWidgets/src/services/plugin-data';
import { createPersistentEventService } from '../../HomeWidgets/src/services/persistent-events';
import { createCalendarDisplayStore } from '../../HomeWidgets/src/services/calendar-display';
import { createCalendarAdapter } from '../../HomeWidgets/src/adapters/calendar-source';
import { createCountdownService } from '../../HomeWidgets/src/services/countdown';
import { Bus } from '../../HomeWidgets/src/core/lifecycle';
import { createHost } from '../../HomeWidgets/src/core/host';
import { WidgetRegistry } from '../../HomeWidgets/src/core/registry';
import { createLayoutStore } from '../../HomeWidgets/src/services/layout';
import countdown from '../../HomeWidgets/src/widgets/countdown';
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
let homeData: any = {}, calendarData: any = { events: [], settings: DEFAULT_SETTINGS, fetchedHolidays: [] };
let failCalendar = false, failHome = false, failSource = false, connected = true;
const bus = new Bus(), registry = new WidgetRegistry(); registry.register(countdown);
registry.register({ type: 'draft-editor', label: '编辑保护', defaults: {}, watch: () => ['countdown:default'], mount(ctx: any) {
	const input = document.createElement('textarea'); input.setAttribute('aria-label', '未保存的编辑内容'); input.value = '初始内容';
	const action = document.createElement('button'); action.textContent = '编辑区操作'; ctx.el.append(input, action);
} });
const data = createPluginDataStore({ load: async () => homeData, save: async (value: any) => {
	if (failHome) throw new Error('展示状态保存失败（模拟）'); homeData = clone(value);
} });
const app = { workspace: { getLeavesOfType: () => [] } };
const plugin = new MyCalendarPlugin(app as any, {} as any); plugin.settings = clone(DEFAULT_SETTINGS);
plugin.saveData = async (value: any) => { if (failCalendar) throw new Error('日程保存失败（模拟）'); calendarData = clone(value); };
function replaceSource() {
	const old = plugin.countdownSource; plugin.countdownSource = new CountdownSource(() => calendarData.events);
	const get = plugin.countdownSource.getSnapshot.bind(plugin.countdownSource);
	plugin.countdownSource.getSnapshot = async () => { if (failSource) throw new Error('来源读取失败（模拟）'); return get(); };
	plugin.homeWidget = createMyCalendarWidget(plugin); old?.dispose();
}
replaceSource();
const adapter = createCalendarAdapter({ display: createCalendarDisplayStore(data), bus,
	resolve: () => connected ? { source: plugin.countdownSource, widget: plugin.homeWidget } : null,
	registerWidget(definition: any) { const off = registry.register(definition, { pluginId: 'my-calendar', pluginName: 'MyCalendar', kind: 'external' }); bus.emit('registry'); return () => { off(); bus.emit('registry'); }; },
	setTimer: () => 1, clearTimer() {},
});
const dates = createCountdownService(createPersistentEventService(data, bus), adapter); adapter.start();
let modal: EventModal | null = null;
const open = (index?: number) => { modal?.close(); modal = new EventModal(app as any, plugin, index === undefined ? null : plugin.events[index], '2026-11-06'); modal.open(); };
const host = document.getElementById('countdown')!, actions = document.getElementById('countdown-actions')!;
const renderInner = async () => {
	host.replaceChildren(); actions.replaceChildren();
	await countdown.mount({ id: 'sync-preview', doc: document, el: host, actions, local: {}, config: countdown.defaults,
		signal: { aborted: false }, services: { events: dates }, forms: { show() {}, confirm() {} }, lifetime: { interval() {} },
		updateConfig: async () => {}, refresh: render, run: (fn: any) => fn(), notify: (message: string) => { document.getElementById('notice')!.textContent = message; },
	} as any);
};
let renderQueue = Promise.resolve();
const render = () => { const job = renderQueue.catch(() => {}).then(renderInner); renderQueue = job; return job; };
bus.on('countdown:default', () => { void render(); }); bus.on('calendar-source', () => { void render(); });
const mountHost = async (container: HTMLElement) => {
	let layout = JSON.stringify({ version: 2, theme: 'native', widgets: [
		{ id: 'host-countdown', type: 'countdown', title: '实际宿主倒计时', span: 12, settings: {} },
		{ id: 'host-editor', type: 'draft-editor', title: '编辑保护', span: 12, settings: {} },
		{ id: 'calendar-one', type: 'my-calendar', title: '日历一', span: 6, settings: {} },
		{ id: 'calendar-two', type: 'my-calendar', title: '日历二', span: 6, settings: {} },
	] });
	const io = { read: async () => layout, update: async (_path: string, update: (text: string) => string) => { layout = update(layout); }, resource: (path: string) => path };
	const store = createLayoutStore(io, bus), instance = createHost(container, { registry, store, services: { io, bus, events: dates, tasks: { onReopen: () => () => {} } } });
	await instance.ready; return { ...instance, removeFirstCalendar: () => store.remove('calendar-one') };
};
document.getElementById('new')!.addEventListener('click', () => open());
(window as any).calendarPreview = { plugin, dates, open, render, mountHost, replaceSource,
	setHostState(state: string) { connected = state === 'connected'; adapter.check(); },
	get calendar() { return clone(calendarData); }, get home() { return clone(homeData); },
	set failCalendar(value: boolean) { failCalendar = value; }, set failHome(value: boolean) { failHome = value; }, set failSource(value: boolean) { failSource = value; },
	async sync() { await adapter.refresh(); await render(); },
};
void render(); open();
