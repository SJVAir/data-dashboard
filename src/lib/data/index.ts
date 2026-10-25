import { platform } from "$lib/platform";
import { airQualityAdapter } from "./adapters/air-quality";
import { createWebRegionResolver } from "./adapters/registry";
import { createWebMetadata } from "./metadata";
import { createQueryClient, type QueryClient } from "./query/client";

let client: QueryClient | undefined;

/**
 * The app's one query client, created on first use. Only lazily loaded code (the dev page, and
 * later widgets) may import this module, so the data layer stays out of the initial bundle.
 */
export function getQueryClient(): QueryClient {
	client ??= createQueryClient({
		adapters: [airQualityAdapter],
		metadata: createWebMetadata(),
		regions: createWebRegionResolver(),
		activity: platform().activity
	});
	return client;
}
