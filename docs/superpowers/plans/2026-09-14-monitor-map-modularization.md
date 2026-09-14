# monitor-map Modularization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split `monitor-map`'s `MonitorMapLayout.svelte` into a generic, prop-configurable map shell plus a thin default wrapper, so `data-dashboard` (and future consumers) can embed the map with only the integrations/menu items they need, while the existing widget build and `v3-mobile` keep working unchanged.

**Architecture:** Extract the shell concerns that don't know about *which* integrations exist (load screen, panel resize/transition, the sv-router click escape-hatch) into a new `MapShell.svelte` that takes `integrations`, `ready`, `panelOpen`, `knownRoutes`, and `menu`/`overlays`/`children` snippets as props. `MonitorMapLayout.svelte` becomes a thin wrapper that calls `MapShell` with today's full integration list, full manager `.init()` calls, and full menu/overlay content — identical behavior, just relocated.

**Tech Stack:** Svelte 5 (runes), TypeScript, Tailwind CSS v4, `sv-router`, `@maptiler/sdk`. Repo: `/home/alex/workspace/sjvair/monitor-map`. No test framework is configured in this repo (confirmed in its `CLAUDE.md`) — verification is via `svelte-check`, `eslint`/`prettier`, production builds, and manual dev-server smoke checks, matching the project's existing convention.

**Spec:** `docs/superpowers/specs/2026-09-14-data-dashboard-v1-design.md` (section "monitor-map modularization")

## Global Constraints

- Tabs for indentation (not spaces); double quotes for strings; no trailing commas; 100-character print width (Prettier config in this repo).
- Svelte 5 runes only (`$state`, `$derived`/`$derived.by()`, `$effect`) — no legacy reactive statements (`$:`) or stores for component-local state.
- Tailwind CSS v4 utility classes; no new `<style>` blocks unless a Tailwind arbitrary-value class truly can't express the rule (matches existing `CLAUDE.md` guidance).
- No behavior change for existing consumers: the widget build (`npm run build`) and `v3-mobile`'s library import (`npm run build:lib`) must work with zero changes on their end.
- All commands below run from `/home/alex/workspace/sjvair/monitor-map`.

---

### Task 1: Extract `MapShell.svelte` and rewire `MonitorMapLayout.svelte` to use it

**Files:**
- Create: `src/lib/map/MapShell.svelte`
- Modify: `src/lib/MonitorMapLayout.svelte`

**Interfaces:**
- Produces: `MapShell` (default export of `src/lib/map/MapShell.svelte`), `MapShellProps` (exported interface from its `<script module>` block):
  ```ts
  export interface MapShellProps {
    integrations: Array<SomeMapIntegration>;
    ready: boolean;
    panelOpen: boolean;
    knownRoutes?: Array<string>;
    menu?: Snippet;
    overlays?: Snippet;
    children?: Snippet;
  }
  ```
- Consumes (all pre-existing, unchanged): `SomeMapIntegration` from `$lib/map/integrations/types`, `LoadScreen`/`disable as disableLoadScreen` from `$lib/LoadScreen.svelte`, `Map` from `$lib/map/Map.svelte`, `Menu` from `$lib/map/Menu.svelte`, `mapManager` from `$lib/map/map.svelte`, `useMonitorMapRouter` from `$lib/router-context`.

- [ ] **Step 1: Create `src/lib/map/MapShell.svelte`**

