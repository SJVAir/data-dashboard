import { platform } from "$lib/platform";
import type { ReportContext } from "$lib/platform/types";

/**
 * Report an error that the app recovered from but someone should know about. Sent (scrubbed)
 * through the platform's error reporting; logged in development if the platform isn't set yet.
 * Messages and context must never carry names, titles, or place text: scrubbing free text is
 * pattern-based (emails, ids, numbers, coordinates) and can't catch them.
 */
export function report(error: unknown, context?: ReportContext): void {
	let errors;
	try {
		errors = platform().errors;
	} catch {
		if (import.meta.env.DEV) console.error(error, context);
		return;
	}
	errors.report(error, context);
}
