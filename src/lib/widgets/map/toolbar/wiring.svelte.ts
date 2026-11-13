import type { OptionValues } from "@sjvair/map-sdk";
import type { MonitorFeatureProperties } from "@sjvair/map-sdk/data";
import type { FeatureCollection, Geometry } from "geojson";
import type { CatalogEntry } from "$lib/data/metadata";
import type { WidgetInstance } from "$lib/documents/schema";
import { hasSmokeAndFire } from "$lib/get-data/map";
import {
	changeTileOptions,
	tileOptions,
	viewerReset,
	type TileOptionsContext
} from "../../shared/tile-options.svelte";
import {
	MAP_TOOLBAR_KEYS,
	MapOptionsSchema,
	drawableShowing,
	mapOptions,
	pollutantLayers,
	type MapOptions
} from "../options";
import type { MapToolbar, MapToolbarBuild } from "./toolbar.svelte";
import { activeFilters, toOptions, type MapOffer, type MonitorFilters } from "./values";

/** What the wiring reads from the widget: an object of getters, each read on its own. */
export type MapToolbarWiringInput = {
	readonly widget: WidgetInstance;
	readonly tileOptions: TileOptionsContext | undefined;
	readonly catalog: CatalogEntry[] | undefined;
	/** The pollutants the server's map draws (not known yet: undefined). */
	readonly drawable: readonly string[] | undefined;
	/** The loaded monitors for the pollutant drawn, before the toolbar's filters. */
	readonly monitors: FeatureCollection<Geometry, MonitorFeatureProperties> | null;
	/** Whether the catalog names both smoke and fire (their rows' and layers' labels). */
	readonly smokeAndFireNamed: boolean;
	/** The map's toolbar presets; null until the map is made. */
	readonly toolbar: MapToolbar | null;
};

export type MapToolbarState = MapToolbarBuild & {
	/** The presets' defaults: a choice equal to one is stored as missing. */
	presetDefaults: OptionValues;
	/** A viewer's toolbar: the owner's values (what Reset puts back). */
	ownerValues: OptionValues | undefined;
};

const TYPE_PREFIX = "type:";

/** `values` without repeats, in order. */
const unique = <T>(values: T[]): T[] => values.filter((v, i) => values.indexOf(v) === i);

/** The option keys the toolbar's changed value keys write. */
function optionKeys(changed: string[]): (keyof MapOptions)[] {
	return unique(
		changed.flatMap((key): (keyof MapOptions)[] => {
			if (key === "pollutant") return ["showing"];
			if (key.startsWith(TYPE_PREFIX)) return ["hiddenTypes"];
			return (MAP_TOOLBAR_KEYS as readonly string[]).includes(key) ? [key as keyof MapOptions] : [];
		})
	);
}

/** Whether two option values are one (the hidden types in any order). */
function sameOption(key: keyof MapOptions, a: unknown, b: unknown): boolean {
	if (key === "hiddenTypes") {
		const x = [...((a as string[] | undefined) ?? [])].sort();
		const y = [...((b as string[] | undefined) ?? [])].sort();
		return x.length === y.length && x.every((v, i) => v === y[i]);
	}
	return a === b;
}

/**
 * The Map tile's toolbar, wired to its options: what it shows (the saved options, with a viewer's
 * held keys over), what it offers (from the unfiltered monitors), the filters it puts on the
 * monitors, and where its changes go (saved with undo; a viewer's held for the visit).
 */
export class MapToolbarWiring {
	readonly #in: MapToolbarWiringInput;

	constructor(input: MapToolbarWiringInput) {
		this.#in = input;
	}

