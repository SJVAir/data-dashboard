import { LONG_PRESS_DELAY, LONG_PRESS_TOLERANCE } from "./config";

/**
 * Wait for the press `event` to hold still for the long-press delay. A move farther than the
 * tolerance (a page swipe), the release, or `pointercancel` gives up; otherwise `onLift` gets
 * the pointer's latest event. Returns a function that gives up early.
 */
export function startLongPress(
	event: PointerEvent,
	onLift: (at: PointerEvent) => void
): () => void {
	const pointerId = event.pointerId;
	let latest = event;
	let ended = false;

	function onMove(e: PointerEvent): void {
		if (e.pointerId !== pointerId) return;
		latest = e;
		const moved = Math.hypot(e.clientX - event.clientX, e.clientY - event.clientY);
		if (moved > LONG_PRESS_TOLERANCE) end();
	}

	function onEnd(e: PointerEvent): void {
		if (e.pointerId === pointerId) end();
	}

	const timer = setTimeout(() => {
		end();
		onLift(latest);
	}, LONG_PRESS_DELAY);

	function end(): void {
		if (ended) return;
		ended = true;
		clearTimeout(timer);
		window.removeEventListener("pointermove", onMove, true);
		window.removeEventListener("pointerup", onEnd, true);
		window.removeEventListener("pointercancel", onEnd, true);
	}

	window.addEventListener("pointermove", onMove, true);
	window.addEventListener("pointerup", onEnd, true);
	window.addEventListener("pointercancel", onEnd, true);
	return end;
}
