/**
 * FLIP for the dashboard grid: `measure` the items' positions before the DOM changes, then
 * `play` after it, and each item that moved animates from where it was with a transform. The
 * duration and easing are the theme's motion tokens, which are 0 ms under reduced motion.
 *
 * Items are the container's children with a `data-flip-id`.
 */
export class Flip {
	#before = new Map<string, DOMRect>();
	#running = new Map<string, Animation>();

	/** Record where every item is now (as shown, so an interrupted animation continues). */
	measure(container: HTMLElement | null): void {
		this.#before.clear();
		if (!container) return;
		for (const [id, el] of items(container)) this.#before.set(id, el.getBoundingClientRect());
	}

	/** Animate every item that moved since `measure`, except `skip` (it follows the pointer). */
	play(container: HTMLElement | null, skip: string | null = null): void {
		const before = this.#before;
		if (!container || before.size === 0) return;
		const style = getComputedStyle(container);
		const duration = parseDuration(style.getPropertyValue("--motion-duration-base"));
		const easing = style.getPropertyValue("--motion-ease-standard").trim() || "ease";
		for (const [id, el] of items(container)) {
			this.#running.get(id)?.cancel();
			this.#running.delete(id);
			const from = before.get(id);
			if (!from || id === skip || duration <= 0) continue;
			const to = el.getBoundingClientRect();
			const dx = from.left - to.left;
			const dy = from.top - to.top;
			if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) continue;
			const animation = el.animate(
				[{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "none" }],
				{ duration, easing }
			);
			this.#running.set(id, animation);
			animation.onfinish = () => {
				if (this.#running.get(id) === animation) this.#running.delete(id);
			};
		}
		before.clear();
	}
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
