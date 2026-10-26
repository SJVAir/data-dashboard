/**
 * Dev only: the Django server sets `csrftoken` on its login page, and the SDK echoes it on writes.
 * One GET through the dev proxy (same origin) plants the cookie. Never rejects; with the local
 * stack down the dev data page shows its own fetch error.
 */
export async function ensureDevCsrfCookie(opts: {
	dev: boolean;
	cookie: string;
	fetchFn: typeof fetch;
}): Promise<void> {
	if (!opts.dev || /(?:^|;\s*)csrftoken=/.test(opts.cookie)) return;
	try {
		await opts.fetchFn("/account/login/", { credentials: "same-origin" });
	} catch {
		// Stack down: nothing to bootstrap.
	}
}
