import type { Resolution } from "./schema";

/** Coarseness order. `season` is never a fallback; it only participates as an ideal. */
const ORDER: Resolution[] = ["raw", "hour", "day", "month", "quarter", "year"];

/** Where `season` sits when it is the ideal: coarser than quarter, finer than year. */
const SEASON_RANK = ORDER.indexOf("quarter") + 0.5;

function rank(resolution: Resolution): number {
	return resolution === "season" ? SEASON_RANK : ORDER.indexOf(resolution);
}

function ladder(spanDays: number): Resolution {
	if (spanDays <= 2) return "raw";
	if (spanDays <= 60) return "hour";
	if (spanDays <= 730) return "day";
	return "month";
}

export type ResolutionChoice = {
	resolution: Resolution;
	downsampleFromRaw: boolean;
	reason: "pin" | "override" | "ladder";
};

/**
 * Pick the resolution to query. Priority: widget-type pin, then layer override, then the
 * span ladder. Falls back to the nearest coarser offered level, then to downsampling raw.
 * Throws RangeError when neither is possible (the query client reports `no-resolution`).
 */
export function chooseResolution(args: {
	spanDays: number;
	offered: Resolution[];
	pin?: Resolution;
	override?: "auto" | Resolution;
}): ResolutionChoice {
	const { spanDays, offered, pin, override } = args;
	let ideal: Resolution;
	let reason: ResolutionChoice["reason"];
	if (pin) {
		ideal = pin;
		reason = "pin";
	} else if (override && override !== "auto") {
		ideal = override;
		reason = "override";
	} else {
		ideal = ladder(spanDays);
		reason = "ladder";
	}

	if (offered.includes(ideal)) return { resolution: ideal, downsampleFromRaw: false, reason };

	const idealRank = rank(ideal);
	const coarser = ORDER.find((level) => rank(level) > idealRank && offered.includes(level));
	if (coarser) return { resolution: coarser, downsampleFromRaw: false, reason };

	if (offered.includes("raw")) return { resolution: ideal, downsampleFromRaw: true, reason };

	throw new RangeError(`No usable resolution for ${ideal} (offered: ${offered.join(", ")})`);
}
