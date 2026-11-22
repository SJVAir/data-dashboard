import type { ChosenPlace } from "$lib/data/schema";
import type { Dashboard } from "$lib/documents/schema";

/**
 * `doc` with every widget's `default-place` replaced by `place` (each its own copy). A new object;
 * `doc` is left as it was.
 */
export function resolveDefaultPlace(doc: Dashboard, place: ChosenPlace): Dashboard {
	const resolved = structuredClone(doc);
	for (const widget of resolved.body.widgets) {
		if (widget.data.place?.kind === "default-place") widget.data.place = structuredClone(place);
	}
	return resolved;
}
