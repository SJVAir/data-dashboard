import {
	hmsOptions,
	monitorsOptions,
	settingsGroup,
	type MapContext,
	type MonitorsOptions,
	type OptionGroup,
	type OptionRow,
	type OptionValues
} from "@sjvair/map-sdk";
import { mapMessages } from "../host/messages";
import type { MapOptions } from "../options";
import { basemap, clusters, fire, layers, monitors, settings, theme } from "./icons.svelte";
import { groupsShown, toValues, type MapOffer } from "./values";

export type MapToolbarInput = {
	offer: MapOffer;
	/** The pollutant drawn (the saved `showing`, or its fallback). */
	drawn: string | undefined;
	options: MapOptions;
	/** A viewer's toolbar: the owner's values are what Reset puts back (never what's shown). */
	ownerValues?: OptionValues;
};

/** Which monitor filter rows the toolbar offers (a row not offered filters nothing). */
export type MapToolbarRows = { types: boolean; inactive: boolean; inside: boolean };

export type MapToolbarBuild = {
	groups: OptionGroup[];
	defaults: OptionValues;
	values: OptionValues;
	rows: MapToolbarRows;
};

const CLUSTER = "options";

/** The checkbox rows a group offers: its own and those under its headings. */
function checkboxIds(rows: OptionRow[]): string[] {
	return rows.flatMap((row) =>
		row.kind === "checkbox" ? [row.id] : row.kind === "group" ? row.children.map((c) => c.id) : []
	);
}

/**
 * The Map tile's toolbar groups, from map-sdk's presets. Make one per map (it holds the monitors
 * preset, which keeps the metadata's answers); call `build` in a `$derived`.
 */
export class MapToolbar {
	readonly #map: MapContext;
	readonly #monitors: MonitorsOptions;

	constructor(map: MapContext) {
		this.#map = map;
		this.#monitors = monitorsOptions(map);
	}

	build({ offer, drawn, options, ownerValues }: MapToolbarInput): MapToolbarBuild {
		const forMonitors = this.#monitors.groups({
			types: offer.types,
			pollutants: offer.pollutants,
			pollutant: drawn ?? null,
			hasInactive: offer.hasInactive,
			hasInside: offer.hasInside,
			collocation: false,
			icons: { monitors },
			cluster: CLUSTER
		});
		const pollutantGroup = forMonitors.groups.find((g) => g.id === "pollutant");
		const monitorsGroup = forMonitors.groups.find((g) => g.id === "monitors");
		const offered = checkboxIds(monitorsGroup?.rows ?? []);
		const shown = groupsShown(offer, offered.length);

		const hms = offer.smokeAndFire ? hmsOptions(this.#map, { icon: fire }) : undefined;
		const forSettings = settingsGroup(this.#map, {
			icon: settings,
			cluster: CLUSTER,
			clusters: { icon: clusters },
			basemap: { icons: { basemap, theme } }
		});

		const groups: OptionGroup[] = [];
		if (shown.pollutant && pollutantGroup) groups.push(pollutantGroup);
		if (shown.monitors && monitorsGroup) groups.push(monitorsGroup);
		if (shown.layers && hms) {
			groups.push({
				id: "layers",
				label: mapMessages("mapsdk_options_layers"),
				icon: layers,
				cluster: CLUSTER,
				rows: [hms.row]
			});
		}
		groups.push(...forSettings.groups);

		const presets: OptionValues = {
			...forMonitors.defaults,
			...forSettings.defaults,
			...hms?.defaults
		};
		const rows: MapToolbarRows = {
			types: shown.monitors && offered.some((id) => id.startsWith("type:")),
			inactive: shown.monitors && offered.includes("inactive"),
			inside: shown.monitors && offered.includes("inside")
		};
		// The values are the options over the presets' defaults, as the map draws them: a viewer's
		// key held as missing shows the default, not the owner's value. Reset puts back `defaults`.
		return {
			groups,
			defaults: ownerValues ?? presets,
			values: toValues(options, offer, presets, drawn),
			rows
		};
	}
}