```svelte
<script lang="ts" module>
	import type { Snippet } from "svelte";
	import type { SomeMapIntegration } from "$lib/map/integrations/types";

	export interface MapShellProps {
		/** Map integrations to register, e.g. [monitorsMapIntegration] */
		integrations: Array<SomeMapIntegration>;
		/**
		 * True once the caller's own data managers have finished their initial
		 * load. The shell hides the load screen once the map is idle AND this
		 * is true.
		 */
		ready: boolean;
		/** True when the routed detail panel (`children`) should be visible */
		panelOpen: boolean;
		/**
		 * Path prefixes that are part of this map's own routed panel (e.g.
		 * [`${basePath}/monitor/`]) — internal navigation to these should not
		 * trigger the escape-hatch full-page navigation below.
		 */
		knownRoutes?: Array<string>;
		/** Rendered inside the display-options menu toggle */
		menu?: Snippet;
		/** Freeform absolutely-positioned content over the map (legend, search, etc.) */
		overlays?: Snippet;
		/** The routed detail panel content */
		children?: Snippet;
	}
</script>

<script lang="ts">
	import LoadScreen, { disable as disableLoadScreen } from "$lib/LoadScreen.svelte";
	import Map from "$lib/map/Map.svelte";
	import Menu from "$lib/map/Menu.svelte";
	import { mapManager } from "$lib/map/map.svelte";
	import { useMonitorMapRouter } from "$lib/router-context";

	let {
		integrations,
		ready,
		panelOpen,
		knownRoutes = [],
		menu,
		overlays,
		children
	}: MapShellProps = $props();

	const { basePath } = useMonitorMapRouter();
	const TRANSITION_MS = 300;

	$effect(() => {
		if (mapManager.map && ready) {
			mapManager.map.once("idle", () => disableLoadScreen());
		}
	});

	$effect(() => {
		if (panelOpen) {
			// Container width snapped to open; resize after layout settles
			requestAnimationFrame(() => mapManager.map?.resize());
		} else {
			// Container width snaps back after the transform transition ends
			setTimeout(() => mapManager.map?.resize(), TRANSITION_MS);
		}
	});

	/**
	 * HACK: Fix for escaping sv-router and allowing navigation to other pages,
	 * as well as navigating back
	 */
	const rootPath = basePath || "/";

	window.addEventListener("pageshow", (e) => {
		if (e.persisted) window.location.reload();
	});

	document.addEventListener(
		"click",
		(e) => {
			const anchor = e
				.composedPath()
				.find((el) => el instanceof HTMLAnchorElement) as HTMLAnchorElement;
			if (!anchor) return;
			const { pathname } = new URL(anchor.href);
			const isKnown = pathname === rootPath || knownRoutes.some((r) => pathname.startsWith(r));
			if (!isKnown) {
				e.stopImmediatePropagation();
				window.location.href = anchor.href;
			}
		},
		{ capture: true }
	);
</script>

<div class="relative flex h-full w-full flex-col md:flex-row">
	<LoadScreen />
	<div class="relative flex-1 overflow-hidden">
		<Map {integrations} />
		<div class="absolute top-4 left-4 z-10">
			<Menu>{@render menu?.()}</Menu>
		</div>
		{@render overlays?.()}
	</div>
	<div
		class={[
			"panel-containr w-full shrink-0 overflow-hidden",
			panelOpen ? "h-1/2 md:h-full md:w-1/3" : "md:w-0"
		]}
	>
		<div
			class={[
				"panel-contet h-full duration-300 ease-in-out",
				panelOpen
					? "translate-y-0 md:translate-x-0"
					: "translate-y-full md:translate-x-full md:translate-y-0"
			]}
		>
			{@render children?.()}
		</div>
	</div>
</div>
```

- [ ] **Step 2: Run the type checker to confirm the new file compiles**

Run: `npm run check`
Expected: No errors mentioning `MapShell.svelte` (pre-existing unrelated errors, if any, are out of scope for this task).

- [ ] **Step 3: Rewrite `src/lib/MonitorMapLayout.svelte` as a thin wrapper around `MapShell`**

Replace the entire file with:

