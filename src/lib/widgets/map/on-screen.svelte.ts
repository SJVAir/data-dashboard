import { untrack } from "svelte";
import type { ActivitySource } from "$lib/platform/types";

/**
 * Whether an element is worth a live map: the page is visible and the element is on screen
 * (within `rootMargin`). `active` turns true at once and false only after `detachDelayMs`, so
 * scrolling past a map doesn't tear down and rebuild its WebGL context.
 */
export class OnScreen {
	active = $state(false);
	#stop: () => void;

	constructor(
		el: () => Element | undefined,
		opts: { activity: ActivitySource; detachDelayMs?: number; rootMargin?: string }
	) {
		const delay = opts.detachDelayMs ?? 5000;
		const rootMargin = opts.rootMargin ?? "200px";
		const { activity } = opts;
		let visible = $state(activity.visible());
		let intersecting = $state(false);
		this.#stop = $effect.root(() => {
			$effect(() => {
				const target = el();
				if (!target) return;
				const observer = new IntersectionObserver(
					(entries) => {
						const last = entries.at(-1);
						if (last) intersecting = last.isIntersecting;
					},
					{ rootMargin }
				);
				observer.observe(target);
				return () => {
					observer.disconnect();
					intersecting = false;
				};
			});
			$effect(() => activity.onChange((v) => (visible = v)));
			$effect(() => {
				if (visible && intersecting) {
					this.active = true;
					return;
				}
				if (!untrack(() => this.active)) return;
				const timer = setTimeout(() => (this.active = false), delay);
				return () => clearTimeout(timer);
			});
		});
	}

	destroy(): void {
		this.#stop();
	}
}
