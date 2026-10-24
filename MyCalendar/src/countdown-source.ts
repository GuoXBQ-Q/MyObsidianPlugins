import type { CalendarEvent } from './types';
import { CALENDAR_SOURCE_VERSION, readCalendarSnapshot, type CalendarSnapshot, type CalendarSource } from '../../shared/calendar-source';

/** Published data is read only and always comes from the last successful save. */
export class CountdownSource implements CalendarSource {
	readonly version = CALENDAR_SOURCE_VERSION;
	private revision = 0;
	private alive = true;
	private listeners = new Set<() => void>();
	private displays = new Set<symbol>();
	constructor(private readEvents: () => CalendarEvent[]) {}
	private assertActive(): void { if (!this.alive) throw new Error('日程来源未连接'); }
	async getSnapshot(): Promise<CalendarSnapshot> {
		this.assertActive();
		return readCalendarSnapshot({ revision: this.revision, events: this.readEvents().filter(event => event.countdown).map(event => ({
			id: event.id, title: event.title, date: event.date, collection: event.countdown!.collection,
		})) });
	}
	subscribe(listener: () => void): () => void {
		this.assertActive(); this.listeners.add(listener); return () => { this.listeners.delete(listener); };
	}
	registerDisplayCapability(): () => void {
		this.assertActive(); const token = Symbol(); this.displays.add(token); return () => { this.displays.delete(token); };
	}
	get canDisplay(): boolean { return this.alive && this.displays.size > 0; }
	changed(): void { if (!this.alive) return; this.revision++; this.notify(); }
	private notify(): void {
		for (const listener of [...this.listeners]) { try { listener(); } catch (error) { console.error('[MyCalendar] 日程订阅通知失败', error); } }
	}
	dispose(): void { this.alive = false; this.displays.clear(); this.notify(); this.listeners.clear(); }
}
