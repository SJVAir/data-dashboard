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
		"*": NotFound
	},
	{ base: "/workspace" }
);
