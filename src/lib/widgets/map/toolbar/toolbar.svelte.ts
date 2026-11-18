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
import { formatMonthName, formatYear } from "$lib/format";
import { m } from "$lib/paraglide/messages.js";
import { mapMessages } from "../host/messages";
import type { MapOptions } from "../options";
import { parsePeriod } from "../use-period";
import {
	basemap,
	clusters,
	fire,
	layers,
	monitors,
	notices,
	regions,
	settings,
	theme,
	use
} from "./icons.svelte";
import {
	groupsShown,
	NOTICES_KEY,
	toValues,
	USE_FIGURE_KEY,
	USE_KEY,
	USE_MONTH_KEY,
	USE_YEAR_KEY,
	type MapOffer
} from "./values";

export type MapToolbarInput = {
	offer: MapOffer;
	/** The pollutant drawn (the saved `showing`, or its fallback). */
	drawn: string | undefined;
	options: MapOptions;
	/** A viewer's toolbar: the owner's values are what Reset puts back (never what's shown). */
	ownerValues?: OptionValues;
	/**
	 * A day stop shows: the Inactive row isn't offered (a monitor with a figure that day was
	 * reporting), so a saved Inactive choice filters nothing there.
	 */
	day?: boolean;
	/** The fill row's label (the region type's plural label), while the tile has a fill. */
	fillLabel?: string;
	/** The spray notices row's label (the catalog's), while the tile has the layer. */
	noticesLabel?: string;
	/** The pesticide use row's label (the catalog's), while the tile has the layer. */
	useLabel?: string;
	/** The catalog's pesticide use figures the map draws: their labels and units. */
	useFigures?: readonly UseFigureInfo[];
	/** The use figure drawn (the saved `useFigure`, or the first). */
	useFigure?: string;
};

/** A pesticide use figure as the toolbar names it (the catalog's label and units). */
export type UseFigureInfo = { id: string; label: string; units: string };

/** The id of the toolbar's Pesticide use group. */
export const USE_GROUP = "pesticide-use";
/** The month select's value for the whole year. */
const WHOLE_YEAR = "all";
const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1);

/** The fill row's value key (option `fillShown`): on by default, so the fill shows. */
export const FILL_KEY = "regions";

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

	build({
		offer,
		drawn,
		options,
		ownerValues,
		day = false,
		fillLabel,
		noticesLabel,
		useLabel,
		useFigures = [],
		useFigure
	}: MapToolbarInput): MapToolbarBuild {
		const forMonitors = this.#monitors.groups({
			types: offer.types,
			pollutants: offer.pollutants,
			pollutant: drawn ?? null,
			hasInactive: offer.hasInactive && !day,
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
		const fill: OptionRow | undefined =
			offer.fill && fillLabel
				? { kind: "checkbox", id: FILL_KEY, label: fillLabel, icon: regions }
				: undefined;
		const noticesRow: OptionRow | undefined =
			offer.notices && noticesLabel
				? { kind: "checkbox", id: NOTICES_KEY, label: noticesLabel, icon: notices }
				: undefined;
		const useOffer = offer.use && useLabel ? offer.use : null;
		const useRow: OptionRow | undefined = useOffer
			? { kind: "checkbox", id: USE_KEY, label: useLabel!, icon: use }
			: undefined;
		const layerRows: OptionRow[] = [];
		if (hms) layerRows.push(hms.row);
		if (fill) layerRows.push(fill);
		if (noticesRow) layerRows.push(noticesRow);
		if (useRow) layerRows.push(useRow);
		const forSettings = settingsGroup(this.#map, {
			icon: settings,
			cluster: CLUSTER,
			clusters: { icon: clusters },
			basemap: { icons: { basemap, theme } }
		});

		const groups: OptionGroup[] = [];
		if (shown.pollutant && pollutantGroup) groups.push(pollutantGroup);
		if (shown.monitors && monitorsGroup) groups.push(monitorsGroup);
		if (shown.layers && layerRows.length) {
			groups.push({
				id: "layers",
				label: mapMessages("mapsdk_options_layers"),
				icon: layers,
				cluster: CLUSTER,
				rows: layerRows
			});
		}
		const period = parsePeriod(options.usePeriod);
		/** The period's year and month as the selects show them: the saved one, else the latest. */
		const periodValues: OptionValues = {};
		if (useOffer) {
			const year = period?.year ?? useOffer.years[0];
			if (year !== undefined) periodValues[USE_YEAR_KEY] = String(year);
			periodValues[USE_MONTH_KEY] = period?.month ? String(period.month) : WHOLE_YEAR;
			const figures = useOffer.figures.flatMap((id) => {
				const info = useFigures.find((f) => f.id === id);
				return info ? [{ value: id, label: info.label, unit: info.units }] : [];
			});
			// A saved year the meta no longer lists stays the one shown (it draws "No data").
			const years = [...useOffer.years];
			if (period && !years.includes(period.year)) years.push(period.year);
			groups.push({
				id: USE_GROUP,
				label: m.map_use_group(),
				icon: use,
				cluster: CLUSTER,
				rows: [
					{ kind: "select", id: USE_FIGURE_KEY, label: m.map_use_figure(), choices: figures },
					{
						kind: "select",
						id: USE_YEAR_KEY,
						label: m.map_use_year(),
						choices: years.map((y) => ({
							value: String(y),
							label: formatYear(`${String(y).padStart(4, "0")}-01-01`)
						}))
					},
					{
						kind: "select",
						id: USE_MONTH_KEY,
						label: m.map_use_month(),
						choices: [
							{ value: WHOLE_YEAR, label: m.map_use_whole_year() },
							...MONTHS.map((n) => ({
								value: String(n),
								label: formatMonthName(`2000-${String(n).padStart(2, "0")}-01`)
							}))
						]
					}
				]
			});
		}
		groups.push(...forSettings.groups);

		const presets: OptionValues = {
			...forMonitors.defaults,
			...forSettings.defaults,
			...hms?.defaults,
			...(fill && { [FILL_KEY]: true }),
			...(noticesRow && { [NOTICES_KEY]: true }),
			...(useRow && {
				[USE_KEY]: true,
				...(useOffer!.figures[0] !== undefined && { [USE_FIGURE_KEY]: useOffer!.figures[0] }),
				...periodValues
			})
		};
		const rows: MapToolbarRows = {
			types: shown.monitors && offered.some((id) => id.startsWith("type:")),
			inactive: shown.monitors && offered.includes("inactive"),
			inside: shown.monitors && offered.includes("inside")
		};
		// The values are the options over the presets' defaults, as the map draws them: a viewer's
		// key held as missing shows the default, not the owner's value. Reset puts back `defaults`,
		// which hold the period shown: the period isn't a Reset key (Reset never changes the data).
		return {
			groups,
			defaults: { ...(ownerValues ?? presets), ...periodValues },
			values: toValues(options, offer, presets, drawn, useOffer ? useFigure : undefined),
			rows
		};
	}
}
