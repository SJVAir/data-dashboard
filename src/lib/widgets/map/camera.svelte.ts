import type { MapContext } from "@sjvair/map-sdk";
import { ancestorAnimationsSettled } from "$lib/charts/settled";
import type { FitTarget } from "./framing";

const FIT_PADDING = 32;

const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

/** What the camera reads from the tile; each field read on its own. */
export interface CameraInput {
	readonly map: MapContext | null;
	/** The places' fit; null leaves the camera where it is. */
	readonly target: FitTarget;
	readonly fullscreen: boolean;
	/** The widget's body, whose ancestors' animations settle before a fit. */
	readonly body: HTMLElement | undefined;
}

/**
 * The camera: fitted to the places on each change and on each (re-)attach, never saved. Call it
 * while a component initialises (it adds an effect).
 */
export function fitCamera(input: CameraInput): void {
	/**
	 * What was last fitted, and in which size (fullscreen or not), while attached. Reset on detach,
	 * so re-attaching refits; a style reload (ready false while still attached) keeps it, so the
	 * person's pan survives a basemap or theme change.
	 */
	let fitted: string | null = null;

	$effect(() => {
		const current = input.map;
		const t = input.target;
		const big = input.fullscreen;
		if (!current?.attached) {
			fitted = null;
			return;
		}
		if (!current.ready) return;
		// A null target leaves the camera where it is (the Valley's view on opening).
		if (!t) return;
		// Entering or leaving fullscreen refits too: the same map, in another size.
		const key = JSON.stringify([t, big]);
		if (key === fitted) return;
		fitted = key;
		const el = input.body;
		void (el ? ancestorAnimationsSettled(el) : Promise.resolve()).then(async () => {
			// MapLibre takes its container's new size in a ResizeObserver, which runs after the
			// next frame's animation callbacks: fit after that, at the size the map now has.
			await nextFrame();
			await nextFrame();
			if (fitted !== key || !current.ready) return;
			if ("bbox" in t) {
				const [west, south, east, north] = t.bbox;
				current.fitBounds({ west, south, east, north }, { padding: FIT_PADDING });
			} else {
				current.easeTo({ center: t.center, minZoom: t.minZoom });
			}
		});
	});
}
