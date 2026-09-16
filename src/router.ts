import { createRouter, searchParams } from "sv-router";
import MonitorsTab from "./routes/MonitorsTab.svelte";
import HmsTab from "./routes/HmsTab.svelte";
import CollocationSitesTab from "./routes/CollocationSitesTab.svelte";

export const { route, navigate, p, isActive } = createRouter({
	"/": MonitorsTab,
	"/hms": HmsTab,
	"/collocation-sites": CollocationSitesTab
});

export { searchParams };
