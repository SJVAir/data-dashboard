import { createRouter } from "sv-router";
import { BASE, canonicalHome } from "./lib/routing";
import DashboardPage from "./routes/DashboardPage.svelte";
import Home from "./routes/Home.svelte";
import NotFound from "./routes/NotFound.svelte";

const routes = {
	// sv-router drops the trailing slash; keep the address (and sv-router's history state) but
	// show home as `/workspace/`.
	hooks: {
		afterLoad() {
			const home = canonicalHome(location.pathname);
			if (home) history.replaceState(history.state, "", home + location.search + location.hash);
		}
	},
	"/": Home,
	// The list is a page away from any dashboard, so it loads on demand.
	"/dashboards": () => import("./routes/DashboardList.svelte"),
	"/dashboards/:id": DashboardPage,
	// Trimmed paths go to the dashboard (NotFound redirects them).
	"/dashboards/:id/widgets": NotFound,
	"/dashboards/:id/widgets/new": () => import("./routes/GetData.svelte"),
	"/dashboards/:id/widgets/:widgetId/edit": () => import("./routes/GetData.svelte"),
	"/data": () => import("./routes/GetData.svelte"),
	"/import": () => import("./routes/Import.svelte"),
	"/shared/:token": () => import("./routes/SharedPage.svelte"),
	// A trimmed share link goes home, as other trimmed paths do.
	"/shared": NotFound,
	// The hidden dev data page: dev builds only, loaded on demand, never linked.
	...(import.meta.env.DEV ? { "/dev/data": () => import("./routes/dev/DevData.svelte") } : {}),
	"*": NotFound
};

/** The route table's keys, minus the hooks and the catch-all (the error reports' route list is tested against them). */
export const ROUTE_KEYS = Object.keys(routes).filter((key) => key !== "hooks" && key !== "*");

export const { route, navigate, p, isActive } = createRouter(routes, { base: BASE });
