/* eslint-disable svelte/prefer-svelte-reactivity -- test records the test reads; reactive state uses $state */
import {
	applyPick,
	toggleInSelection,
	type FeatureRef,
	type SelectionMode,
	type SpatialSelection
} from "@sjvair/map-sdk/data";
import type { OptionGroup, OptionValues } from "@sjvair/map-sdk";
import { mapMessages } from "../host/messages";
/**
 * A stand-in for map-sdk's `createMap` in browser tests (no WebGL, no MapTiler): it records the
 * plugins, selections and camera moves a widget asks for, and its `ready` is set by the test.
 */
export type FakePlugin = {
	id: string;
	kind: string;
	options: Record<string, unknown>;
	addOptions?: Record<string, unknown>;
};

export type CameraCall =
	{ kind: "fitBounds"; bounds: unknown; options: unknown } | { kind: "easeTo"; target: unknown };

/** The attached GL map's stand-in: only what the widget touches (its context-lost listener). */
export class FakeGl {
	readonly id = crypto.randomUUID();
	listeners = new Map<string, Set<(e: unknown) => void>>();
	on(type: string, listener: (e: unknown) => void) {
		if (!this.listeners.has(type)) this.listeners.set(type, new Set());
		this.listeners.get(type)!.add(listener);
	}
	off(type: string, listener: (e: unknown) => void) {
		this.listeners.get(type)?.delete(listener);
	}
	fire(type: string) {
		for (const l of [...(this.listeners.get(type) ?? [])]) l({ type });
	}
}

const ENTRY_LABELS: Record<string, string> = { pm25: "PM2.5", o3: "Ozone" };

export class FakeBasemap {
	readonly styles = [
		{ id: "streets-v4", basemap: "Streets", isDefault: true },
		{ id: "satellite", basemap: "Satellite" }
	];
	readonly defaultId = "streets-v4";
	current = $state("streets-v4");
	/** Every `select` call, in order. */
	selected: string[] = [];
	select(id: string) {
		this.selected.push(id);
		this.current = id;
	}
}

export class FakeMap {
	#ready = $state(false);
	/** Attached to a GL map. Set by the test; setting `ready` attaches too (map-sdk: ready implies attached). */
	attached = $state(false);
	get ready(): boolean {
		return this.#ready;
	}
	set ready(value: boolean) {
		this.#ready = value;
		if (value) this.attached = true;
	}
	/** The attached GL map (`maptilerMap`), null while detached. */
	gl = $state.raw<FakeGl | null>(null);
	uid = crypto.randomUUID();
	plugins: FakePlugin[] = [];
	/** Each plugin's selection, as map-sdk holds it. Reactive, for the card's `selected`. */
	selections = $state<Record<string, SpatialSelection | null>>({});
	/** Every `setSelection` call, in order (`[pluginId, selection]`). */
	selectionCalls: [string, unknown][] = [];
	/** The pinned card's feature (map-sdk's `Hovered`), set by a click on the fake MapView with `card`. */
	pinned = $state.raw<{ hit: { pluginId: string; refKey: string; name: string } } | null>(null);
	camera: CameraCall[] = [];
	destroyed = false;
	/** What the last MapView showing this map was given. */
	view = $state.raw<Record<string, unknown>>({});
	/** The host's messages, as `createMap` was given them. */
	messages = mapMessages;
	/** The metadata the toolbar's presets ask: labels only (every type reports every pollutant). */
	metadata = {
		entryType: async ({ entryType }: { entryType: string }) => ({
			label: ENTRY_LABELS[entryType] ?? entryType,
			units: ""
		}),
		monitorTypeLabel: async (type: string) => type,
		scale: async () => "unavailable"
	};
	/** map-sdk's basemap state: two basemaps, the first the default; `select` is recorded. */
	basemap = new FakeBasemap();

