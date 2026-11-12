import { getMonitors, type MonitorEntryType, type MonitorLatest } from "@sjvair/sdk";
import { encodeRef, type DataSource, type MonitorFeatureProperties } from "@sjvair/map-sdk/data";
import type { FeatureCollection, Point } from "geojson";
import { getResolvers, placeRegion } from "$lib/data";
import type { NowSource } from "$lib/data/now/client";
import { pollutantLayers } from "../options";
import { monitorScope, type ScopeContext } from "./scope";
import type { MapDataEntry } from "./types";

type Collection = FeatureCollection<Point, MonitorFeatureProperties>;

/** The reading's numeric value, or null. */
function readingValue(monitor: MonitorLatest): number | null {
	const raw = "value" in monitor.latest ? monitor.latest.value : null;
	if (raw === null || raw === undefined || raw === "") return null;
	const value = Number(raw);
	return Number.isFinite(value) ? value : null;
}

/** Monitors as map-sdk's monitor features (the shape its own store draws); no position, no mark. */
export function toMonitorFeatures(readings: MonitorLatest[]): Collection {
	const features: Collection["features"] = [];
	for (const monitor of readings) {
		if (!monitor.position) continue;
		features.push({
			type: "Feature",
			geometry: { type: "Point", coordinates: monitor.position.coordinates },
			properties: {
				refKey: encodeRef({ kind: "monitor", id: monitor.id }),
				name: monitor.name,
				value: readingValue(monitor),
				type: monitor.type,
				isActive: monitor.is_active,
				isSjvair: monitor.is_sjvair,
				location: monitor.location === "inside" ? "inside" : "outside",
				timestamp: monitor.latest.timestamp
			}
		});
	}
	return { type: "FeatureCollection", features };
}

export type MonitorsEntryContext = ScopeContext & { now: () => Date };

/**
 * The monitors entry: the pollutant showing's latest readings, limited by the places (the first
 * pollutant layer's). Regions go to the server's `at` endpoint; monitor places take the current
 * list filtered to their ids.
 */
export function createMonitorsEntry(
	ctx: MonitorsEntryContext
): MapDataEntry<MonitorLatest[], MonitorFeatureProperties> {
	return {
		id: "monitors",
		async source({ data, entryType }, signal) {
			const layer = pollutantLayers(data, undefined)[0];
			if (!layer) return null;
			const scope = await monitorScope(layer, ctx, signal);
			if ("unavailable" in scope) return scope;
			const type = entryType as MonitorEntryType;
			const source: NowSource<MonitorLatest[]> = {
				key: `map-monitors:${entryType}:${scope.key}`,
				cadence: "raw",
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
