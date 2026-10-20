import { App, Notice, PluginSettingTab, Setting } from 'obsidian';
import { fetchYearArrangement } from './holiday-fetch';
import { BUILT_IN_YEARS, fetchedYears } from './holidays';
import type MyCalendarPlugin from './main';
import { ViewMode } from './types';
import * as obsidian from 'obsidian';
import { renderUpdateSettings } from '../../shared/plugin-updater';

export class MyCalendarSettingTab extends PluginSettingTab {
	private plugin: MyCalendarPlugin;
	private holidayStatusEl: HTMLElement | null = null;
	private disposeUpdater: (() => void) | null = null;

	constructor(app: App, plugin: MyCalendarPlugin) {
		super(app, plugin);
		this.plugin = plugin;
		plugin.register(() => this.hide());
	}

	hide(): void {
		this.disposeUpdater?.();
		this.disposeUpdater = null;
		this.holidayStatusEl = null;
		this.yearInputEl = null;
	}

	display(): void {
		this.hide();
		const { containerEl } = this;
		containerEl.empty();
		const root = containerEl.createDiv('mc-settings');
		const heading = root.createDiv('mc-set-heading');
		heading.createEl('h2', { text: 'MyCalendar 日历设置' });
		heading.createEl('p', { text: '调整日历显示、节假日与插件更新。' });
		const tabs = root.createDiv('mc-set-tabs');
		tabs.setAttribute('role', 'tablist');
		tabs.setAttribute('aria-label', '设置分类');
		const buttons = new Map<string, HTMLButtonElement>();
		const panels = new Map<string, HTMLElement>();
		const selectTab = (key: string) => {
			for (const [id, button] of buttons) {
				const active = id === key;
				button.classList.toggle('is-active', active);
				button.setAttribute('aria-selected', String(active));
				button.tabIndex = active ? 0 : -1;
				panels.get(id)!.hidden = !active;
			}
		};
		for (const [key, label] of [['general', '通用'], ['updates', '更新']]) {
			const button = tabs.createEl('button', { cls: 'mc-set-tab', text: label });
			button.type = 'button';
			button.id = `mc-settings-tab-${key}`;
			button.setAttribute('role', 'tab');
			button.setAttribute('aria-controls', `mc-settings-${key}`);
			const panel = root.createDiv('mc-set-panel');
			panel.id = `mc-settings-${key}`;
			panel.setAttribute('role', 'tabpanel');
			panel.setAttribute('aria-labelledby', button.id);
			panel.tabIndex = 0;
			buttons.set(key, button);
			panels.set(key, panel);
			button.addEventListener('click', () => selectTab(key));
			button.addEventListener('keydown', (event) => {
				const keys = [...buttons.keys()];
				let next: string;
				if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
					const step = event.key === 'ArrowRight' ? 1 : -1;
					next = keys[(keys.indexOf(key) + step + keys.length) % keys.length];
				} else if (event.key === 'Home' || event.key === 'End') {
					next = event.key === 'Home' ? keys[0] : keys[keys.length - 1];
				} else return;
				event.preventDefault();
				selectTab(next);
				buttons.get(next)!.focus();
			});
		}
		this.renderGeneralSettings(panels.get('general')!);
		this.disposeUpdater = renderUpdateSettings(panels.get('updates')!, this.plugin.updater, obsidian);
		selectTab('general');
	}

	private group(parent: HTMLElement, title: string, description: string): HTMLElement {
		const section = parent.createDiv('mc-set-group');
		const heading = section.createDiv('mc-set-group-heading');
		heading.createEl('h3', { text: title });
		heading.createEl('p', { text: description });
		return section.createDiv('mc-set-group-body');
	}

	private renderGeneralSettings(containerEl: HTMLElement): void {
		const view = this.group(containerEl, '视图与日程', '选择默认视图，调整日程顺序与每周起始日。');
		new Setting(view)
			.setName('默认视图')
			.setDesc('打开日历时默认显示的视图')
			.addDropdown((dd) =>
				dd
					.addOptions({ month: '月视图', week: '周视图', day: '日视图', agenda: '日程' })
					.setValue(this.plugin.settings.defaultView)
					.onChange(async (v) => {
						this.plugin.settings.defaultView = v as ViewMode;
						await this.plugin.saveAll();
					})
			);

		new Setting(view)
			.setName('新日程显示在下方')
			.setDesc('开启后，同一天的日程按添加顺序排列；关闭后按开始时间、标题排序。适用于月历、首页组件、全天/跨天栏和日程列表；时间轴仍按实际时间定位。')
			.addToggle((t) =>
				t.setValue(this.plugin.settings.newEventsAtBottom).onChange(async (v) => {
					this.plugin.settings.newEventsAtBottom = v;
					await this.plugin.saveAll();
				})
			);

		new Setting(view)
			.setName('周首日')
			.setDesc('月视图和周视图每星期从哪一天开始')
			.addDropdown((dd) =>
				dd
					.addOptions({ monday: '周一', sunday: '周日' })
					.setValue(this.plugin.settings.weekStart)
					.onChange(async (v) => {
						this.plugin.settings.weekStart = v as 'monday' | 'sunday';
						await this.plugin.saveAll();
					})
			);

		const holidays = this.group(containerEl, '农历与节假日', '显示农历、节日节气与法定放假调休安排。');
		new Setting(holidays)
			.setName('显示农历')
			.setDesc('在日期旁显示农历日期')
			.addToggle((t) =>
				t.setValue(this.plugin.settings.showLunar).onChange(async (v) => {
					this.plugin.settings.showLunar = v;
					await this.plugin.saveAll();
				})
			);

		new Setting(holidays)
			.setName('显示节日与节气')
			.setDesc('以红色文字显示传统节日和二十四节气')
			.addToggle((t) =>
				t.setValue(this.plugin.settings.showFestivals).onChange(async (v) => {
					this.plugin.settings.showFestivals = v;
					await this.plugin.saveAll();
				})
			);

		new Setting(holidays)
			.setName('显示法定节假日调休')
			.setDesc('以「休」「班」角标显示国务院发布的放假与调休安排（内置 2025、2026 年，可通过下方按钮在线获取其他年份）')
			.addToggle((t) =>
				t.setValue(this.plugin.settings.showHolidays).onChange(async (v) => {
					this.plugin.settings.showHolidays = v;
					await this.plugin.saveAll();
				})
			);

		this.renderHolidayFetcher(holidays);
		this.holidayStatusEl = holidays.createDiv('mc-hol-status');
		this.renderHolidayStatus();

		const timeline = this.group(containerEl, '时间轴', '设置日视图和周视图的时间显示范围。');
		this.hourSetting(timeline, '时间轴起始小时', '日/周视图时间轴从几点开始（0-23）', 'dayStartHour');
		this.hourSetting(timeline, '时间轴结束小时', '日/周视图时间轴到几点结束（0-23）', 'dayEndHour');
	}

	/** 在线获取节假日安排：年份输入 + 获取按钮 */
	private renderHolidayFetcher(containerEl: HTMLElement): void {
		const defaultYear = new Date().getFullYear() + 1;
		new Setting(containerEl)
			.setName('在线获取节假日安排')
			.setDesc(
				'输入年份后点「获取」，从 holiday-cn / timor.tech 拉取该年国务院放假调休安排' +
					'（官方一般每年 11 月底发布下一年安排，发布前获取会失败）'
			)
			.addText((t) => {
				t.setPlaceholder(`如 ${defaultYear}`);
				t.inputEl.type = 'number';
				t.inputEl.min = '2007';
				t.inputEl.max = '2100';
				t.inputEl.style.width = '90px';
				t.setValue(String(defaultYear));
				this.yearInputEl = t.inputEl;
			})
			.addButton((btn) =>
				btn.setButtonText('获取').setCta().onClick(async () => {
					const year = Number(this.yearInputEl?.value);
					if (!Number.isInteger(year) || year < 2007 || year > 2100) {
						new Notice('请输入有效年份（2007–2100）');
						return;
					}
					btn.setDisabled(true);
					btn.setButtonText('获取中…');
					try {
						const item = await fetchYearArrangement(year);
						await this.plugin.applyFetchedHolidays(item);
						const off = item.days.filter((d) => d.isOffDay).length;
						new Notice(`✅ ${year} 年安排获取成功：放假 ${off} 天，调休上班 ${item.days.length - off} 天（来源：${item.source}）`, 6000);
					} catch (e) {
						new Notice(`❌ ${year} 年数据获取失败（可能尚未发布或网络不通）\n${e instanceof Error ? e.message : String(e)}`, 10000);
					}
					btn.setDisabled(false);
					btn.setButtonText('获取');
					this.renderHolidayStatus();
				})
			);
	}

	private yearInputEl: HTMLInputElement | null = null;

	/** 展示当前可用年份：内置 + 在线（可删除） */
	private renderHolidayStatus(): void {
		const el = this.holidayStatusEl;
		if (!el) return;
		el.empty();
		const builtinLine = el.createDiv('mc-hol-line');
		builtinLine.createSpan({ text: `内置年份：${BUILT_IN_YEARS.join('、')}` });

		const list = fetchedYears();
		if (!list.length) {
			el.createDiv({ cls: 'mc-hol-line mc-hol-muted', text: '暂无在线数据，仅使用内置数据。' });
			return;
		}
		for (const f of list) {
			const line = el.createDiv('mc-hol-line');
			const time = new Date(f.updatedAt).toLocaleString();
			line.createSpan({ text: `在线数据：${f.year} 年（${f.dayCount} 条记录，来源 ${f.source}，获取于 ${time}）` });
			const del = line.createEl('button', { cls: 'mc-btn mc-hol-del', text: '删除' });
			del.addEventListener('click', async () => {
				await this.plugin.removeFetchedHolidays(f.year);
				this.renderHolidayStatus();
			});
		}
	}

	private hourSetting(containerEl: HTMLElement, name: string, desc: string, key: 'dayStartHour' | 'dayEndHour'): void {
		new Setting(containerEl)
			.setName(name)
			.setDesc(desc)
			.addText((t) => {
				t.inputEl.type = 'number';
				t.inputEl.min = '0';
				t.inputEl.max = '23';
				t.setValue(String(this.plugin.settings[key]));
				t.onChange(async (v) => {
					const n = Number(v);
					if (Number.isNaN(n)) return;
					this.plugin.settings[key] = Math.max(0, Math.min(23, Math.round(n)));
					if (this.plugin.settings.dayEndHour <= this.plugin.settings.dayStartHour) {
						this.plugin.settings.dayEndHour = Math.min(23, this.plugin.settings.dayStartHour + 1);
					}
					await this.plugin.saveAll();
				});
			});
	}
}