```svelte
<script lang="ts">
	import type { Snippet } from "svelte";
	import { onDestroy } from "svelte";
	import MapShell from "$lib/map/MapShell.svelte";
	import MonitorsDisplayOptions from "$lib/monitors/components/MonitorsDisplayOptions.svelte";
	import MapLayersDisplayOptions from "$lib/components/MapLayersDisplayOptions.svelte";
	import MapStyleDisplayOptions from "$lib/map/MapStyleDisplayOptions.svelte";
	import { monitorsManager } from "$lib/monitors/monitors.svelte";
	import { monitorsMapIntegration } from "$lib/monitors/monitors-map-integration.svelte";
	import { windMapIntegration } from "$lib/wind/wind.svelte";
	import { baseLayerSeperator } from "$lib/map/integrations/base-layer-seperator";
	import type { SomeMapIntegration } from "$lib/map/integrations/types";
	import { collocationSitesManager } from "$lib/collocation-sites/collocations.svelte";
	import { collocationSitesMapIntegration } from "$lib/collocation-sites/collocations-map-integration.svelte";
	import EvStationsDisplayOptions from "$lib/ev-stations/components/EvStationsDisplayOptions.svelte";
	import { evStationsMapIntegration } from "$lib/ev-stations/ev-stations-map-integration.svelte";
	import { hmsManager } from "$lib/hms/hms.svelte";
	import { hmsFireMapIntegration } from "$lib/hms/hms-fire-map-integration.svelte";
	import { hmsSmokeMapIntegration } from "$lib/hms/hms-smoke-map-integration.svelte";
	import MapLegend from "$lib/MapLegend.svelte";
	import Search from "$lib/search/Search.svelte";
	import { searchParams } from "sv-router";
	import { useMonitorMapRouter } from "./router-context";

	interface Props {
		children: Snippet;
	}

	let { children }: Props = $props();

	const { route, navigate, basePath } = useMonitorMapRouter();

	const integrations: Array<SomeMapIntegration> = [
		baseLayerSeperator,
		collocationSitesMapIntegration,
		windMapIntegration,
		hmsSmokeMapIntegration,
		hmsFireMapIntegration,
		monitorsMapIntegration,
		evStationsMapIntegration
	];

	monitorsManager.init(route.search.pollutant);
	collocationSitesManager.init();
	hmsManager.init();
	monitorsMapIntegration.onMonitorClick = (id: string) => {
		navigate(`${basePath}/monitor/:id`, { params: { id } }).catch(console.error);
	};

	let panelOpen = $derived(route.pathname.startsWith(`${basePath}/monitor/`));

	// Keep monitorsManager.pollutant and the "pollutant" URL param in sync, both directions.
	// init() only seeds pollutant on the manager's first-ever initialization; this effect is what
	// applies a later "?pollutant=" change (e.g. navigating in from elsewhere) to an already-running manager.
	$effect(() => {
		const urlPollutant = route.search.pollutant;
		if (
			monitorsManager.initialized &&
			(urlPollutant === "pm25" || urlPollutant === "o3") &&
			monitorsManager.pollutant !== urlPollutant
		) {
			monitorsManager.pollutant = urlPollutant;
		}
	});

	// ...and the reverse: reflect UI-driven pollutant changes (e.g. the display-options toggle) back to the URL.
	$effect(() => {
		const pollutant = monitorsManager.pollutant;
		if (pollutant && searchParams.get("pollutant") !== pollutant) {
			searchParams.set("pollutant", pollutant);
		}
	});

	// Clear selected icon scale when the detail panel closes
	$effect(() => {
		if (panelOpen) return;
		monitorsMapIntegration.selectedMonitorId = null;
	});

	onDestroy(() => {
		monitorsManager.autoUpdate.stop();
	});
</script>

<MapShell
	{integrations}
	ready={monitorsManager.initialized}
	{panelOpen}
	knownRoutes={[`${basePath}/monitor/`]}
>
	{#snippet menu()}
		<MonitorsDisplayOptions />
		<EvStationsDisplayOptions />
		<MapLayersDisplayOptions />
		<MapStyleDisplayOptions />
	{/snippet}
	{#snippet overlays()}
		<div class="pointer-events-none absolute bottom-0 left-0 z-10">
			<MapLegend />
		</div>
		<div class="absolute top-4 left-20 z-10">
			<Search />
		</div>
	{/snippet}
	{@render children()}
</MapShell>
```

Note: `Search` moves from being nested inside the same positioning div as `Menu` (`top-4 left-4` then `left-16` relative to it) to its own sibling `absolute top-4 left-20 z-10` div, since it's no longer nested under `MapShell`'s internal menu wrapper. This is visually equivalent (still top-aligned with the menu button, offset to its right) but is no longer coupled to `MapShell`'s internal DOM structure.

- [ ] **Step 4: Run the type checker again**

Run: `npm run check`
Expected: No new errors compared to Step 2's baseline.

