import { createRouter } from "sv-router";
import { BASE, canonicalHome } from "./lib/routing";
import DashboardList from "./routes/DashboardList.svelte";
import DashboardPage from "./routes/DashboardPage.svelte";
import Home from "./routes/Home.svelte";
import NotFound from "./routes/NotFound.svelte";

export const { route, navigate, p, isActive } = createRouter(
	{
		// sv-router drops the trailing slash; keep the address (and sv-router's history state) but
		// show home as `/workspace/`.
		hooks: {
			afterLoad() {
				const home = canonicalHome(location.pathname);
				if (home) history.replaceState(history.state, "", home + location.search + location.hash);
			}
		},
		"/": Home,
		"/dashboards": DashboardList,
		"/dashboards/:id": DashboardPage,
		"/import": () => import("./routes/Import.svelte"),
		// The hidden dev data page: dev builds only, loaded on demand, never linked.
		...(import.meta.env.DEV ? { "/dev/data": () => import("./routes/dev/DevData.svelte") } : {}),
		"*": NotFound
	},
	{ base: BASE }
);
