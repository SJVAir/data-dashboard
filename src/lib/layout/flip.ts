/**
 * FLIP for the dashboard grid: `measure` the items' boxes before the DOM changes, then `play`
 * after it, and each item that moved animates from where it was with a transform. The one
 * widget being arranged also animates its width and height when it was resized; everything else
 * only slides, so layout work stays on one item. When the column count changed since the last
 * `measure` (the phone breakpoint), nothing animates: every item would. The duration and easing
 * are the theme's motion tokens, which are 0 ms under reduced motion.
 *
 * Items are the container's children with a `data-flip-id`.
 */
export class Flip {
	#before = new Map<string, DOMRect>();
	#running = new Map<string, Animation>();
	/** The column count at the last `measure`. */
	#columns: number | null = null;
	/** The columns changed at this `measure`: the next `play` jumps. */
	#jump = false;

	/**
	 * Record where every item is now (as shown, so an interrupted animation continues), on a
	 * grid of `columns`.
	 */
	measure(container: HTMLElement | null, columns: number): void {
		this.#before.clear();
		this.#jump = this.#columns !== null && this.#columns !== columns;
		this.#columns = columns;
		if (!container) return;
		for (const [id, el] of items(container)) this.#before.set(id, el.getBoundingClientRect());
	}

	/**
	 * Animate every item that moved since `measure`, except `skip` (it follows the pointer);
	 * `sized` (the widget being arranged) also animates a change of size.
	 */
	play(
		container: HTMLElement | null,
		{ skip = null, sized = null }: { skip?: string | null; sized?: string | null } = {}
	): void {
		const before = this.#before;
		if (!container || before.size === 0) return;
		const jump = this.#jump;
		this.#jump = false;
		const { duration, easing } = motion(container);
		for (const [id, el] of items(container)) {
			this.#running.get(id)?.cancel();
			this.#running.delete(id);
			const from = before.get(id);
			if (!from || jump || id === skip || duration <= 0) continue;
			const to = el.getBoundingClientRect();
			const dx = from.left - to.left;
			const dy = from.top - to.top;
			const resized =
				id === sized &&
				(Math.abs(from.width - to.width) >= 0.5 || Math.abs(from.height - to.height) >= 0.5);
			if (!resized && Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) continue;
			const slide = { transform: `translate(${dx}px, ${dy}px)` };
			// A resized item animates its box, not a scale: its content reflows as it goes rather
			// than being stretched.
			const keyframes = resized
				? [
						{ ...slide, width: `${from.width}px`, height: `${from.height}px` },
						{ transform: "none", width: `${to.width}px`, height: `${to.height}px` }
					]
				: [slide, { transform: "none" }];
			const animation = el.animate(keyframes, { duration, easing });
			this.#running.set(id, animation);
			animation.onfinish = () => {
				if (this.#running.get(id) === animation) this.#running.delete(id);
			};
		}
		before.clear();
	}
}

/**
 * Slide `el` from `from` (a box measured before it moved, e.g. where a dragged widget was let
 * go) to where it is now.
 */
export function settle(el: HTMLElement, from: DOMRect): Animation | null {
	if (!el.isConnected) return null;
	const { duration, easing } = motion(el);
	if (duration <= 0) return null;
	const to = el.getBoundingClientRect();
	const dx = from.left - to.left;
	const dy = from.top - to.top;
	if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return null;
	return el.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "none" }], {
		duration,
		easing
	});
}

/**
 * Grow or shrink `el` from `from` (its box before a change, e.g. its grid cell before it went
 * fullscreen) to where it is now, with a translate and a scale. Nothing under reduced motion.
 */
export function flipRect(el: HTMLElement, from: DOMRect): void {
	if (!el.isConnected) return;
	const { duration, easing } = motion(el);
	if (duration <= 0) return;
	const to = el.getBoundingClientRect();
	if (to.width <= 0 || to.height <= 0) return;
	const dx = from.left - to.left;
	const dy = from.top - to.top;
	const sx = from.width / to.width;
	const sy = from.height / to.height;
	const still = Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5;
	if (still && Math.abs(sx - 1) < 0.01 && Math.abs(sy - 1) < 0.01) return;
	el.animate(
		[
			{ transformOrigin: "0 0", transform: `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})` },
			{ transformOrigin: "0 0", transform: "none" }
		],
		{ duration, easing }
	);
}

/** The theme's base motion, as read at `el` (0 ms under reduced motion). */
function motion(el: Element): { duration: number; easing: string } {
	const style = getComputedStyle(el);
	return {
		duration: parseDuration(style.getPropertyValue("--motion-duration-base")),
		easing: style.getPropertyValue("--motion-ease-standard").trim() || "ease"
	};
}

function* items(container: HTMLElement): Generator<[string, HTMLElement]> {
	for (const el of container.children) {
		const id = (el as HTMLElement).dataset.flipId;
		if (id) yield [id, el as HTMLElement];
	}
}

/** A CSS time ("200ms", "0.2s") in milliseconds; 0 when it can't be read. */
export function parseDuration(value: string): number {
	const v = value.trim();
	const n = parseFloat(v);
	if (!Number.isFinite(n)) return 0;
	return v.endsWith("ms") ? n : v.endsWith("s") ? n * 1000 : n;
}
