import type { ReportContext } from "$lib/platform/types";

/** The only context keys an error report may carry; none of them identify a person or place. */
export const ALLOWED_CONTEXT_KEYS: ReadonlySet<string> = new Set([
	"operation",
	"schemaVersion",
	"fromSchemaVersion",
	"storeName",
	"reason",
	"directive",
	"blockedHost",
	"status",
	"kind"
]);

const EMAIL = /[^\s@<>()[\]"',;:]+@[^\s@<>()[\]"',;:]+\.[a-z]{2,}/gi;
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const COORD = /-?\d{1,3}\.\d{3,}/g;
const DIGITS = /\d{6,}/g;

/** Replaces emails, UUIDs, coordinate-like numbers, and long digit runs with placeholders. */
export function scrubText(s: string): string {
	return s
		.replace(EMAIL, "[email]")
		.replace(UUID, "[id]")
		.replace(COORD, "[coord]")
		.replace(DIGITS, "[number]");
}

/** Keeps only allowed keys with primitive values, scrubbing strings. */
export function scrubContext(c?: ReportContext): ReportContext {
	const out: ReportContext = {};
	if (!c) return out;
	for (const [key, value] of Object.entries(c)) {
		if (!ALLOWED_CONTEXT_KEYS.has(key)) continue;
		if (typeof value === "string") out[key] = scrubText(value);
		else if (
			value === null ||
			value === undefined ||
			typeof value === "number" ||
			typeof value === "boolean"
		) {
			out[key] = value;
		}
	}
	return out;
}

const BASE = "/workspace";

/**
 * The route a path belongs to, with ids replaced (`/workspace/dashboards/abc` →
 * `/dashboards/:id`); `/other` for any path that isn't one of the app's routes (see
 * `src/router.ts`).
 */
export function routePattern(pathname: string): string {
	const path = pathname.split(/[?#]/)[0];
	if (path !== BASE && !path.startsWith(`${BASE}/`)) return "/other";
	const rest = path.slice(BASE.length).replace(/\/+$/, "") || "/";
	if (rest === "/" || rest === "/dashboards" || rest === "/import") return rest;
	if (/^\/dashboards\/[^/]+$/.test(rest)) return "/dashboards/:id";
	return "/other";
}
