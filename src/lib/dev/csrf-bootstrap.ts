const TIMEOUT_MS = 3000;

/**
 * Dev only: the Django server sets `csrftoken` on its login page, and the SDK echoes it on writes.
 * One GET through the dev proxy (same origin) plants the cookie. Never rejects, and gives up after
 * 3 s (aborting the request) so a hung proxy target can't hold up startup; with the local stack
 * down the dev data page shows its own fetch error.
 */
export async function ensureDevCsrfCookie(opts: {
	dev: boolean;
	cookie: string;
	fetchFn: typeof fetch;
}): Promise<void> {
	if (!opts.dev || /(?:^|;\s*)csrftoken=/.test(opts.cookie)) return;
	const controller = new AbortController();
	let timer: ReturnType<typeof setTimeout> | undefined;
	const timeout = new Promise<void>((resolve) => {
		timer = setTimeout(() => {
			controller.abort();
			resolve();
		}, TIMEOUT_MS);
	});
	try {
		await Promise.race([
			opts.fetchFn("/account/login/", {
				credentials: "same-origin",
				signal: controller.signal
			}),
			timeout
		]);
	} catch {
		// Stack down: nothing to bootstrap.
	} finally {
		clearTimeout(timer);
	}
}
