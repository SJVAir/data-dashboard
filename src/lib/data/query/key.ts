import type { ResolvedRange } from "$lib/format/range";
import type { DateRangeSpec, Resolution } from "../schema";
import type { Target } from "../types";

export type KeyRange = DateRangeSpec | { firstDate: string; lastDate: string };

/**
 * The range part of a key: the spec for a rolling range (so widgets on "last 7 days" keep
 * sharing an entry as time moves), the resolved dates for a fixed one.
 */
export function keyRange(spec: DateRangeSpec, resolved: ResolvedRange): KeyRange {
	return resolved.rolling ? spec : { firstDate: resolved.firstDate, lastDate: resolved.lastDate };
}

function sortedTarget(target: Target): Target {
	switch (target.kind) {
		case "monitors":
			return { kind: "monitors", ids: [...target.ids].sort() };
		case "regions":
			return { kind: "regions", keys: [...target.keys].sort() };
		default:
			return { kind: "all" };
	}
}

/** JSON with object keys sorted at every level, so equal values always give equal text. */
export function stableJson(value: unknown): string {
	if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
	if (value && typeof value === "object") {
		const fields = Object.keys(value)
			.filter((k) => (value as Record<string, unknown>)[k] !== undefined)
			.sort()
			.map((k) => `${JSON.stringify(k)}:${stableJson((value as Record<string, unknown>)[k])}`);
		return `{${fields.join(",")}}`;
	}
	return JSON.stringify(value);
}

/** The cache key for one fully resolved request. */
export function queryKey(parts: {
	dataset: string;
	entryType: string;
	target: Target;
	resolution: Resolution;
	downsampleFromRaw: boolean;
	range: KeyRange;
}): string {
	return stableJson({ ...parts, target: sortedTarget(parts.target) });
}
