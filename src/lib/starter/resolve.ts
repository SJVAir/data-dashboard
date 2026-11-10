import type { ChosenPlace } from "$lib/data/schema";
import type { Dashboard } from "$lib/documents/schema";

/**
 * `doc` with every layer's `default-place` replaced by `place` (each its own copy). A new object;
 * `doc` is left as it was.
 */
export function resolveDefaultPlace(doc: Dashboard, place: ChosenPlace): Dashboard {
	const resolved = structuredClone(doc);
	for (const widget of resolved.body.widgets) {
		for (const layer of widget.data.layers) {
			if (layer.place?.kind === "default-place") layer.place = structuredClone(place);
		}
	}
	return resolved;
}
