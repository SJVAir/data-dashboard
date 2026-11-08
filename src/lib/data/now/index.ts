import { platform } from "$lib/platform";
import { createNowClient, type NowClient } from "./client";

let client: NowClient | undefined;

/**
 * The app's one now client, created on first use. Only lazily loaded code (widgets) may import
 * this module, so it stays out of the initial bundle.
 */
export function getNowClient(): NowClient {
	client ??= createNowClient({ activity: platform().activity });
	return client;
}
