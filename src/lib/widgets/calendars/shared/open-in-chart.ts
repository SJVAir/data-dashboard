import type { WidgetInstance } from "$lib/documents/schema";
import { copyPlacement } from "$lib/layout/windowing";
import type { AppContext } from "$lib/store/app.svelte";
import { CHART_TYPE } from "../../chart";

/**
 * Adds a new, independent Chart for the calendar's place and pollutant over its selected days,
 * as one undo step.
 */
export function openDaysInChart(app: AppContext, widgetId: string): void {
	const session = app.current.session;
	if (!session || session.readOnly) return;
	const widgets = session.doc.body.widgets;
	const source = widgets.find((w) => w.id === widgetId);
	const sub = source?.data.timeSubRange;
	if (!source || !sub) return;
	const chart: WidgetInstance = {
		id: crypto.randomUUID(),
		type: CHART_TYPE,
		title: null,
		...copyPlacement(widgets, source),
		data: {
			dateRange: { kind: "custom", start: sub.start, end: sub.end },
			layers: structuredClone(source.data.layers).map((layer) => {
				delete layer.resolution;
				return layer;
			})
		},
		...(source.thresholds ? { thresholds: structuredClone(source.thresholds) } : {})
	};
	session.apply({
		op: "addWidget",
		target: { widgetId: chart.id },
		widget: chart,
		index: widgets.length
	});
}
