import { getMonitors, type MonitorEntryType, type MonitorLatest } from "@sjvair/sdk";
import { encodeRef, type DataSource, type MonitorFeatureProperties } from "@sjvair/map-sdk/data";
import type { FeatureCollection, Point } from "geojson";
import { getResolvers, placeRegion } from "$lib/data";
import type { Figure, Level, MetadataSource } from "$lib/data/metadata";
import type { NowSource } from "$lib/data/now/client";
import {
	isPeriodAt,
	monitorDaySource,
	monitorPeriodSource,
	type MonitorScope as SnapshotScope,
	type Snapshot,
	type SnapshotAt
} from "$lib/data/snapshot";
import type { UnavailableReason } from "$lib/data/types";
import { pollutantLayers } from "../options";
import { monitorScope, type MonitorScope, type ScopeContext } from "./scope";
import type { MapDataEntry, MapDataInput } from "./types";

type Collection = FeatureCollection<Point, MonitorFeatureProperties>;

/** The reading's numeric value, or null. */
function readingValue(monitor: MonitorLatest): number | null {
	const raw = "value" in monitor.latest ? monitor.latest.value : null;
	if (raw === null || raw === undefined || raw === "") return null;
	const value = Number(raw);
	return Number.isFinite(value) ? value : null;
}

/** One monitor as map-sdk's monitor feature (the shape its own store draws); no mark. */
function monitorFeature(
	monitor: MonitorLatest & { position: NonNullable<MonitorLatest["position"]> },
	over: Pick<MonitorFeatureProperties, "value" | "isActive" | "timestamp">
): Collection["features"][number] {
	return {
		type: "Feature",
		geometry: { type: "Point", coordinates: monitor.position.coordinates },
		properties: {
			refKey: encodeRef({ kind: "monitor", id: monitor.id }),
			name: monitor.name,
			value: over.value,
			type: monitor.type,
			isActive: over.isActive,
			isSjvair: monitor.is_sjvair,
			location: monitor.location === "inside" ? "inside" : "outside",
			timestamp: over.timestamp
		}
	};
}

/** Monitors as map-sdk's monitor features (the shape its own store draws); no position, no mark. */
export function toMonitorFeatures(readings: MonitorLatest[]): Collection {
	const features: Collection["features"] = [];
	for (const monitor of readings) {
		if (!monitor.position) continue;
		features.push(
			monitorFeature(
				{ ...monitor, position: monitor.position },
				{
					value: readingValue(monitor),
					isActive: monitor.is_active,
					timestamp: monitor.latest.timestamp
				}
			)
		);
	}
	return { type: "FeatureCollection", features };
}

/**
 * A stop's monitors (a day's, month's or year's): those of the list (names, positions, types) with
 * a row for it, each with its figure (`null` when there wasn't enough data, or it can't be rated,
 * so no level). A monitor with a row was reporting, so it draws active; a stop's figure has no
 * reading time.
 */
export function toDayFeatures(list: MonitorLatest[], snapshot: Snapshot): Collection {
	const features: Collection["features"] = [];
	for (const monitor of list) {
		const figure = snapshot.figures.get(monitor.id);
		if (!figure || !monitor.position) continue;
		const feature = monitorFeature(
			{ ...monitor, position: monitor.position },
			{ value: figure.value, isActive: true, timestamp: null }
		);
		// Not enough data for the stop: no value, and the monitors plugin's `detail` says why.
		if (figure.kind === "thin") (feature.properties as DayMonitorProperties).thin = true;
		features.push(feature);
	}
	return { type: "FeatureCollection", features };
}

/** A stop's monitor: `thin` when it had a row for the stop without enough data for a figure. */
export type DayMonitorProperties = MonitorFeatureProperties & { thin?: true };

/** Whether a day's monitor had too little data that day for a figure. */
export function isThin(props: MonitorFeatureProperties): boolean {
	return (props as DayMonitorProperties).thin === true;
}

/** The places' scope as the snapshot query takes it, with a key that names its kind. */
export function snapshotScope(scope: MonitorScope): { scope: SnapshotScope; scopeKey: string } {
	return {
		scope: { kind: scope.kind, ids: scope.ids },
		scopeKey: `${scope.kind}:${scope.key}`
	};
}

