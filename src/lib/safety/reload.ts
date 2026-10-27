const TIMEOUT_MS = 5000;

/**
 * Each request matches the page's own, so it refreshes the same HTTP cache entry: `app.js` loads
 * as a module script (CORS mode), and `app.css` through `<link rel=stylesheet>` (no-cors, with
 * credentials), which Firefox caches apart from a CORS fetch.
 */
const ENTRY_FILES: [string, RequestInit][] = [
	["app.js", { cache: "reload" }],
	["app.css", { cache: "reload", mode: "no-cors", credentials: "include" }]
];

/**
 * Re-fetches the fixed-name entry files past the browser's HTTP cache, so the reload that
 * follows loads the new deploy rather than a stale `app.js`. Never rejects; gives up after 5 s.
 */
export async function refreshEntryFiles(
	staticBase: URL,
	fetchFn: typeof fetch = fetch
): Promise<void> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	const timeout = new Promise<void>((resolve) => {
		timer = setTimeout(resolve, TIMEOUT_MS);
	});
	try {
		// Built inside the `try` so a synchronous throw (a bad URL, a throwing fetch) can't escape.
		const refresh = Promise.all(
			ENTRY_FILES.map(([file, init]) =>
				fetchFn(new URL(file, staticBase), init).catch(() => undefined)
			)
		).then(() => undefined);
		await Promise.race([refresh, timeout]);
	} catch {
		// A refresh is best effort; reload anyway.
	} finally {
		clearTimeout(timer);
	}
}

/** The page reload, as a seam for tests. */
export function reloadPage(): void {
	location.reload();
}