- [ ] **Step 5: Run lint/format check**

Run: `npm run lint`
Expected: Passes, or only pre-existing failures unrelated to `MapShell.svelte`/`MonitorMapLayout.svelte`. If it flags formatting in either file, run `npm run format` and re-check.

- [ ] **Step 6: Manual smoke test in the dev server**

Run: `npm run dev`, open the printed local URL, and verify against this checklist (this is the full feature set `MonitorMapLayout` renders, unchanged from before the refactor):
- Load screen appears briefly, then disappears once the map and monitors have loaded.
- Map shows monitor markers; clicking one opens the detail panel (slides in from the right on desktop / up from the bottom on mobile-width viewport), and the map resizes correctly after the panel opens/closes.
- The display-options menu (top-left toggle button) opens and shows Monitors, EV Stations, Map Layers, and Map Style options; toggling the pollutant option updates the URL's `?pollutant=` param and vice versa (edit the URL param directly and confirm the UI updates).
- The map legend renders bottom-left; the search box renders top-left next to the menu button and returns results.
- Browser back/forward navigation between the map and a monitor detail panel works without a full page reload; navigating to a link outside the map's own routes (e.g. an external link if present) still does a full navigation.

Expected: All items behave identically to how they did before this refactor (behavior must be unchanged — only the internal component structure changed).

- [ ] **Step 7: Commit**

```bash
cd /home/alex/workspace/sjvair/monitor-map
git add src/lib/map/MapShell.svelte src/lib/MonitorMapLayout.svelte
git commit -m "Extract MapShell as a configurable map layout primitive"
```

---

### Task 2: Export `MapShell` from the public API and document it

**Files:**
- Modify: `src/lib/index.ts`
- Modify: `CLAUDE.md`

**Interfaces:**
- Consumes: `MapShell`, `MapShellProps` from Task 1.
- Produces: `@sjvair/monitor-map` now publicly exports `MapShell` and `MapShellProps`, for `data-dashboard` (and any future consumer) to compose custom map layouts against.

- [ ] **Step 1: Add the export to `src/lib/index.ts`**

In the `// Components` section (alongside the existing `export { default as Map } from "./map/Map.svelte";` line), add:

```ts
export { default as MapShell, type MapShellProps } from "./map/MapShell.svelte";
```

- [ ] **Step 2: Run the type checker**

Run: `npm run check`
Expected: No errors.

- [ ] **Step 3: Add a "Modularization" section to `CLAUDE.md`**

Under the existing `## Architecture Overview` section, after the "Integration Plugin System" subsection, add:

```markdown
### Modularization: `MapShell` vs `MonitorMapLayout`

`MonitorMapLayout` (used by `monitorMapRoutes`) is a **thin, opinionated
wrapper** around `MapShell` that wires up every integration, every manager,
and the full display-options menu — this is what the widget build and
`v3-mobile` use today, unchanged.

`MapShell` is the **generic primitive** underneath it: it owns only layout
concerns that don't know which integrations exist (load screen, panel
resize/transition, the sv-router click escape-hatch) and takes
`integrations`, `ready`, `panelOpen`, `knownRoutes`, and `menu`/`overlays`/
`children` snippets as props. A host that wants a reduced feature set (e.g.
only the monitors integration, no EV stations/wind/HMS) should compose
`MapShell` directly instead of going through `monitorMapRoutes`/
`MonitorMapLayout` — see `src/lib/MonitorMapLayout.svelte` itself as the
reference example of how to wire a manager, an integration list, and menu/
overlay content into it.
```

- [ ] **Step 4: Build both distributables to confirm existing consumers are unaffected**

Run: `npm run build` (widget build) and `npm run build:lib` (library build for `v3-mobile`)
Expected: Both succeed with no errors. `npm run build:lib`'s output (`dist/lib`) should include the new `map/MapShell.svelte` (and its `.d.ts`) alongside the unchanged `MonitorMapLayout.svelte`.

- [ ] **Step 5: Commit**

```bash
cd /home/alex/workspace/sjvair/monitor-map
git add src/lib/index.ts CLAUDE.md
git commit -m "Export MapShell and document the modularization split"
```
