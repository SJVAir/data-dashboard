/** What the Get data view is doing: starting a new widget, or editing an existing one. */
export type GetDataMode =
	{ kind: "new"; dashboardId?: string } | { kind: "edit"; dashboardId: string; widgetId: string };

/** The mode for the route's params (`/data`, `.../widgets/new`, `.../widgets/:widgetId/edit`). */
export function parseGetDataMode(params: Record<string, string | undefined>): GetDataMode {
	const { id, widgetId } = params;
	if (id && widgetId) return { kind: "edit", dashboardId: id, widgetId };
	return { kind: "new", dashboardId: id };
}
