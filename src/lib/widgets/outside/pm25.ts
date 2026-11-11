import type { WidgetInstance } from "$lib/documents/schema";

/**
 * The widget as the "Can we go outside?" card reads it: always PM2.5 (the only pollutant with
 * school guidelines), whatever the saved layer says.
 */
export function asPm25(widget: WidgetInstance): WidgetInstance {
	return {
		...widget,
		data: {
			...widget.data,
			layers: widget.data.layers.map((l) =>
				l.dataset === "air-quality" && l.entryType && l.entryType !== "pm25"
					? { ...l, entryType: "pm25" }
					: l
			)
		}
	};
}
