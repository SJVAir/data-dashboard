import { Marker } from "@maptiler/sdk";
import { maptilerMap, type MapContext } from "@sjvair/map-sdk";

/** Where the pin's label sits: right of the marker, level with its head. */
const LABEL_OFFSET: [number, number] = [16, -14];

/**
 * The pin's visible text label ("Your location", "Shared location", or the school's name), a DOM
 * marker beside the pin (map-sdk lets a host add markers through `maptilerMap`). It follows the GL
 * map: removed on detach and when the map is replaced, added again to the new one. Hidden from
 * screen readers, since the feature list already names the pin. Call during component init; the
 * label goes when the component is destroyed.
 */
export function pinLabel(
	map: () => MapContext | null,
	pin: () => { lngLat: [number, number]; text: string } | null
): void {
	$effect(() => {
		const ctx = map();
		const gl = ctx ? maptilerMap(ctx) : null;
		const at = pin();
		if (!gl || !at) return;
		const el = document.createElement("div");
		el.className =
			"bg-card text-card-foreground border-border pointer-events-none rounded-(--radius-control) border px-1.5 py-0.5 text-xs font-medium whitespace-nowrap shadow-card";
		el.setAttribute("aria-hidden", "true");
		el.dataset.pinLabel = "";
		el.textContent = at.text;
		const marker = new Marker({ element: el, anchor: "left", offset: LABEL_OFFSET })
			.setLngLat(at.lngLat)
			.addTo(gl);
		return () => {
			marker.remove();
		};
	});
}
