const dateKey = (date: Date): string => `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;

/** Check the local date only when the user returns to or interacts with a calendar. */
export function watchLocalDateChange(root: HTMLElement, onChange: (now: Date) => boolean | void): () => void {
	const doc = root.ownerDocument, win = doc.defaultView;
	if (!win) return () => {};
	let disposed = false, queued = false, pressed = false, pending = false;
	let lastDate = dateKey(new Date());
	let released: Event | null = null;
	const channel = new MessageChannel();

	// Run once after the input event finishes, without a timer. Browsers may run
	// microtasks between click listeners, before navigation/completion has acted.
	channel.port1.onmessage = () => {
		queued = false;
		if (disposed) return;
		// Dragging consumes pointerup and may suppress click entirely. Inspect the
		// event after the controller has finished, rather than waiting for a timer.
		if (released?.defaultPrevented) pressed = false;
		released = null;
		if (pressed) { pending = true; return; }
		const now = new Date(), current = dateKey(now);
		if (current === lastDate) { pending = false; return; }
		pending = true;
		if (onChange(now) !== false) { lastDate = current; pending = false; }
	};
	const request = (): void => {
		if (disposed || queued) return;
		queued = true;
		channel.port2.postMessage(null);
	};
	const clicked = (event: Event): void => {
		if (root.contains(event.target as Node | null) || pending) { pressed = false; request(); }
	};
	const pointerDown = (event: PointerEvent): void => {
		if (event.button !== 0 || event.isPrimary === false) return;
		pressed = true; released = null;
	};
	const pointerUp = (event: Event): void => {
		if (!pressed) return;
		// Inside the calendar, wait for click so its original action is preserved.
		if (root.contains(event.target as Node | null)) { released = event; request(); }
		else { pressed = false; if (pending) request(); }
	};
	const cancelled = (): void => {
		const wasPressed = pressed;
		pressed = false; released = null;
		if (pending || wasPressed) request();
	};
	const keyDown = (event: KeyboardEvent): void => {
		if (event.key === 'Escape' && (pressed || pending)) cancelled();
	};
	const blurred = (): void => { pressed = false; released = null; };
	win.addEventListener('focus', request);
	win.addEventListener('blur', blurred);
	root.addEventListener('focusin', request, true);
	root.addEventListener('pointerdown', pointerDown, true);
	// Capture also observes chip clicks that stop bubbling and the click suppressed
	// after a drag; checks run after the existing handlers have settled.
	doc.addEventListener('click', clicked, true);
	doc.addEventListener('pointerup', pointerUp, true);
	doc.addEventListener('pointercancel', cancelled, true);
	doc.addEventListener('keydown', keyDown, true);
	return () => {
		if (disposed) return;
		disposed = true;
		released = null;
		channel.port1.onmessage = null;
		channel.port1.close(); channel.port2.close();
		win.removeEventListener('focus', request);
		win.removeEventListener('blur', blurred);
		root.removeEventListener('focusin', request, true);
		root.removeEventListener('pointerdown', pointerDown, true);
		doc.removeEventListener('click', clicked, true);
		doc.removeEventListener('pointerup', pointerUp, true);
		doc.removeEventListener('pointercancel', cancelled, true);
		doc.removeEventListener('keydown', keyDown, true);
	};
}