	addPlugin(plugin: FakePlugin, options?: Record<string, unknown>) {
		if (this.plugins.some((p) => p.id === plugin.id)) throw new Error(`duplicate ${plugin.id}`);
		const added = { ...plugin, addOptions: options };
		// Draw order, bottom first: `before` puts it just below that plugin, as map-sdk does.
		const at = options?.before ? this.plugins.findIndex((p) => p.id === options.before) : -1;
		if (options?.before && at < 0) throw new Error(`no plugin ${String(options.before)}`);
		if (at < 0) this.plugins.push(added);
		else this.plugins.splice(at, 0, added);
		this.selections[plugin.id] = (options?.selection as SpatialSelection | undefined) ?? null;
	}
	removePlugin(id: string) {
		this.plugins = this.plugins.filter((p) => p.id !== id);
		delete this.selections[id];
	}
	setSelection(id: string, selection: SpatialSelection | null) {
		this.selectionCalls.push([id, selection]);
		this.selections[id] = selection;
	}
	getSelection(id: string): SpatialSelection | null {
		return this.selections[id] ?? null;
	}
	getSelectionMode(id: string): SelectionMode {
		const plugin = this.plugins.find((p) => p.id === id);
		if (!plugin) return "none";
		return (plugin.addOptions?.selectionMode as SelectionMode | undefined) ?? "single";
	}
	getPickWith(id: string): "click" | "modifier" {
		const plugin = this.plugins.find((p) => p.id === id);
		return plugin?.addOptions?.pickWith === "modifier" ? "modifier" : "click";
	}
	/** The latest refused pick's message, as map-sdk's `notice`. */
	notice = $state.raw<{ message: string; id: number } | null>(null);
	#notices = 0;
	/** A user's pick that would give `next`: map-sdk's `canSelect`, then `onselectionchange`. */
	#userPick(id: string, ref: FeatureRef, next: SpatialSelection | null) {
		const options = this.plugins.find((p) => p.id === id)?.addOptions ?? {};
		const canSelect = options.canSelect as
			((n: SpatialSelection | null, r: FeatureRef) => true | string) | undefined;
		const verdict = canSelect ? canSelect(next, ref) : true;
		if (verdict !== true) {
			this.notice = { message: verdict, id: ++this.#notices };
			return;
		}
		this.notice = null;
		this.selections[id] = next;
		(options.onselectionchange as ((s: SpatialSelection | null) => void) | undefined)?.(next);
	}
	/** map-sdk's `togglePick` (the card's Select/Remove). */
	togglePick(id: string, ref: FeatureRef) {
		const mode = this.getSelectionMode(id);
		if (mode === "none" || ref.kind === "feature") return;
		this.#userPick(id, ref, toggleInSelection(this.getSelection(id), ref, mode));
	}
	/** A Shift-click on a feature: a toggle for `"modifier"` plugins, nothing on the map otherwise. */
	shiftClick(id: string, ref: FeatureRef) {
		if (this.getPickWith(id) === "modifier") this.togglePick(id, ref);
	}
	/** Shift+Enter on a feature-list row: a toggle for `"modifier"` plugins, else an additive pick. */
	listShiftEnter(id: string, ref: FeatureRef) {
		if (this.getPickWith(id) === "modifier") return this.togglePick(id, ref);
		const mode = this.getSelectionMode(id);
		if (mode === "none" || ref.kind === "feature") return;
		this.#userPick(id, ref, applyPick(this.getSelection(id), ref, mode, { additive: true }));
	}
	unpin() {
		this.pinned = null;
	}
	fitBounds(bounds: unknown, options: unknown) {
		this.camera.push({ kind: "fitBounds", bounds, options });
	}
	easeTo(target: unknown) {
		this.camera.push({ kind: "easeTo", target });
	}
	destroy() {
		this.destroyed = true;
	}
}

/** The `--mapsdk-toolbar-height` the fake MapView sets when it has a toolbar. */
export const FAKE_TOOLBAR_HEIGHT = 44;

/** What the last fake `OptionsToolbar` was given. */
export const fakeToolbars = {
	last: null as null | {
		groups: OptionGroup[];
		values: OptionValues;
		defaults?: OptionValues;
		basemapKey?: string;
		readonly?: boolean;
	},
	reset() {
		this.last = null;
	}
};

export const fakeMaps = {
	made: [] as FakeMap[],
	/** Makes the next `createMap` throw. */
	fail: false,
	/** Makes the next MapView fail to make its GL map (no WebGL). */
	failView: false,
	reset() {
		this.made = [];
		this.fail = false;
		this.failView = false;
	},
	get last(): FakeMap {
		const map = this.made.at(-1);
		if (!map) throw new Error("no map made");
		return map;
	}
};

export function createFakeMap(): FakeMap {
	if (fakeMaps.fail) {
		fakeMaps.fail = false;
		throw new Error("WebGL unavailable");
	}
	const map = new FakeMap();
	fakeMaps.made.push(map);
	return map;
}
