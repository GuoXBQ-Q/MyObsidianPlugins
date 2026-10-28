import type { CalendarEvent } from './types';

/** A separate button keeps completion clicks from opening the event editor. */
export function createCompletionToggle(
	doc: Document,
	event: CalendarEvent,
	cls: string,
	toggle: () => Promise<void>,
	onError: (error: unknown) => void,
): HTMLButtonElement {
	const button = doc.createElement('button');
	button.type = 'button';
	button.className = cls;
	const action = event.completed ? '标记未完成' : '标记完成';
	button.setAttribute('aria-label', `${action}：${event.title}`);
	button.setAttribute('aria-pressed', String(!!event.completed));
	button.title = action;
	button.addEventListener('click', async e => {
		e.stopPropagation();
		if (button.disabled) return;
		button.disabled = true;
		try { await toggle(); }
		catch (error) { onError(error); }
		finally { button.disabled = false; }
	});
	return button;
}
