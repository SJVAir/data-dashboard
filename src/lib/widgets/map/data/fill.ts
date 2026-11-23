import type { RegionFeature, RegionSummaryBulkType } from "@sjvair/sdk";
import {
	encodeRef,
	type DataSource,
	type MapFeatureProperties,
	type ScaleRef
} from "@sjvair/map-sdk/data";
import type { Feature, FeatureCollection, Geometry } from "geojson";
import { getMetadata, getResolvers } from "$lib/data";
import type { NowSource, NowState } from "$lib/data/now/client";
import {
	atKey,
	fillableTypes,
	isPeriodAt,
	regionDaySource,
	regionPeriodSource,
	regionTodaySource,
	type Snapshot,
	type SnapshotAt,
	type SnapshotFigure
} from "$lib/data/snapshot";
import { todayPacific } from "$lib/format";
import { directoryFor } from "$lib/places/host";
import { regionTypeShapes } from "../regions";
import type { DayRating, ThinProperties } from "./monitors";
import { dataStatus } from "./status";

/** A fill as map-sdk draws it: every region of the type, each with its figure or none. */
export type FillData = {
	features: FeatureCollection<Geometry, MapFeatureProperties>;
	/** Every figure final (a stop's); false keeps the stop polling. */
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

/** Whether the fill polls (hourly): as its source says (today so far; a day until all final). */
export function fillPolls(source: FillSource | null, value: FillData | undefined): boolean {
	return !!source && source.poll(value);
}

export type FillEntry = {
	/**
	 * A region type's outlines alone, with no figures (a Map with no pollutant: spec decision 6,
	 * "only outlines of counties"). The same on every stop; never polled. No figure or levels are
	 * looked up.
	 */
	outlines(args: { regionType: RegionSummaryBulkType }): FillSource;
	/**
	 * A fill of `regionType` by `entryType`'s figure: the day's, month's or year's (the average of
	 * the daily figures), or today's so far on now.
	 */
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

/** The fill's scale: the same ScaleRef as the monitors', so the legend shares one section. */
export function fillScale(entryType: string): ScaleRef {
	return { dataset: "air-quality", entryType };
}

/**
 * The fill's source for the regions plugin, reading the loaded state as it is. With no pollutant
 * its scale is null: map-sdk draws every region as a no-figure outline and gives it no legend
 * section.
 */
export function fillSourceOf(d: {
	readonly fillState: NowState<FillData>;
	/** The pollutant the fill loads (its scale); undefined with no fill. */
	readonly fillFor: string | undefined;
}): DataSource {
	// map-sdk matches a resolved scale to its source's by identity: one ScaleRef per pollutant.
	let known: { entryType: string; scale: ReturnType<typeof fillScale> } | undefined;
	return {
		get status() {
			return dataStatus(d.fillState);
		},
		get features() {
			return d.fillState.data?.features ?? null;
		},
		get scale() {
			const entryType = d.fillFor;
			if (!entryType) return null;
			if (known?.entryType !== entryType) known = { entryType, scale: fillScale(entryType) };
			return known.scale;
		}
	};
}

/** No region has a figure: an outlines-only fill. */
const NO_FIGURES: Snapshot = { figures: new Map(), final: true, unrated: false };

/**
 * A region's properties with its figure: none when the summaries leave it out; a thin row (too
 * little data for a figure) is marked, with its day counts, so the fill says why it has none.
 */
function fillProperties(
	figure: SnapshotFigure | undefined,
	base: { refKey: string; name: string }
): MapFeatureProperties & ThinProperties {
	const props: MapFeatureProperties & ThinProperties = { ...base, value: figure?.value ?? null };
	if (figure?.kind === "thin") {
		props.thin = true;
		if (figure.days) props.thinDays = figure.days;
	}
	return props;
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
			properties: fillProperties(snapshot.figures.get(`${type}:${code}`), {
				refKey: encodeRef({ kind: "region", type, code }),
				name: name({ type, name: shape.properties.name })
			})
		});
	}
	return { type: "FeatureCollection", features };
}

export function createFillEntry(ctx: FillContext): FillEntry {
	return {
		outlines({ regionType }) {
			return {
				key: `map-fill:outlines:${regionType}`,
				cadence: "hour",
				poll: () => false,
				async fetch(signal) {
					const [shapes, name] = await Promise.all([
						ctx.shapes(regionType, signal),
						ctx.names(signal)
					]);
					return { features: toFillFeatures(shapes, NO_FIGURES, regionType, name), final: true };
				}
			};
		},
		source({ regionType, entryType, at }) {
			const now = at === "now";
			return {
				// Now is keyed by today's Pacific date, so it is a new source after midnight.
				key: `map-fill:${entryType}:${regionType}:${now ? `today:${ctx.today()}` : atKey(at)}`,
				cadence: "hour",
				// Now: today so far, hourly. A day, month or year: hourly until every figure is final
				// (the current month or year never is).
				poll: (value) => now || !value?.final,
				async fetch(signal) {
					const [shapes, name, figure, levels] = await Promise.all([
						ctx.shapes(regionType, signal),
						ctx.names(signal),
						ctx.rating.figure(entryType, isPeriodAt(at) ? at.resolution : "day", signal),
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
						: isPeriodAt(at)
							? await regionPeriodSource({ ...args, at }).fetch(signal)
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
		figure: (entryType, resolution, signal) => getMetadata().figure(entryType, resolution, signal),
		levels: (entryType, signal) => getMetadata().levels(entryType, signal)
	},
	today: () => todayPacific()
});
