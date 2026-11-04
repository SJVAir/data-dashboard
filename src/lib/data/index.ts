import { platform } from "$lib/platform";
import { airQualityAdapter } from "./adapters/air-quality";
import { createWebRegionResolver } from "./adapters/registry";
import { createWebMetadata, type MetadataSource } from "./metadata";
import { createQueryClient, type QueryClient } from "./query/client";

let client: QueryClient | undefined;
let metadata: MetadataSource | undefined;

/**
 * The app's one metadata source (the catalog, levels, monitors), shared with the query client so
 * each is fetched once. Like `getQueryClient`, only for lazily loaded code.
 */
export function getMetadata(): MetadataSource {
	metadata ??= createWebMetadata();
	return metadata;
}

/**
 * The app's one query client, created on first use. Only lazily loaded code (the dev page, and
 * widgets) may import this module, so the data layer stays out of the initial bundle.
 */
export function getQueryClient(): QueryClient {
	client ??= createQueryClient({
		adapters: [airQualityAdapter],
		metadata: getMetadata(),
		regions: createWebRegionResolver(),
		activity: platform().activity
	});
	return client;
}
