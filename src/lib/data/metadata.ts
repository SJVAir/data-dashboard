import {
	getCalHeatScoreMeta,
	getDatasetCatalog,
	getForecastsMeta,
	getHMSMeta,
	getMonitorsList,
	getMonitorsMeta,
	getRegionsMeta,
	type DatasetCatalog,
	type MonitorGroup,
	type SchoolGuidelines,
	type Retired
} from "@sjvair/sdk";
import type { Resolution } from "./schema";

export type Retirement = { since: string; replacedBy?: string };

export type EntryTypeMeta = {
	id: string;
	label: string;
	units: string;
	kind: "pollutant" | "meteorological" | "other";
	resolutions: Resolution[];
	/** Decimal places to show a value with (the catalog's `display.precision`); null: unspecified. */
	precision: number | null;
	/** Where a chart's value axis starts (the catalog's `display.y_min`); null: unspecified. */
	yMin: number | null;
	/** Bars or a line (the catalog's `display.chart`); null: unspecified or unknown. */
	chart: "line" | "bar" | null;
	/**
	 * How values combine over time (the catalog's top-level `aggregate`): `"sum"` totals,
	 * `"mean"` averages, `null` never rolls up.
	 */
	aggregate: "sum" | "mean" | null;
	available?: boolean;
	retired?: Retirement;
};

/** The ARCHITECTURE.md catalog entry; the descriptive fields are optional here. */
export type CatalogEntry = {
	id: string;
	label: string;
	description?: string;
	source?: string;
	license?: string;
	entryTypes: EntryTypeMeta[];
	geographies: string[];
	metaUrl?: string;
	retired?: Retirement;
};

export type Level = {
	key: string;
	label: string;
	color: string | null;
	opacity: number | null;
	tier: number | null;
	/** Advice that goes with the level; `""` when the server has none. */
	guidance: string;
	/** What the level means; `""` when the server has none. */
	description: string;
	/** A missing min is 0. */
	min: number;
	/** `null` is an open top. */
	max: number | null;
	/** A category level's raw value (forecasts' burn status); its `min` is 0 and `max` open. */
	value?: string;
};

/** The level whose `[min, max)` holds `value` (the last level's `max` may be open). */
export function levelFor(levels: Level[], value: number): Level | undefined {
	return levels.find((l) => value >= l.min && (l.max === null || value < l.max));
}

export type MonitorSummary = {
	id: string;
	name: string;
	type: string;
	/** The monitor's county; empty when the server has none. */
	county: string;
	active: boolean;
	/** An indoor monitor (the list's `location` is `"inside"`). */
	inside: boolean;
};

export type MonitorTypeInfo = {
	type: string;
	label: string;
	entryTypes: string[];
	/** The key of the monitor group it is listed under; `null` for none. */
	group: string | null;
	/** The entry types the map publishes for this type. */
	published: string[];
};

/** The summary field that colors a day, with its label; `label` is `null` when the server has none. */
export type DailyFigure = { field: string; label: string | null };

