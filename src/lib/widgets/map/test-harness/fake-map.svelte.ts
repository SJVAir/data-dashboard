/* eslint-disable svelte/prefer-svelte-reactivity -- test records the test reads; reactive state uses $state */
/**
 * A stand-in for map-sdk's `createMap` in browser tests (no WebGL, no MapTiler): it records the
 * plugins, selections and camera moves a widget asks for, and its `ready` is set by the test.
 */
export type FakePlugin = {
	id: string;
	kind: "focus" | "monitors";
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
	selections = new Map<string, unknown>();
	/** Every `setSelection` call, in order (`[pluginId, selection]`). */
	selectionCalls: [string, unknown][] = [];
	/** The pinned card's feature (map-sdk's `Hovered`), set by a click on the fake MapView with `card`. */
	pinned = $state.raw<{ hit: { pluginId: string; refKey: string; name: string } } | null>(null);
	camera: CameraCall[] = [];
	destroyed = false;
	/** What the last MapView showing this map was given. */
	view = $state.raw<Record<string, unknown>>({});
	messages = (key: string) => key;

	addPlugin(plugin: FakePlugin, options?: Record<string, unknown>) {
		if (this.plugins.some((p) => p.id === plugin.id)) throw new Error(`duplicate ${plugin.id}`);
		const added = { ...plugin, addOptions: options };
		// Draw order, bottom first: `before` puts it just below that plugin, as map-sdk does.
		const at = options?.before ? this.plugins.findIndex((p) => p.id === options.before) : -1;
		if (options?.before && at < 0) throw new Error(`no plugin ${String(options.before)}`);
		if (at < 0) this.plugins.push(added);
		else this.plugins.splice(at, 0, added);
	}
	removePlugin(id: string) {
		this.plugins = this.plugins.filter((p) => p.id !== id);
	}
	setSelection(id: string, selection: unknown) {
		this.selectionCalls.push([id, selection]);
		this.selections.set(id, selection);
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

type Features = { type: "FeatureCollection"; features: unknown[] } | null;

/** A stand-in for a shared monitors store: the test settles `init` and sets the features. */
export class FakeStore {
	features = $state.raw<Features>(null);
	monitors = $state.raw(new Map<string, unknown>());
	initCalls: string[] = [];
	pauses = 0;
	#settle: { resolve: () => void; reject: (e: unknown) => void } | null = null;
	readonly dataSource;

	constructor(readonly entryType: string) {
		const features = () => this.features;
		this.dataSource = {
			status: { state: "ready" },
			get features() {
				return features();
			},
			scale: { dataset: "air-quality", entryType }
		};
	}

	init(entryType: string): Promise<void> {
		this.initCalls.push(entryType);
		return new Promise((resolve, reject) => (this.#settle = { resolve, reject }));
	}
	/** Finishes the pending `init` with these monitors (`[id, lon, lat]`). */
	load(monitors: [string, number, number][]) {
		this.monitors = new Map(monitors.map(([id]) => [id, { id }]));
		this.features = {
			type: "FeatureCollection",
			features: monitors.map(([id, lon, lat]) => ({
				type: "Feature",
				geometry: { type: "Point", coordinates: [lon, lat] },
				properties: { refKey: `monitor:${id}`, name: id, value: 1 }
			}))
		};
		this.#settle?.resolve();
	}
	fail(error: unknown) {
		this.#settle?.reject(error);
	}
	pauseAutoUpdate() {
		this.pauses++;
	}
}

export const fakeStores = {
	held: new Map<string, FakeStore>(),
	releases: 0,
	reset() {
		this.held = new Map();
		this.releases = 0;
	},
	acquire(entryType: string) {
		let store = this.held.get(entryType);
		if (!store) {
			store = new FakeStore(entryType);
			this.held.set(entryType, store);
		}
		return { store, release: () => this.releases++ };
	}
};
