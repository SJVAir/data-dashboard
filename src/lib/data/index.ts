import { platform } from "$lib/platform";
import { airQualityAdapter } from "./adapters/air-quality";
import { forecastsAdapter } from "./adapters/forecasts";
import { createWebLocationResolver, createWebPointResolver } from "./adapters/places";
import {
	createWebRegionResolver,
	type AdapterContext,
	type DatasetAdapter
} from "./adapters/registry";
import { createWebMetadata, type MetadataSource } from "./metadata";
import { createPlaceRegion, type PlaceRegion } from "./place-region";
import { createQueryClient, type QueryClient } from "./query/client";
import type { QueryInput } from "./types";

/** The datasets that have an adapter: each one's id and which overlays it serves. */
export function adapterOffers(): Pick<DatasetAdapter, "id" | "overlays">[] {
	return ADAPTERS;
}

const ADAPTERS: DatasetAdapter[] = [airQualityAdapter, forecastsAdapter];

let client: QueryClient | undefined;
let metadata: MetadataSource | undefined;
let resolvers: Pick<AdapterContext, "regions" | "locations" | "points"> | undefined;
let region: PlaceRegion | undefined;

/**
 * The app's one metadata source (the catalog, levels, monitors), shared with the query client so
 * each is fetched once. Like `getQueryClient`, only for lazily loaded code.
 */
export function getMetadata(): MetadataSource {
	metadata ??= createWebMetadata();
	return metadata;
}

/**
 * The app's region, location and point resolvers, shared by the query client, `placeRegion` and
 * the place picker.
 */
export function getResolvers(): Pick<AdapterContext, "regions" | "locations" | "points"> {
	resolvers ??= {
		regions: createWebRegionResolver(),
		locations: createWebLocationResolver(),
		points: createWebPointResolver()
	};
	return resolvers;
}

/**
 * The app's one query client, created on first use. Only lazily loaded code (the dev page, and
 * widgets) may import this module, so the data layer stays out of the initial bundle.
 */
export function getQueryClient(): QueryClient {
	client ??= createQueryClient({
		adapters: ADAPTERS,
		metadata: getMetadata(),
		...getResolvers(),
		activity: platform().activity
	});
	return client;
}

/**
 * The region a point or location layer uses now (the same rule as rendering); the last
 * candidate when none has data; null when it has none.
 */
export function placeRegion(
	input: QueryInput,
	signal?: AbortSignal
): Promise<{ type: string; code: string } | null> {
	region ??= createPlaceRegion(getQueryClient(), { ...getResolvers(), metadata: getMetadata() });
	return region(input, signal);
}
