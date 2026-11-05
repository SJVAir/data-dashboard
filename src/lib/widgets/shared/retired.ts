import type { WidgetDataConfig } from "$lib/data/schema";
import type { PlaceInfo } from "$lib/data/types";

/**
 * The widget's data with each retired region, and each retired school, swapped for its
 * replacement (null if none has one).
 */
export function withReplacements(
	data: WidgetDataConfig,
	places: PlaceInfo[]
): WidgetDataConfig | null {
	// "region:<type>:<code>" to the replacement's "<type>:<code>".
	const swaps = new Map<string, { type: string; code: string }>();
	// "<source>:<code>" of a retired school to its replacement.
	const schools = new Map<string, { source: string; code: string }>();
	for (const p of places) {
		if (p.retired?.replacedBy) swaps.set(p.place, p.retired.replacedBy);
		const via = p.via;
		if (via?.kind === "location" && via.retired?.replacedBy) {
			schools.set(`${via.source}:${via.code}`, via.retired.replacedBy);
		}
	}
	if (swaps.size === 0 && schools.size === 0) return null;
	let changed = false;
	const layers = data.layers.map((layer) => {
		const next = { ...layer };
		if (layer.place?.kind === "region") {
			const swap = swaps.get(`region:${layer.place.type}:${layer.place.code}`);
			if (swap) {
				next.place = { kind: "region", type: swap.type, code: swap.code };
				changed = true;
			}
		}
		if (layer.place?.kind === "location") {
			const swap = schools.get(`${layer.place.source}:${layer.place.code}`);
			if (swap) {
				next.place = { kind: "location", source: swap.source, code: swap.code };
				changed = true;
			}
		}
		if (layer.selection?.kind === "regions") {
			const ids: string[] = [];
			let swapped = false;
			for (const id of layer.selection.ids) {
				const swap = swaps.get(`region:${id}`);
				const out = swap ? `${swap.type}:${swap.code}` : id;
				if (swap) swapped = true;
				if (!ids.includes(out)) ids.push(out);
			}
			if (swapped) {
				next.selection = { ...layer.selection, ids };
				changed = true;
			}
		}
		return next;
	});
	return changed ? { ...data, layers } : null;
}
