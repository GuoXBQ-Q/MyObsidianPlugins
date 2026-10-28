/** 日程事件 */
export interface CalendarEvent {
	id: string;
	/** 标题 */
	title: string;
	/** 日期，格式 YYYY-MM-DD */
	date: string;
	/** 结束日期（含当天），省略表示单日 */
	endDate?: string;
	/** 开始时间 HH:mm，留空表示全天 */
	startTime?: string;
	/** 结束时间 HH:mm */
	endTime?: string;
	/** 预设分类颜色 id，或自定义 #RRGGBB 色号 */
	color: string;
	/** 重要事件：当天单元格会被高亮突出 */
	important?: boolean;
	/** 已完成；省略表示未完成 */
	completed?: boolean;
	/** 备注 */
	note?: string;
	createdAt: number;
	/** 开启时单向同步到 Home Widgets 的唯一日期列表；省略则不参与同步。 */
	countdown?: true;
}

export type ViewMode = 'day' | 'week' | 'month' | 'agenda';

export interface MyCalendarSettings {
	weekStart: 'monday' | 'sunday';
	showLunar: boolean;
	showFestivals: boolean;
	/** 显示法定节假日（休）与调休上班（班）标记 */
	showHolidays: boolean;
	defaultView: ViewMode;
	/** 同日日程按添加顺序排列，新日程显示在下方 */
	newEventsAtBottom: boolean;
	/** 日/周视图时间轴起始小时（0-23） */
	dayStartHour: number;
	/** 日/周视图时间轴结束小时（1-24） */
	dayEndHour: number;
	/** 最近使用的自定义分类颜色 */
	customColors: string[];
}

export const DEFAULT_SETTINGS: MyCalendarSettings = {
	weekStart: 'monday',
	showLunar: true,
	showFestivals: true,
	showHolidays: true,
	defaultView: 'month',
	newEventsAtBottom: true,
	dayStartHour: 6,
	dayEndHour: 23,
	customColors: [],
};
