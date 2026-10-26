/**
 * Report an error that the app recovered from but someone should know about. Logged in
 * development only, for now; spec 5 sends these to Sentry (scrubbed) through the platform.
 */
export function report(error: unknown, context: Record<string, unknown>): void {
	if (import.meta.env.DEV) console.error(error, context);
}
