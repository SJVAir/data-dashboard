import { createRouter } from "sv-router";
import DashboardList from "./routes/DashboardList.svelte";
import DashboardPage from "./routes/DashboardPage.svelte";
import Home from "./routes/Home.svelte";
import NotFound from "./routes/NotFound.svelte";

export const { route, navigate, p, isActive } = createRouter(
	{
		"/": Home,
		"/dashboards": DashboardList,
		"/dashboards/:id": DashboardPage,
		"/import": () => import("./routes/Import.svelte"),
		// The hidden dev data page: dev builds only, loaded on demand, never linked.
		...(import.meta.env.DEV ? { "/dev/data": () => import("./routes/dev/DevData.svelte") } : {}),
		"*": NotFound
	},
	{ base: "/workspace" }
);
