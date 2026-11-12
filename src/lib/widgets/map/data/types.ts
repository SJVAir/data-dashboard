import type { DataSource, MapFeatureProperties, MessageProvider } from "@sjvair/map-sdk/data";
import type { WidgetDataConfig } from "$lib/data/schema";
import type { UnavailableReason } from "$lib/data/types";
import type { NowSource } from "$lib/data/now/client";

/** What an entry loads for: the tile's layers and the pollutant showing. */
export type MapDataInput = { data: WidgetDataConfig; entryType: string };

/** One map data set: how the dashboard loads it, and how it becomes map-sdk data. */
export interface MapDataEntry<T, P extends MapFeatureProperties = MapFeatureProperties> {
	id: "monitors" | "hms";
	/**
	 * The now source for this tile's data; `{ unavailable }` with the reason when the places can't
	 * be scoped; null when there is nothing to load (no layer for it).
	 */
	source(
		input: MapDataInput,
		signal?: AbortSignal
	): Promise<NowSource<T> | { unavailable: UnavailableReason } | null>;
	/** The loaded value as map-sdk data; `entryType` is the pollutant showing. */
	toDataSources(
		value: T,
		ctx: { messages: MessageProvider; entryType: string }
	): Record<string, DataSource<P>>;
}
