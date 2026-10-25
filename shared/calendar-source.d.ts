export const CALENDAR_SOURCE_VERSION: 2;
export interface CalendarCountdown { id: string; title: string; date: string; }
export interface CalendarSnapshot { revision: number; events: CalendarCountdown[]; }
export interface CalendarSource {
  readonly version: 2;
  getSnapshot(): Promise<CalendarSnapshot>;
  subscribe(listener: () => void): () => void;
  registerDisplayCapability(): () => void;
}
export function calendarId(id: string): string;
export function readCalendarSnapshot(value: unknown): CalendarSnapshot;
