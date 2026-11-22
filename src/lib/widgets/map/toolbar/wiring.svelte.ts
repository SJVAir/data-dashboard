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
	HMS_FIRE,
	HMS_SMOKE,
	MAP_TOOLBAR_KEYS,
	MapOptionsSchema,
	PESTICIDE_NOTICES,
	PESTICIDE_USE,
	mapOptions,
	pollutantLayer,
	useFigureOf,
	type MapOptions
} from "../options";
import {
	FILL_KEY,
	type MapToolbar,
	type MapToolbarBuild,
	type UseFigureInfo
} from "./toolbar.svelte";
import {
	activeFilters,
	isExempt,
	NOTICES_KEY,
	toOptions,
	USE_KEY,
	type MapOffer,
	type MonitorFilters
} from "./values";

/** What the wiring reads from the widget: an object of getters, each read on its own. */
export type MapToolbarWiringInput = {
	readonly widget: WidgetInstance;
	readonly tileOptions: TileOptionsContext | undefined;
	readonly catalog: CatalogEntry[] | undefined;
	/** The pollutants the server's map draws (not known yet: undefined). */
	readonly drawable: readonly string[] | undefined;
	/** The loaded monitors for the pollutant drawn, before the toolbar's filters. */
	readonly monitors: FeatureCollection<Geometry, MonitorFeatureProperties> | null;
	/** The tile's own monitors (its places): never filtered, so they offer no filter rows. */
	readonly exempt: ReadonlySet<string>;
	/** Whether the catalog names both smoke and fire (their rows' and layers' labels). */
	readonly smokeAndFireNamed: boolean;
	/**
	 * The place-less datasets the Map doesn't draw at its resolution (or, for pesticide use, on
	 * Now): their rows aren't offered.
	 */
	readonly notShown: readonly string[];
	/** The map's toolbar presets; null until the map is made. */
	readonly toolbar: MapToolbar | null;
	/** A day stop shows (not now): the toolbar offers no Inactive row. */
	readonly onDay: boolean;
	/**
	 * The fill's region type, as the Layers row names it (its plural label); undefined with no
	 * fill the metadata lists (no row then).
	 */
	readonly fillLabel: string | undefined;
	/** Whether the tile has the spray notices layer. */
	readonly notices: boolean;
	/** The spray notices' label (the catalog's); undefined while unknown (no row then). */
	readonly noticesLabel: string | undefined;
	/** Whether the tile has the pesticide use layer. */
	readonly use: boolean;
	/** The pesticide use label (the catalog's); undefined while unknown (no row then). */
	readonly useLabel: string | undefined;
	/** The catalog's pesticide use figures the map draws, in order. */
	readonly useFigures: readonly UseFigureInfo[];
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
			// The Map holds one pollutant: nothing to save (its group shows only with two or more).
			if (key === "pollutant") return [];
			if (key === FILL_KEY) return ["fillShown"];
			if (key === NOTICES_KEY) return ["noticesShown"];
			if (key === USE_KEY) return ["useShown"];
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
	/** The pesticide use figure drawn now (the saved one, or the catalog's first). Never saved. */
	readonly useFigure = $derived.by(() => useFigureOf(this.options, this.#in.catalog));
	/** The pollutant drawn: the Map's one (none without it). */
	readonly drawn = $derived.by(
		() => pollutantLayer(this.#in.widget.data, this.#in.catalog)?.entryType
	);

	/** What the data offers, as a key: the toolbar is built again only when it changes. */
	readonly #offerKey = $derived.by(() => {
		const { widget, catalog, drawable, notShown } = this.#in;
		const pollutant = pollutantLayer(widget.data, catalog)?.entryType;
		const pollutants = pollutant && drawable?.includes(pollutant) ? [pollutant] : [];
		// Only the monitors a filter could hide give the Monitors group its rows.
		const exempt = this.#in.exempt;
		const features = (this.#in.monitors?.features ?? []).filter(
			(f) => !isExempt(f.properties.refKey, exempt)
		);
		const offer: MapOffer = {
			pollutants,
			types: unique(features.map((f) => f.properties.type)),
			hasInactive: features.some((f) => f.properties.isActive === false),
			hasInside: features.some((f) => f.properties.location === "inside"),
			smokeAndFire:
				hasSmokeAndFire(widget.data) &&
				this.#in.smokeAndFireNamed &&
				!notShown.includes(HMS_SMOKE) &&
				!notShown.includes(HMS_FIRE),
			fill: this.#in.fillLabel !== undefined,
			notices:
				this.#in.notices &&
				this.#in.noticesLabel !== undefined &&
				!notShown.includes(PESTICIDE_NOTICES),
			use: this.#useOffer()
		};
		return JSON.stringify(offer);
	});
	readonly offer = $derived<MapOffer>(JSON.parse(this.#offerKey));

	/** What the use rows offer: the figures; null without the layer, or where it isn't drawn. */
	#useOffer(): MapOffer["use"] {
		const { use, useLabel, useFigures, notShown } = this.#in;
		if (!use || useLabel === undefined || useFigures.length === 0) return null;
		if (notShown.includes(PESTICIDE_USE)) return null;
		return { figures: useFigures.map((f) => f.id) };
	}
	/**
	 * Whether the fill shows: `fillShown: false` hides it only while its row is offered (a saved
	 * value applies only while its row is offered).
	 */
	readonly fillShown = $derived(!(this.offer.fill && this.options.fillShown === false));
	/** Whether the spray notices show: `noticesShown: false` hides them while their row is offered. */
	readonly noticesShown = $derived(!(this.offer.notices && this.options.noticesShown === false));
	/**
	 * Whether pesticide use shows: `useShown: false` hides it (also before its row is offered, so
	 * a hidden use never flashes while the catalog loads).
	 */
	readonly useShown = $derived(this.options.useShown !== false);

	/** The toolbar's groups, values and defaults; null until the map is made. */
	readonly state = $derived.by<MapToolbarState | null>(() => {
		const toolbar = this.#in.toolbar;
		if (!toolbar) return null;
		const offer = this.offer;
		const day = this.#in.onDay;
		const labels = {
			day,
			fillLabel: this.#in.fillLabel,
			noticesLabel: this.#in.noticesLabel,
			useLabel: this.#in.useLabel,
			useFigures: this.#in.useFigures
		};
		if (this.#in.tileOptions?.mode === "view") {
			const saved = this.saved;
			const owner = toolbar.build({
				offer,
				drawn: this.drawn,
				options: saved,
				useFigure: useFigureOf(saved, this.#in.catalog),
				...labels
			});
			const shown = toolbar.build({
				offer,
				drawn: this.drawn,
				options: this.options,
				useFigure: this.useFigure,
				ownerValues: owner.values,
				...labels
			});
			return { ...shown, presetDefaults: owner.defaults, ownerValues: owner.values };
		}
		const shown = toolbar.build({
			offer,
			drawn: this.drawn,
			options: this.options,
			useFigure: this.useFigure,
			...labels
		});
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
			this.offer.use?.figures[0]
		);
		if (!MapOptionsSchema.safeParse(options).success) return;
		const keys = optionKeys(changed);
		if (ctx?.mode !== "view") {
			changeTileOptions(ctx, widget, options, keys);
			return;
		}
		const saved = this.saved;
		const back = keys.filter((key) => sameOption(key, options[key], saved[key]));
		const held = keys.filter((key) => !back.includes(key));
		if (back.length) viewerReset(ctx, widget, back);
		if (held.length) changeTileOptions(ctx, widget, options, held);
	};
}
