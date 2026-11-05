import { splitRegionKey } from "$lib/data/adapters/targets";
import type { Layer, PlaceRef, SpatialSelection } from "$lib/data/schema";
import { sameRef } from "./types";

export type PickerMode = { kind: "single" } | { kind: "multiple"; max: number };
/** Ordered; points and locations are only ever alone (choosing one replaces a single pick). */
export type Picks = PlaceRef[];
export type BlockReason =
	"other-kind-regions" | "other-kind-monitors" | "single-only" | "alone-picked" | "at-cap";

function isSingleOnly(ref: PlaceRef): boolean {
	return ref.kind === "location" || ref.kind === "point" || ref.kind === "default-place";
}

/** Why `candidate` can't be picked now, or `null` when it can (a picked one can always go). */
export function blockReason(
	picks: Picks,
	candidate: PlaceRef,
	mode: PickerMode
): BlockReason | null {
	if (mode.kind === "single") return null;
	if (picks.some((p) => sameRef(p, candidate))) return null;
	if (picks.some(isSingleOnly)) return "alone-picked";
	if (isSingleOnly(candidate)) {
		// A school or point replaces exactly one picked place; with two or more it stays blocked.
		if (candidate.kind === "default-place") return "single-only";
		return picks.length >= 2 ? "single-only" : null;
	}
	if (picks.length > 0 && picks[0].kind !== candidate.kind) {
		return picks[0].kind === "region" ? "other-kind-regions" : "other-kind-monitors";
	}
	if (picks.length >= mode.max) return "at-cap";
	return null;
}

export function toggle(picks: Picks, candidate: PlaceRef, mode: PickerMode): Picks {
	if (mode.kind === "single") return [candidate];
	if (picks.some((p) => sameRef(p, candidate))) return picks.filter((p) => !sameRef(p, candidate));
	if (blockReason(picks, candidate, mode)) return picks;
	if (isSingleOnly(candidate)) return [candidate];
	return [...picks, candidate];
}

/** The layer fields for the picks: one → `place`, several → `selection`, none → neither. */
export function toLayerPlaces(picks: Picks): { place?: PlaceRef; selection?: SpatialSelection } {
	if (picks.length === 0) return {};
	if (picks.length === 1) return { place: picks[0] };
	if (picks[0].kind === "region") {
		const ids = picks.flatMap((p) => (p.kind === "region" ? [`${p.type}:${p.code}`] : []));
		return { selection: { kind: "regions", ids } };
	}
	const ids = picks.flatMap((p) => (p.kind === "monitor" ? [p.id] : []));
	return { selection: { kind: "monitors", ids } };
}

/** The picks a layer holds (a selection's region ids split back into refs; invalid ids dropped). */
export function fromLayer(layer: Pick<Layer, "place" | "selection">): Picks {
	if (layer.place) return layer.place.kind === "default-place" ? [] : [layer.place];
	const selection = layer.selection;
	if (!selection) return [];
	if (selection.kind === "monitors") {
		return selection.ids.map((id) => ({ kind: "monitor" as const, id }));
	}
	return selection.ids.flatMap((id) => {
		if (!id.includes(":")) return [];
		const { type, code } = splitRegionKey(id);
		return type && code ? [{ kind: "region" as const, type, code }] : [];
	});
}
