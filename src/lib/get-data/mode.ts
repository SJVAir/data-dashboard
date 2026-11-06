/** What the Get data view is doing: starting a new widget, or editing an existing one. */
export type GetDataMode =
	{ kind: "new"; dashboardId?: string } | { kind: "edit"; dashboardId: string; widgetId: string };

/** The mode for the route's params (`/data`, `.../widgets/new`, `.../widgets/:widgetId/edit`). */
export function parseGetDataMode(params: Record<string, string | undefined>): GetDataMode {
	const { id, widgetId } = params;
	if (id && widgetId) return { kind: "edit", dashboardId: id, widgetId };
	return { kind: "new", dashboardId: id };
}

/** Where Cancel goes: Back, or (opened on a link) the dashboard the view is for, else home. */
export type CancelPlan =
	| { kind: "back" }
	| { kind: "go"; path: "/" }
	| {
			kind: "go";
			path: "/dashboards/:id";
			id: string;
	  };

/**
 * Back only from an entry the app pushed: the router numbers its entries in `history.state`
 * (`_routerIndex`, 0 for the one the page opened on), so Back from a later one stays in the app.
 * A page opened on the link would leave the app, so it goes to the dashboard instead.
 */
export function cancelPlan(state: unknown, mode: GetDataMode): CancelPlan {
	const index = (state as { _routerIndex?: unknown } | null)?._routerIndex;
	if (typeof index === "number" && index > 0) return { kind: "back" };
	return mode.dashboardId
		? { kind: "go", path: "/dashboards/:id", id: mode.dashboardId }
		: { kind: "go", path: "/" };
}
