const TIMEOUT_MS = 5000;

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
	const refresh = Promise.all(
		["app.js", "app.css"].map((file) =>
			fetchFn(new URL(file, staticBase), { cache: "reload" }).catch(() => undefined)
		)
	).then(() => undefined);
	try {
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