export interface MetadataSource {
	/** `"unavailable"` when the server has no catalog or it can't be fetched; never rejects except for `signal`'s abort. */
	catalog(signal?: AbortSignal): Promise<CatalogEntry[] | "unavailable">;
	/** From the entry type's scale, ordered by min; `[]` if no scale. */
	levels(entryType: string, signal?: AbortSignal): Promise<Level[]>;
	/**
	 * The levels of a dataset's entry type: the forecasts scales for `"forecasts"`, the HMS
	 * scales for `"hms-smoke"`, the CalHeatScore scales for `"calheatscore"`, otherwise the same as `levels`. `[]` if no scale.
	 */
	datasetLevels(dataset: string, entryType: string, signal?: AbortSignal): Promise<Level[]>;
	/**
	 * The server's raw scale for a dataset's entry type, as the meta serves it: routes like
	 * `datasetLevels` (and `"hms-fire"` to the HMS meta too), otherwise the monitors meta's.
	 * `null` when there is none.
	 */
	serverScale(dataset: string, entryType: string, signal?: AbortSignal): Promise<unknown | null>;
	/** How often a monitor type reports (the monitors meta's `expected_interval`); `null` when it has none. */
	monitorTypeInterval(type: string, signal?: AbortSignal): Promise<string | null>;
	/** The meta's `default_calibration`; `""` and unknown map to `null`. */
	defaultProcessor(
		monitorType: string,
		entryType: string,
		signal?: AbortSignal
	): Promise<string | null>;
	/** The entry type's school activity guidelines (PM2.5 only); `null` when it has none. */
	schoolGuidelines(entryType: string, signal?: AbortSignal): Promise<SchoolGuidelines | null>;
	/**
	 * Where a scale's breakpoints come from; `dataset` routes like `datasetLevels`. `null` when
	 * the scale has no source.
	 */
	scaleSource(
		dataset: string,
		entryType: string,
		signal?: AbortSignal
	): Promise<{ name: string; url: string } | null>;
	/**
	 * How the server evaluates an entry type on a monitor type for alerts (the meta's `alerts`
	 * block); `null` when the pair isn't evaluated. The interval falls back to the monitor type's.
	 */
	alertConfig(
		monitorType: string,
		entryType: string,
		signal?: AbortSignal
	): Promise<{ windowMinutes: number; expectedIntervalMinutes: number | null } | null>;
	/** The entry type's daily figure (`scale.daily_statistic`); `null` when it has none. */
	dailyFigure(entryType: string, signal?: AbortSignal): Promise<DailyFigure | null>;
	/**
	 * The monitors meta's `available_pollutants`, in server order; `[]` when it lists none, and
	 * `"unavailable"` when it can't be loaded. Never rejects except for `signal`'s abort.
	 */
	mapPollutants(signal?: AbortSignal): Promise<string[] | "unavailable">;
	monitorType(monitorId: string, signal?: AbortSignal): Promise<string | null>;
	monitors(signal?: AbortSignal): Promise<MonitorSummary[]>;
	/** The monitor types (networks) with their labels and the entry types each can supply. */
	monitorTypes(signal?: AbortSignal): Promise<MonitorTypeInfo[]>;
	/** The monitor groups (Reference-grade, Low-cost sensors) sorted by `order`; `[]` when none. */
	monitorGroups(signal?: AbortSignal): Promise<MonitorGroup[]>;
	/** The monitors meta's help text for an entry type; `null` when it has none. */
	entryTypeHelp(entryType: string, signal?: AbortSignal): Promise<string | null>;
	/** The regions meta's label for a location type; `null` when unknown. */
	locationTypeLabel(type: string, signal?: AbortSignal): Promise<string | null>;
}

const UNIT_MINUTES: Record<string, number> = {
	s: 1 / 60,
	sec: 1 / 60,
	second: 1 / 60,
	seconds: 1 / 60,
	m: 1,
	min: 1,
	mins: 1,
	minute: 1,
	minutes: 1,
	h: 60,
	hr: 60,
	hrs: 60,
	hour: 60,
	hours: 60,
	d: 1440,
	day: 1440,
	days: 1440
};

/** A meta duration ("60 min", "1h", "1 hour") in minutes; `null` when it isn't one. */
export function parseMinutes(text: string | null | undefined): number | null {
	const match = /^\s*(\d+(?:\.\d+)?)\s*([a-z]+)\s*$/i.exec(text ?? "");
	if (!match) return null;
	const unit = UNIT_MINUTES[match[2].toLowerCase()];
	const minutes = unit === undefined ? NaN : Number(match[1]) * unit;
	return minutes > 0 ? minutes : null;
}

function abortError(): Error {
	return new DOMException("The operation was aborted.", "AbortError");
}

/** Resolve with `promise`, or reject early if `signal` aborts (without touching `promise`). */
export function untilAborted<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
	if (!signal) return promise;
	if (signal.aborted) return Promise.reject(abortError());
	return new Promise<T>((resolve, reject) => {
		const onAbort = () => reject(abortError());
		signal.addEventListener("abort", onAbort, { once: true });
		promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
	});
}

/**
 * Fetch once, share the result, and forget failures so the next call retries. The shared fetch
 * carries no caller signal, so one caller's abort cannot reject it for the others.
 */
function memoize<T>(fetch: () => Promise<T>): (signal?: AbortSignal) => Promise<T> {
	let cached: Promise<T> | undefined;
	return (signal) => {
		if (!cached) {
			const p = fetch();
			cached = p;
			p.catch(() => {
				if (cached === p) cached = undefined;
			});
		}
		return untilAborted(cached, signal);
	};
}

