import type { Feature } from "geojson";
import { getResolvers, placeRegion } from "$lib/data";
import type { Layer } from "$lib/data/schema";
import type { UnavailableReason } from "$lib/data/types";
import { nowInput } from "../shared/input";
import { frameOf, type Frame } from "./framing";
import { regionKey, regionShapes, type RegionRef } from "./regions";

export type FrameState =
	| "idle"
	| "loading"
	| "ready"
	| { unavailable: UnavailableReason }
	| {
			error: unknown;
	  };

/** No shapes. The frame's maps are replaced whole (`$state.raw`), never changed in place. */
const noShapes = (): Map<string, Feature> => new Map();

const isAbort = (e: unknown) => e instanceof DOMException && e.name === "AbortError";

/**
 * A map's frame, kept in step with its layer: what it highlights, outlines, pins and fits, with
 * the region shapes to outline. Each layer change aborts the previous lookups. A frame that
 * can't be completed still holds what's known (its pin, its monitors), so the map still draws.
 */
export class MapFrame {
	frame = $state.raw<Frame | null>(null);
	shapes = $state.raw<Map<string, Feature>>(noShapes());
	state = $state.raw<FrameState>("idle");
	#tries = $state(0);
	#stop: () => void;

	constructor(layer: () => Layer | undefined) {
		this.#stop = $effect.root(() => {
			$effect(() => {
				const current = layer();
				void this.#tries;
				const controller = new AbortController();
				this.#load(current, controller.signal);
				return () => controller.abort();
			});
		});
	}

	destroy(): void {
		this.#stop();
	}

	/** Looks the current layer up again (after an error). */
	retry(): void {
		this.#tries++;
	}

	#set(frame: Frame, shapes: Map<string, Feature>, state: FrameState) {
		this.frame = frame;
		this.shapes = shapes;
		this.state = state;
	}

	#load(layer: Layer | undefined, signal: AbortSignal) {
		const { needs, ...rest } = frameOf(layer);
		const frame: Frame = { ...rest, regions: [], pin: null };
		if (needs.length === 0) {
			this.#set(frame, noShapes(), frame.focus === "none" ? "idle" : "ready");
			return;
		}
		this.state = "loading";
		this.#resolve(frame, needs, signal).then(
			({ frame, shapes, state }) => {
				if (!signal.aborted) this.#set(frame, shapes, state);
			},
			(error: unknown) => {
				if (signal.aborted || isAbort(error)) return;
				this.#set(frame, noShapes(), { error });
			}
		);
	}

	async #resolve(
		frame: Frame,
		needs: ReturnType<typeof frameOf>["needs"],
		signal: AbortSignal
	): Promise<{ frame: Frame; shapes: Map<string, Feature>; state: FrameState }> {
		let regions: RegionRef[] = [];
		let pin: Frame["pin"] = null;
		// A single region (a place, or a point's) must have a shape; a selection needs one.
		let single = false;
		for (const need of needs) {
			if (need.kind === "regions") {
				regions = need.refs;
				single = need.refs.length === 1;
			} else if (need.kind === "location") {
				const found = await getResolvers().locations.resolve(need.source, need.code, signal);
				if (!found?.point) {
					return { frame, shapes: noShapes(), state: { unavailable: "location-unresolved" } };
				}
				const { lat, lon } = found.point;
				pin = { kind: "location", name: found.name, lat, lon };
			} else {
				const place = need.layer.place;
				if (place?.kind === "point") pin = { kind: "point", lat: place.lat, lon: place.lon };
				const input = nowInput(need.layer);
				const region = input ? await placeRegion(input, signal) : null;
				const withPin = { ...frame, pin };
				if (!region) {
					return { frame: withPin, shapes: noShapes(), state: { unavailable: "point-outside" } };
				}
				regions = [region];
				single = true;
			}
		}
		const shapes = regions.length > 0 ? await regionShapes(regions, signal) : noShapes();
		const done: Frame = { ...frame, regions, pin };
		const missing = single
			? regions.some((r) => !shapes.has(regionKey(r)))
			: regions.length > 0 && shapes.size === 0;
		const state: FrameState = missing ? { unavailable: "region-unresolved" } : "ready";
		return { frame: done, shapes, state };
	}
}