	/** The owner's options, as saved. */
	readonly saved = $derived.by(() => mapOptions(this.#in.widget));
	/** The options the tile shows: the saved ones, with a viewer's held keys over. */
	readonly options = $derived.by(() =>
		this.#in.tileOptions
			? mapOptions({ options: tileOptions(this.#in.tileOptions, this.#in.widget) })
			: this.saved
	);
	/** The pollutant drawn now (the one showing, or its fallback). Never saved. */
	readonly drawn = $derived.by(() =>
		drawableShowing(this.#in.widget.data, this.options, this.#in.catalog, this.#in.drawable)
	);

	/** What the data offers, as a key: the toolbar is built again only when it changes. */
	readonly #offerKey = $derived.by(() => {
		const { widget, catalog, drawable } = this.#in;
		const pollutants = pollutantLayers(widget.data, catalog).flatMap((l) =>
			l.entryType && drawable?.includes(l.entryType) ? [l.entryType] : []
		);
		const features = this.#in.monitors?.features ?? [];
		const offer: MapOffer = {
			pollutants: unique(pollutants),
			types: unique(features.map((f) => f.properties.type)),
			hasInactive: features.some((f) => f.properties.isActive === false),
			hasInside: features.some((f) => f.properties.location === "inside"),
			smokeAndFire: hasSmokeAndFire(widget.data) && this.#in.smokeAndFireNamed
		};
		return JSON.stringify(offer);
	});
	readonly offer = $derived<MapOffer>(JSON.parse(this.#offerKey));

	/** The toolbar's groups, values and defaults; null until the map is made. */
	readonly state = $derived.by<MapToolbarState | null>(() => {
		const toolbar = this.#in.toolbar;
		if (!toolbar) return null;
		const offer = this.offer;
		if (this.#in.tileOptions?.mode === "view") {
			const { widget, catalog, drawable } = this.#in;
			const saved = this.saved;
			const drawn = drawableShowing(widget.data, saved, catalog, drawable);
			const owner = toolbar.build({ offer, drawn, options: saved });
			const shown = toolbar.build({
				offer,
				drawn: this.drawn,
				options: this.options,
				ownerValues: owner.values
			});
			return { ...shown, presetDefaults: owner.defaults, ownerValues: owner.values };
		}
		const shown = toolbar.build({ offer, drawn: this.drawn, options: this.options });
		return { ...shown, presetDefaults: shown.defaults, ownerValues: undefined };
	});

	/** The filters, as a key: the monitors are filtered again only when they change. */
	readonly #filtersKey = $derived.by(() => {
		const state = this.state;
		if (!state) return null;
		const f = activeFilters(this.options, this.offer, state.rows, state.presetDefaults);
		return JSON.stringify([[...f.hiddenTypes].sort(), f.hideInactive, f.hideInside]);
	});
	/** What the monitors are filtered by now; null (nothing) until the toolbar is built. */
	readonly filters = $derived.by<MonitorFilters | null>(() => {
		if (this.#filtersKey === null) return null;
		const [hiddenTypes, hideInactive, hideInside] = JSON.parse(this.#filtersKey) as [
			string[],
			boolean,
			boolean
		];
		// A value, not state: replaced whole when the filters change.
		// eslint-disable-next-line svelte/prefer-svelte-reactivity
		return { hiddenTypes: new Set(hiddenTypes), hideInactive, hideInside };
	});

	/**
	 * The toolbar's `onchange`: the options after the change, saved (one undo step; a Reset is
	 * one too) or, for a viewer, held. A viewer's key back at the owner's value is forgotten.
	 */
	readonly onchange = (next: OptionValues, changed: string[]): void => {
		const state = this.state;
		if (!state) return;
		const { widget, tileOptions: ctx } = this.#in;
		const options = toOptions(
			this.options,
			next,
			changed,
			state.presetDefaults,
			this.offer.pollutants[0]
		);
		if (!MapOptionsSchema.safeParse(options).success) return;
		const keys = optionKeys(changed);
		if (ctx?.mode !== "view") {
			changeTileOptions(ctx, widget, options, keys);
			return;
		}
		const saved = this.saved;
		const { data } = widget;
		const { catalog, drawable } = this.#in;
		// The pollutant is back when the one drawn is the owner's (a saved `showing` equal to the
		// first pollutant is stored as missing here, so the options alone would differ).
		const drawnOf = (o: MapOptions) => drawableShowing(data, o, catalog, drawable);
		const back = keys.filter((key) =>
			key === "showing"
				? drawnOf(options) === drawnOf(saved)
				: sameOption(key, options[key], saved[key])
		);
		const held = keys.filter((key) => !back.includes(key));
		if (back.length) viewerReset(ctx, widget, back);
		if (held.length) changeTileOptions(ctx, widget, options, held);
	};
}
