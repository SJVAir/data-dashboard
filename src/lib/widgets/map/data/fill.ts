import type { RegionFeature, RegionSummaryBulkType } from "@sjvair/sdk";
import type { FeatureListItem, MapPlugin } from "@sjvair/map-sdk";
import { encodeRef, type MapFeatureProperties, type ScaleRef } from "@sjvair/map-sdk/data";
import type { Feature, FeatureCollection, Geometry } from "geojson";
import { getMetadata, getResolvers } from "$lib/data";
import type { NowSource } from "$lib/data/now/client";
import {
	fillableTypes,
	regionDaySource,
	regionTodaySource,
	type Snapshot,
	type SnapshotAt
} from "$lib/data/snapshot";
import { todayPacific } from "$lib/format";
import { directoryFor } from "$lib/places/host";
import { regionTypeShapes } from "../regions";
import type { DayRating } from "./monitors";

/** A fill as map-sdk draws it: every region of the type, each with its figure or none. */
export type FillData = {
	features: FeatureCollection<Geometry, MapFeatureProperties>;
	/** Every figure final (a day's); false keeps the day polling. */
	final: boolean;
};

/** Where a fill's regions, names and rating come from. */
export type FillContext = {
	/** Every current region of a type. */
	shapes(type: RegionSummaryBulkType, signal?: AbortSignal): Promise<RegionFeature[]>;
	/** How to show a region of any type (its type's `name_template`). */
	names(signal?: AbortSignal): Promise<(region: { type: string; name: string }) => string>;
	rating: DayRating;
	today: () => string;
};

export type FillSource = NowSource<FillData> & { poll(value: FillData | undefined): boolean };

export type FillEntry = {
	/** A fill of `regionType` by `entryType`'s figure: the day's, or today's so far on now. */
	source(args: {
		regionType: RegionSummaryBulkType;
		entryType: string;
		at: SnapshotAt;
	}): FillSource;
};

/**
 * The fill's region type: the saved `fill` when the place directory lists it (browsable, with
 * regions) and the bulk summaries take it; else none (nothing drawn, nothing written).
 */
export function fillRegionType(
	saved: string | undefined,
	types: readonly { type: string }[] | undefined
): RegionSummaryBulkType | null {
	const found = types && fillableTypes(types).find((t) => t.type === saved);
	return found ? (found.type as RegionSummaryBulkType) : null;
}

/**
 * `plugin` with `detail` on every feature it lists (map-sdk shows it only where a feature has no
 * level), so a region with no figure reads "No data" in the list, its accessible name and the
 * tooltip, as the legend's no-figure row does. `regionsPlugin` takes no `detail` of its own.
 */
export function withNoFigureDetail(plugin: MapPlugin, detail: string): MapPlugin {
	const features = plugin.features?.bind(plugin);
	if (!features) return plugin;
	plugin.features = (): FeatureListItem[] => features().map((item) => ({ ...item, detail }));
	return plugin;
}

/** The fill's scale: the same ScaleRef as the monitors', so the legend shares one section. */
export function fillScale(entryType: string): ScaleRef {
	return { dataset: "air-quality", entryType };
}

/**
 * The fill's features: every region of the type with a code, ref `region:<type>:<code>`, with its
 * figure; a region the summaries leave out has no figure (drawn as no data), never an error.
 */
function toFillFeatures(
	shapes: RegionFeature[],
	snapshot: Snapshot,
	type: string,
	name: (region: { type: string; name: string }) => string
): FillData["features"] {
	const features: Feature<Geometry, MapFeatureProperties>[] = [];
	for (const shape of shapes) {
		const code = shape.properties.external_id;
		if (!code) continue;
		features.push({
			type: "Feature",
			geometry: shape.geometry as Geometry,
			properties: {
				refKey: encodeRef({ kind: "region", type, code }),
				name: name({ type, name: shape.properties.name }),
				value: snapshot.figures.get(`${type}:${code}`)?.value ?? null
			}
		});
	}
	return { type: "FeatureCollection", features };
}

export function createFillEntry(ctx: FillContext): FillEntry {
	return {
		source({ regionType, entryType, at }) {
			const now = at === "now";
			return {
				// Now is keyed by today's Pacific date, so it is a new source after midnight.
				key: `map-fill:${entryType}:${regionType}:${now ? `today:${ctx.today()}` : at.day}`,
				cadence: "hour",
				// Now: today so far, hourly. A day: hourly until every figure is final.
				poll: (value) => now || !value?.final,
				async fetch(signal) {
					const [shapes, name, figure, levels] = await Promise.all([
						ctx.shapes(regionType, signal),
						ctx.names(signal),
						ctx.rating.dailyFigure(entryType, signal),
						ctx.rating.levels(entryType, signal)
					]);
					// The summaries name regions by server id; the shapes give their codes.
					const ids = new Map<string, string>();
					for (const shape of shapes) {
						const code = shape.properties.external_id;
						if (code) ids.set(shape.properties.id, code);
					}
					const args = {
						entryType,
						regionType,
						figure,
						levels,
						today: ctx.today,
						codes: (id: string) => ids.get(id)
					};
					const snapshot = now
						? await regionTodaySource(args).fetch(signal)
						: await regionDaySource({ ...args, day: at.day }).fetch(signal);
					return {
						features: toFillFeatures(shapes, snapshot, regionType, name),
						final: snapshot.final
					};
				}
			};
		}
	};
}

/** The app's fill entry; the metadata and resolvers are looked up on use, not on import. */
export const fillEntry = createFillEntry({
	shapes: regionTypeShapes,
	names: (signal) => directoryFor(getMetadata(), getResolvers().regions).regionNamer(signal),
	rating: {
		dailyFigure: (entryType, signal) => getMetadata().dailyFigure(entryType, signal),
		levels: (entryType, signal) => getMetadata().levels(entryType, signal)
	},
	today: () => todayPacific()
});
