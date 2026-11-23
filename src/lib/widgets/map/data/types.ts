import type { DataSource, MapFeatureProperties, MessageProvider } from "@sjvair/map-sdk/data";
import type { WidgetDataConfig } from "$lib/data/schema";
import type { SnapshotAt } from "$lib/data/snapshot";
import type { UnavailableReason } from "$lib/data/types";
import type { NowSource } from "$lib/data/now/client";

/** What an entry loads for: the tile's layers, the pollutant showing, and now or the day showing. */
export type MapDataInput = { data: WidgetDataConfig; entryType: string; at: SnapshotAt };

/**
 * One map data set: how the dashboard loads it, and how it becomes map-sdk data (`D`: a data
 * source per name; the schools preset's `SchoolsSource` for the locations).
 */
export interface MapDataEntry<
	T,
	P extends MapFeatureProperties = MapFeatureProperties,
	D = Record<string, DataSource<P>>
> {
	id: "monitors" | "hms" | "notices" | "locations";
	/**
	 * The now source for this tile's data; `{ unavailable }` with the reason when the places can't
	 * be scoped; null when there is nothing to load (no layer for it).
	 */
	source(
		input: MapDataInput,
		signal?: AbortSignal
	): Promise<NowSource<T> | { unavailable: UnavailableReason } | null>;
	/** The loaded value as map-sdk data; `entryType` is the pollutant showing. */
	toDataSources(value: T, ctx: { messages: MessageProvider; entryType: string }): D;
}