export type MonitorsEntryContext = ScopeContext & { now: () => Date };

/** The monitors list's source, with the places' scope it was resolved for. */
export type MonitorsListSource = NowSource<MonitorLatest[]> & { scope: MonitorScope };

export type MonitorsEntry = Omit<
	MapDataEntry<MonitorLatest[], MonitorFeatureProperties>,
	"source"
> & {
	source(
		input: MapDataInput,
		signal?: AbortSignal
	): Promise<MonitorsListSource | { unavailable: UnavailableReason } | null>;
	/**
	 * One stop's figures (a day's, a month's or a year's) for the monitors in `scope` (the list
	 * source's). The pollutant's figure at the stop's resolution and its levels are looked up when
	 * it fetches, so a failed lookup is the fetch's error.
	 */
	stopSource(args: {
		scope: MonitorScope;
		entryType: string;
		at: StopAt;
		rating: DayRating;
		today: () => string;
	}): DaySource;
};

/** A stop of a range: a day, or a month or year by its start. */
export type StopAt = Exclude<SnapshotAt, "now">;

/**
 * Where a pollutant's figure at a resolution (`daily_statistic`, or at Monthly and Yearly
 * `period_statistic`) and its levels come from.
 */
export type DayRating = Pick<MetadataSource, "figure" | "levels">;

/** A stop's figures for the monitors, polled while `poll` says so (until they are all final). */
export type DaySource = ReturnType<typeof monitorDaySource>;

/**
 * The monitors entry: the pollutant showing's monitors and latest readings, limited by the places
 * (the first pollutant layer's). Regions go to the server's `at` endpoint; monitor places take the
 * current list filtered to their ids. The list is the same on every stop (a stop's figures come
 * from `stopSource`, joined to it by id), so its key holds no day.
 */
export function createMonitorsEntry(ctx: MonitorsEntryContext): MonitorsEntry {
	return {
		id: "monitors",
		async source({ data, entryType }, signal) {
			const layer = pollutantLayers(data, undefined)[0];
			if (!layer) return null;
			const scope = await monitorScope(layer, ctx, signal);
			if ("unavailable" in scope) return scope;
			const type = entryType as MonitorEntryType;
			const source: MonitorsListSource = {
				key: `map-monitors:${entryType}:${scope.key}`,
				cadence: "raw",
				scope,
				fetch: async (s) => {
					if (scope.kind === "regions") {
						const found = await getMonitors(
							type,
							{ timestamp: ctx.now(), region: scope.ids },
							{ signal: s }
						);
						return found as MonitorLatest[];
					}
					const all = (await getMonitors(type, undefined, { signal: s })) as MonitorLatest[];
					const wanted = new Set(scope.ids);
					return all.filter((m) => wanted.has(m.id));
				}
			};
			return source;
		},
		stopSource({ scope, entryType, at, rating, today }) {
			const args = { ...snapshotScope(scope), entryType, today };
			const sourceOf = (rated: { figure: Figure | null; levels: Level[] }) =>
				isPeriodAt(at)
					? monitorPeriodSource({ ...args, ...rated, at })
					: monitorDaySource({ ...args, ...rated, day: at.day });
			// The key, cadence and poll rule don't depend on the figure or levels.
			const shape = sourceOf({ figure: null, levels: [] });
			const resolution = isPeriodAt(at) ? at.resolution : "day";
			return {
				...shape,
				async fetch(signal) {
					const [figure, levels] = await Promise.all([
						rating.figure(entryType, resolution, signal),
						rating.levels(entryType, signal)
					]);
					return sourceOf({ figure, levels }).fetch(signal);
				}
			};
		},
		toDataSources(value, { entryType }) {
			const source: DataSource<MonitorFeatureProperties> = {
				status: { state: "ready" },
				features: toMonitorFeatures(value),
				scale: { dataset: "air-quality", entryType }
			};
			return { monitors: source };
		}
	};
}

/** The app's monitors entry; the resolvers are looked up on use, not on import. */
export const monitorsEntry = createMonitorsEntry({
	regions: { resolve: (type, code, signal) => getResolvers().regions.resolve(type, code, signal) },
	placeRegion,
	now: () => new Date()
});