const RESOLUTIONS: readonly Resolution[] = [
	"raw",
	"hour",
	"day",
	"month",
	"quarter",
	"season",
	"year"
];
const KINDS: readonly EntryTypeMeta["kind"][] = ["pollutant", "meteorological", "other"];

function retirement(retired: Retired | null | undefined): Retirement | undefined {
	if (!retired) return undefined;
	return retired.replaced_by
		? { since: retired.since, replacedBy: retired.replaced_by }
		: { since: retired.since };
}

/** Copies `value` into `target[key]` unless it's empty (the catalog's "none"). */
function setIfPresent<T, K extends keyof T>(
	target: T,
	key: K,
	value: T[K] | "" | null | undefined
) {
	if (value !== undefined && value !== null && value !== "") target[key] = value as T[K];
}

/**
 * The server's dataset catalog in the dashboard's shape. Unknown kinds become `"other"` and
 * unknown resolutions are dropped (both need client logic); unknown geographies stay as strings.
 * Empty descriptive strings are left out.
 */
export function mapDatasetCatalog(catalog: DatasetCatalog): CatalogEntry[] {
	return catalog.datasets.map((d) => {
		const entry: CatalogEntry = {
			id: d.id,
			label: d.label,
			geographies: [...d.geographies],
			entryTypes: d.entry_types.map((e) => {
				const type: EntryTypeMeta = {
					id: e.id,
					label: e.label,
					units: e.units,
					kind: (KINDS as readonly string[]).includes(e.kind)
						? (e.kind as EntryTypeMeta["kind"])
						: "other",
					resolutions: e.resolutions.filter((r): r is Resolution => RESOLUTIONS.includes(r)),
					precision: e.display.precision,
					yMin: e.display.y_min,
					chart: e.display.chart === "line" || e.display.chart === "bar" ? e.display.chart : null,
					aggregate: e.aggregate === "sum" || e.aggregate === "mean" ? e.aggregate : null
				};
				setIfPresent(type, "available", e.available);
				setIfPresent(type, "retired", retirement(e.retired));
				return type;
			})
		};
		setIfPresent(entry, "description", d.description);
		setIfPresent(entry, "source", d.source);
		setIfPresent(entry, "license", d.license);
		setIfPresent(entry, "metaUrl", d.meta_url);
		setIfPresent(entry, "retired", retirement(d.retired));
		return entry;
	});
}

type ScaleLevel = {
	key: string;
	label: string;
	color: string | null;
	opacity: number | null;
	tier: number | null;
	guidance?: string | null;
	description?: string | null;
	min: number | null;
	max: number | null;
	value?: string | number | null;
};

/** A server scale's levels as `Level`s, ordered by min. A null `min` is 0; `value` is kept. */
export function mapScaleLevels(levels: ScaleLevel[] | undefined): Level[] {
	if (!levels) return [];
	return levels
		.map((l) => {
			const level: Level = {
				key: l.key,
				label: l.label,
				color: l.color,
				opacity: l.opacity,
				tier: l.tier,
				guidance: l.guidance ?? "",
				description: l.description ?? "",
				min: l.min ?? 0,
				max: l.max
			};
			if (l.value !== null && l.value !== undefined) level.value = String(l.value);
			return level;
		})
		.sort((a, b) => a.min - b.min);
}

