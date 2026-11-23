import { splitRegionKey } from "$lib/data/adapters/targets";
import type { PlaceRef, SpatialSelection, WidgetDataConfig } from "$lib/data/schema";
import { isPlaceRef, sameRef, type PickRef } from "./types";

export type PickerMode = { kind: "single" } | { kind: "multiple"; max: number };
/** Ordered; points and locations are only ever alone (choosing one replaces a single pick). */
export type Picks = PickRef[];
export type BlockReason =
	"other-kind-regions" | "other-kind-monitors" | "single-only" | "alone-picked" | "at-cap";

function isSingleOnly(ref: PickRef): boolean {
	return ref.kind === "location" || ref.kind === "point" || ref.kind === "default-place";
}

/** Why `candidate` can't be picked now, or `null` when it can (a picked one can always go). */
export function blockReason(
	picks: Picks,
	candidate: PickRef,
	mode: PickerMode
): BlockReason | null {
	if (mode.kind === "single") return null;
	if (picks.some((p) => sameRef(p, candidate))) return null;
	if (isSingleOnly(candidate)) {
		// A school or point replaces exactly one picked place (of any kind, a school or point too);
		// with two or more it stays blocked.
		if (candidate.kind === "default-place") return "single-only";
		return picks.length >= 2 ? "single-only" : null;
	}
	if (picks.some(isSingleOnly)) return "alone-picked";
	if (picks.length > 0 && picks[0].kind !== candidate.kind) {
		return picks[0].kind === "region" ? "other-kind-regions" : "other-kind-monitors";
	}
	if (picks.length >= mode.max) return "at-cap";
	return null;
}

export function toggle(picks: Picks, candidate: PickRef, mode: PickerMode): Picks {
	if (mode.kind === "single") return [candidate];
	if (picks.some((p) => sameRef(p, candidate))) return picks.filter((p) => !sameRef(p, candidate));
	if (blockReason(picks, candidate, mode)) return picks;
	if (isSingleOnly(candidate)) return [candidate];
	return [...picks, candidate];
}

/**
 * The Where for the picks: one → `place`, several → `selection` (regions), none → neither
 * (everywhere). Monitors are never a Where: a monitor pick is left out.
 */
export function toWhere(picks: Picks): { place?: PlaceRef; selection?: SpatialSelection } {
	const places = picks.filter(isPlaceRef);
	if (places.length === 0) return {};
	if (places.length === 1) return { place: places[0] };
	const ids = places.flatMap((p) => (p.kind === "region" ? [`${p.type}:${p.code}`] : []));
	return { selection: { kind: "regions", ids } };
}

/** The picks a Where holds (a selection's region ids split back into refs; invalid ids dropped). */
export function fromWhere(data: Pick<WidgetDataConfig, "place" | "selection">): PlaceRef[] {
	if (data.place) return data.place.kind === "default-place" ? [] : [data.place];
	const selection = data.selection;
	if (!selection) return [];
	return selection.ids.flatMap((id) => {
		if (!id.includes(":")) return [];
		const { type, code } = splitRegionKey(id);
		return type && code ? [{ kind: "region" as const, type, code }] : [];
	});
}
