/**
 * The route keys (`src/router.ts`) the CSP walk (`csp-walk.ts`) visits. Data only, so a browser
 * test can check it against the router's `ROUTE_KEYS` without loading Playwright. It must equal the
 * union of the steps' `routes` (`csp-walk.spec.ts` checks), and the walk checks each step goes to
 * the routes it names.
 */
export const WALK_ROUTES: readonly string[] = [
	"/",
	"/dashboards",
	"/dashboards/:id",
	"/dashboards/:id/widgets",
	"/dashboards/:id/widgets/new",
	"/dashboards/:id/widgets/:widgetId/edit",
	"/data",
	"/import",
	"/shared/:token",
	"/shared"
];