export function createWebMetadata(): MetadataSource {
	const meta = memoize(() => getMonitorsMeta());
	const list = memoize(() => getMonitorsList());
	const forecastsMeta = memoize(() => getForecastsMeta());
	const monitorLevels = async (entryType: string, signal?: AbortSignal) =>
		mapScaleLevels((await meta(signal)).entries[entryType]?.scale?.levels);
	const regionsMeta = memoize(() => getRegionsMeta());
	const hmsMeta = memoize(() => getHMSMeta());
	const heatMeta = memoize(() => getCalHeatScoreMeta());
	const catalog = memoize(async () => mapDatasetCatalog(await getDatasetCatalog()));
	return {
		async catalog(signal) {
			try {
				return await catalog(signal);
			} catch (error) {
				// A server without `meta/datasets/` (404) or any other failure: no catalog, and the
				// memo is cleared so the next call retries. Only the caller's own abort rejects.
				if (signal?.aborted) throw error;
				return "unavailable";
			}
		},
		levels: monitorLevels,
		async datasetLevels(dataset, entryType, signal) {
			// Each dataset with scales names its own meta endpoint here (forecasts, hms-smoke); the
			// rest use the monitors'. A new dataset with its own scales adds its endpoint.
			if (dataset === "forecasts") {
				return mapScaleLevels((await forecastsMeta(signal)).scales[entryType]?.levels);
			}
			if (dataset === "hms-smoke") {
				return mapScaleLevels((await hmsMeta(signal)).scales[entryType]?.levels);
			}
			if (dataset === "calheatscore") {
				return mapScaleLevels((await heatMeta(signal)).scales[entryType]?.levels);
			}
			return monitorLevels(entryType, signal);
		},
		async serverScale(dataset, entryType, signal) {
			const scales = async () =>
				dataset === "forecasts"
					? (await forecastsMeta(signal)).scales
					: dataset === "hms-smoke" || dataset === "hms-fire"
						? (await hmsMeta(signal)).scales
						: dataset === "calheatscore"
							? (await heatMeta(signal)).scales
							: undefined;
			const own = await scales();
			if (own) return Object.hasOwn(own, entryType) ? own[entryType] : null;
			return (await meta(signal)).entries[entryType]?.scale ?? null;
		},
		async monitorTypeInterval(type, signal) {
			return (await meta(signal)).monitors[type]?.expected_interval || null;
		},
		async dailyFigure(entryType, signal) {
			const scale = (await meta(signal)).entries[entryType]?.scale;
			if (!scale?.daily_statistic) return null;
			return { field: scale.daily_statistic, label: scale.daily_statistic_label ?? null };
		},
		async schoolGuidelines(entryType, signal) {
			return (await meta(signal)).entries[entryType]?.school_guidelines ?? null;
		},
		async scaleSource(dataset, entryType, signal) {
			const scale =
				dataset === "forecasts"
					? (await forecastsMeta(signal)).scales[entryType]
					: dataset === "hms-smoke"
						? (await hmsMeta(signal)).scales[entryType]
						: dataset === "calheatscore"
							? (await heatMeta(signal)).scales[entryType]
							: (await meta(signal)).entries[entryType]?.scale;
			return scale?.source ?? null;
		},
		async defaultProcessor(monitorType, entryType, signal) {
			const monitor = (await meta(signal)).monitors[monitorType];
			const entries = monitor?.entries as
				Record<string, { default_calibration?: string | null } | undefined> | undefined;
			return entries?.[entryType]?.default_calibration || null;
		},
		async alertConfig(monitorType, entryType, signal) {
			const monitor = (await meta(signal)).monitors[monitorType];
			const alerts = monitor?.entries?.[entryType]?.alerts;
			const windowMinutes = parseMinutes(alerts?.window);
			if (!alerts || windowMinutes === null) return null;
			return {
				windowMinutes,
				expectedIntervalMinutes: parseMinutes(alerts.expected_interval ?? monitor.expected_interval)
			};
		},
		async mapPollutants(signal) {
			try {
				return [...((await meta(signal)).available_pollutants ?? [])];
			} catch (error) {
				// The memo is cleared on failure, so the next call asks again.
				if (signal?.aborted) throw error;
				return "unavailable";
			}
		},
		async monitorType(monitorId, signal) {
			return (await list(signal)).find((m) => m.id === monitorId)?.type ?? null;
		},
		async monitors(signal) {
			return (await list(signal)).map((m) => ({
				id: m.id,
				name: m.name,
				type: m.type,
				county: m.county ?? "",
				active: m.is_active ?? true,
				inside: m.location === "inside"
			}));
		},
		async monitorTypes(signal) {
			return Object.entries((await meta(signal)).monitors).map(([type, m]) => ({
				type,
				label: m.label,
				entryTypes: Object.keys(m.entries ?? {}),
				group: m.group ?? null,
				published: Object.entries(m.entries ?? {})
					.filter(([, entry]) => entry?.published === true)
					.map(([id]) => id)
			}));
		},
		async monitorGroups(signal) {
			return Object.values((await meta(signal)).monitor_groups ?? {}).sort(
				(a, b) => a.order - b.order
			);
		},
		async entryTypeHelp(entryType, signal) {
			return (await meta(signal)).entries[entryType]?.description || null;
		},
		async locationTypeLabel(type, signal) {
			const types: Partial<Record<string, { label: string }>> = (await regionsMeta(signal))
				.location_types;
			return (Object.hasOwn(types, type) && types[type]?.label) || null;
		}
	};
}
