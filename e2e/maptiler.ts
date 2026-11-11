import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type { BrowserContext } from "@playwright/test";

const STYLE = fileURLToPath(new URL("./fixtures/maptiler-style.json", import.meta.url));
const MAPTILER = /^https:\/\/([a-z0-9-]+\.)*maptiler\.com\//;
const STYLE_PATH = /^\/maps\/[^/]+\/style\.json$/;

/** What the MapTiler stub saw in one context: every request, and the ones it answered. */
export type MapTilerRequests = { seen: string[]; stubbed: string[]; notFound: string[] };

/** A request's host and path, without its query (which carries the key). */
function where(url: string): string {
	const u = new URL(url);
	return `${u.host}${u.pathname}`;
}

/**
 * Stubs MapTiler in `context` (tests never reach it): a basemap style request
 * (`api.maptiler.com/maps/<style>/style.json`) gets the blank style in
 * `fixtures/maptiler-style.json` (a background layer, no sources, so nothing else is fetched), and
 * every other MapTiler request gets a 404. Every MapTiler request the context makes is recorded
 * in `seen`, so a test can check that none got past the stub.
 */
export async function routeMapTiler(
	context: BrowserContext,
	requests: MapTilerRequests
): Promise<void> {
	const style = await readFile(STYLE, "utf8");
	context.on("request", (request) => {
		if (MAPTILER.test(request.url())) requests.seen.push(where(request.url()));
	});
	await context.route(MAPTILER, async (route) => {
		const url = route.request().url();
		requests.stubbed.push(where(url));
		if (STYLE_PATH.test(new URL(url).pathname)) {
			await route.fulfill({ contentType: "application/json", body: style });
		} else {
			requests.notFound.push(where(url));
			await route.fulfill({ status: 404, body: "" });
		}
	});
}
