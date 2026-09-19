<!-- src/routes/MonitorsTab.svelte -->
<script lang="ts">
	import { onMount } from "svelte";
	import { endOfMonth, format, startOfMonth } from "date-fns";
	import {
		MapShell,
		mapManager,
		monitorsMapIntegration as defaultMonitorsMapIntegration,
		MonitorsMapIntegration
	} from "@sjvair/monitor-map";
	import type { RegionType } from "@sjvair/sdk";
	import Calendar from "$lib/components/Calendar.svelte";
	import RegionCheckboxList from "$lib/components/RegionCheckboxList.svelte";
	import { Button } from "$lib/components/ui/button/index.js";
	import * as Select from "$lib/components/ui/select/index.js";
	import { type Bounds, unionBounds } from "$lib/monitors/region-bounds";
	import {
		decodeMonth,
		decodePollutant,
		decodeRegionSelection,
		decodeRegionType,
		decodeYear,
		encodeMonth,
		encodePollutant,
		encodeRegionSelection,
		encodeRegionType,
		encodeYear,
		type MonitorsPollutantParam
	} from "$lib/url-state";
	import { route, searchParams } from "../router";
	import { monitorsTabManager } from "./monitors/monitors-tab.svelte";

	const manager = monitorsTabManager;
	const mapIntegration = new MonitorsMapIntegration(manager);
	mapIntegration.clustered = false;
	mapIntegration.tooltipManager.enabled = false;

	// @sjvair/monitor-map exports a module-level default MonitorsMapIntegration
	// singleton (constructed as a side effect of importing anything from the
	// package) that self-applies onto the shared map as soon as it exists,
	// independent of the mapIntegration instance we construct and pass to
	// MapShell above. Left alone, it collides with ours on the same "monitors"
	// layer id with its own (default: tooltip-enabled) TooltipManager, so it
	// needs the same overrides.
	defaultMonitorsMapIntegration.clustered = false;
	defaultMonitorsMapIntegration.tooltipManager.enabled = false;

	const MONTH_NAMES = [
		"January",
		"February",
		"March",
		"April",
		"May",
		"June",
		"July",
		"August",
		"September",
		"October",
		"November",
		"December"
	];

	const CATEGORIES = ["administrative", "census", "district"] as const;

	function currentYearMonth(): { year: number; month: number } {
		const now = new Date();
		return { year: now.getFullYear(), month: now.getMonth() + 1 };
	}

	function monthRange(year: number, month: number) {
		const first = startOfMonth(new Date(year, month - 1, 1));
		const last = endOfMonth(first);
		return {
			start: format(first, "yyyy-MM-dd"),
			end: format(last, "yyyy-MM-dd")
		};
	}

	// Whether pruning a child selection against a fresh refreshChildren() call
	// could possibly change what's currently shown -- true only if some child
	// type actually has a selection right now. Used to decide whether the map/
	// calendar/fill refresh needs to wait for refreshChildren() to finish
	// (correctness: don't briefly show a now-out-of-scope child region) or can
	// run concurrently with it (the common case: nothing to prune, so there's
	// no reason to block the map behind refreshChildren()'s 8 parallel
	// per-type fetches, which can take several seconds on their own).
	function hasAnyChildSelection(): boolean {
		return manager.childTypes.some(
			(type) => (manager.childSelectionsByType.get(type)?.size ?? 0) > 0
		);
	}

	// Writes the parentType/parent/<child-type> query params from the
	// manager's current state. Called after any action that can change
	// parent or child selections, since a parent-selection change prunes
	// child selections too (see MonitorsTabManager.refreshChildren) and the
	// URL needs to reflect the post-prune result, not just the action that
	// triggered it.
	function syncSelectionToUrl() {
		searchParams.set("parentType", encodeRegionType(manager.parentType), { replace: true });
		searchParams.set("parent", encodeRegionSelection(manager.parentSelection), { replace: true });
		for (const type of manager.childTypes) {
			const selection = manager.childSelectionsByType.get(type) ?? new Set<string>();
			if (selection.size > 0) {
				searchParams.set(type, encodeRegionSelection(selection), { replace: true });
			} else {
				searchParams.delete(type, undefined, { replace: true });
			}
		}
		// The current parentType's own param key can be left over from a
		// previous session where it was a child type (its selection was tracked
		// under its own key rather than "parent") — it's excluded from
		// childTypes above (childTypes is every in-scope type EXCEPT the
		// parent), so the loop never reaches it and it needs an explicit delete.
		searchParams.delete(manager.parentType, undefined, { replace: true });
	}

	onMount(async () => {
		await manager.init();

		// route.search values come from sv-router, which parses numeric-looking query
		// values (e.g. "?year=2026") into a JS number rather than a string — each
		// decode* function already accepts string | number | boolean, so pass its raw
		// value straight through rather than pre-filtering to strings only.
		const urlYear = decodeYear(route.search.year);
		const urlMonth = decodeMonth(route.search.month);
		const urlPollutant = decodePollutant(route.search.pollutant);
		const urlParentType = decodeRegionType(route.search.parentType);
		const urlParentSelection = decodeRegionSelection(route.search.parent);

		const defaults = currentYearMonth();
		const year = urlYear ?? defaults.year;
		const month = urlMonth ?? defaults.month;
		const pollutant = urlPollutant ?? "pm25";
		const parentType = (urlParentType as RegionType | null) ?? "county";

		manager.dateRange = monthRange(year, month);
		manager.pollutant = pollutant;

		if (parentType !== manager.parentType) {
			manager.parentType = parentType;
			// Reset before checking the URL for an explicit override below —
			// otherwise a URL with a new parentType but no `parent` param would
			// leave manager.init()'s "all counties" selection stuck on the new
			// parentType, which is wrong for any type other than county.
			manager.parentSelection = new Set();
			await manager.refreshParentRegions();
		}
		if (urlParentSelection.size > 0) {
			manager.parentSelection = urlParentSelection;
		}
		// If `parent` was absent from the URL and parentType is still the
		// default "county", manager.init() already seeded "all counties".

		// Child-type selections from the URL, applied per type using that
		// type's own query param name — refreshChildren() below fetches each
		// child type's narrowed list and prunes these against it, so a
		// bookmarked child selection that doesn't actually fall within the
		// bookmarked parent selection is correctly dropped, not kept.
		for (const type of manager.childTypes) {
			const urlChildSelection = decodeRegionSelection(route.search[type]);
			if (urlChildSelection.size > 0) {
				manager.childSelectionsByType.set(type, urlChildSelection);
			}
		}

		if (!urlYear) searchParams.set("year", encodeYear(year), { replace: true });
		if (!urlMonth) searchParams.set("month", encodeMonth(month), { replace: true });
		if (!urlPollutant) searchParams.set("pollutant", encodePollutant(pollutant), { replace: true });

		if (hasAnyChildSelection()) {
			// A bookmarked URL supplied a child selection that might not actually
			// fall within the bookmarked parent selection -- refreshChildren()'s
			// pruning must resolve before the map/calendar/fill refresh runs, or
			// it could briefly render a region that gets pruned a moment later.
			await manager.refreshChildren();
			syncSelectionToUrl();
			await Promise.all([
				manager.refreshMapAverages(),
				manager.refreshCalendar(),
				manager.refreshRegionFill()
			]);
		} else {
			syncSelectionToUrl();
			await Promise.all([
				manager.refreshChildren(),
				manager.refreshMapAverages(),
				manager.refreshCalendar(),
				manager.refreshRegionFill()
			]);
		}
	});

	async function handleParentTypeChange(value: string | undefined) {
		if (!value) return;
		await manager.setParentType(value as RegionType);
		syncSelectionToUrl();
	}

	async function handleParentToggle(regionId: string) {
		manager.toggleParentRegion(regionId);

		if (hasAnyChildSelection()) {
			// A selected child region could fall outside the new parent scope --
			// refreshChildren()'s pruning must resolve before the map/calendar/
			// fill refresh runs, or it could briefly show a now-out-of-scope
			// region (see the spec's "Selection pruning" section).
			await manager.refreshChildren();
			syncSelectionToUrl();
			await Promise.all([
				manager.refreshMapAverages(),
				manager.refreshCalendar(),
				manager.refreshRegionFill()
			]);
		} else {
			// Nothing selected in any child type, so refreshChildren()'s pruning
			// step has nothing to affect -- run it concurrently with the map
			// update instead of blocking behind it. refreshChildren() exists to
			// keep the (currently all-collapsed) child checkbox lists narrowed
			// correctly, which has no bearing on what the map should show right
			// now.
			syncSelectionToUrl();
			await Promise.all([
				manager.refreshChildren(),
				manager.refreshMapAverages(),
				manager.refreshCalendar(),
				manager.refreshRegionFill()
			]);
		}
	}

	async function handleChildToggle(type: RegionType, regionId: string) {
		manager.toggleChildRegion(type, regionId);
		syncSelectionToUrl();
		await Promise.all([
			manager.refreshMapAverages(),
			manager.refreshCalendar(),
			manager.refreshRegionFill()
		]);
	}

	async function handlePollutantChange(pollutant: MonitorsPollutantParam) {
		manager.pollutant = pollutant;
		searchParams.set("pollutant", encodePollutant(pollutant), { replace: true });
		await Promise.all([
			manager.refreshMapAverages(),
			manager.refreshCalendar(),
			manager.refreshRegionFill()
		]);
	}

	async function handleYearMonthChange(year: number, month: number) {
		const nextRange = monthRange(year, month);
		manager.dateRange = nextRange;
		searchParams.set("year", encodeYear(year), { replace: true });
		searchParams.set("month", encodeMonth(month), { replace: true });
		await Promise.all([
			manager.refreshMapAverages(),
			manager.refreshCalendar(),
			manager.refreshRegionFill()
		]);
	}

	async function handleYearChange(value: string | undefined) {
		if (!value) return;
		await handleYearMonthChange(Number(value), selectedMonth);
	}

	async function handleMonthChange(value: string | undefined) {
		if (!value) return;
		await handleYearMonthChange(selectedYear, Number(value));
	}

	let selectedYear = $derived(Number(manager.dateRange.start.slice(0, 4)));
	let selectedMonth = $derived(Number(manager.dateRange.start.slice(5, 7)));
	let yearOptions = $derived.by(() => {
		const current = currentYearMonth().year;
		return Array.from({ length: 5 }, (_, i) => current - i);
	});

	// Zod's tuple inference types `RegionBoundary.bbox` as
	// `[number, number, number, number, ...unknown[]]` rather than a clean
	// 4-tuple, even though the schema (and the server) always sends exactly
	// 4 numbers. Also, reading it off manager state (a `$state` array) hands
	// back a Svelte reactive Proxy wrapping the array, not a plain array —
	// MapLibre's bounds parsing doesn't handle that correctly, so
	// `$state.snapshot()` unwraps it into a real array before we hand it off.
	function toBounds(bbox: unknown): Bounds {
		return $state.snapshot(bbox) as Bounds;
	}

	// Pan/zoom the map to the union of every selected region's bounds
	// (parent + all children), or back out to cover the full parent list
	// when nothing is selected anywhere. Re-runs whenever the selection
	// changes and also once the map itself becomes ready (mapManager.map is
	// reactive), so it self-corrects if this effect ran before the map
	// finished initializing.
	$effect(() => {
		if (!mapManager.map) return;

		const targetRegions =
			manager.selectedRegions.length > 0 ? manager.selectedRegions : (manager.parentRegions ?? []);

		const allBounds = targetRegions
			.map((region) => region.boundary?.bbox)
			.filter((bbox) => bbox != null)
			.map(toBounds);
		const bounds = unionBounds(allBounds);
		if (bounds) {
			mapManager.map.fitBounds(bounds, { padding: 40 });
		}
	});

	// MapShell only calls map.resize() for its own internal panel transition,
	// not for host-driven layout changes -- the map's flex-1 wrapper here
	// grows/shrinks depending on whether the calendar block below it is
	// present, and without an explicit resize() after that, MapLibre's canvas
	// keeps stale internal dimensions and renders against the wrong bounds.
	let mapWrapper: HTMLDivElement | undefined = $state();

	$effect(() => {
		if (!mapWrapper) return;

		const observer = new ResizeObserver(() => {
			mapManager.map?.resize();
		});
		observer.observe(mapWrapper);

		return () => observer.disconnect();
	});

	const REGION_FILL_SOURCE_ID = "region-fill";
	const REGION_FILL_LAYER_ID = "region-fill-polygons";
	const REGION_FILL_BORDER_LAYER_ID = "region-fill-border";

	// Fill each selected region (parent or any child type) with a
	// semi-transparent version of its monthly average's level color — no
	// fill at all when nothing is selected anywhere (manager.regionFillColors
	// already reflects that scoping, computed in
	// MonitorsTabManager.refreshRegionFill()). A solid-color border (same
	// color as the fill, full opacity) traces each filled region so its
	// boundary stays legible against neighbors.
	$effect(() => {
		if (!mapManager.map) return;

		if (!mapManager.map.getSource(REGION_FILL_SOURCE_ID)) {
			mapManager.map.addSource(REGION_FILL_SOURCE_ID, {
				type: "geojson",
				data: { type: "FeatureCollection", features: [] }
			});
			mapManager.map.addLayer({
				id: REGION_FILL_LAYER_ID,
				type: "fill",
				source: REGION_FILL_SOURCE_ID,
				paint: {
					"fill-color": ["get", "color"],
					"fill-opacity": 0.35
				}
			});
			mapManager.map.addLayer({
				id: REGION_FILL_BORDER_LAYER_ID,
				type: "line",
				source: REGION_FILL_SOURCE_ID,
				paint: {
					"line-color": ["get", "color"],
					"line-width": 2
				}
			});
		}

		const colors = manager.regionFillColors;
		const features = manager.selectedRegions.flatMap((region) => {
			const color = colors?.get(region.id);
			if (!color || !region.boundary?.geometry) return [];
			return [
				{
					type: "Feature" as const,
					properties: { color },
					geometry: $state.snapshot(region.boundary.geometry)
				}
			];
		});

		mapManager.setDataSource(REGION_FILL_SOURCE_ID, features);
	});
</script>

<div class="flex h-full flex-col gap-4 p-4">
	<div class="flex flex-wrap items-center gap-4">
		<div class="flex items-center gap-2" role="radiogroup" aria-label="Pollutant">
			<Button
				variant={manager.pollutant === "pm25" ? "default" : "outline"}
				size="sm"
				aria-pressed={manager.pollutant === "pm25"}
				onclick={() => handlePollutantChange("pm25")}
			>
				PM2.5
			</Button>
			<Button
				variant={manager.pollutant === "o3" ? "default" : "outline"}
				size="sm"
				aria-pressed={manager.pollutant === "o3"}
				onclick={() => handlePollutantChange("o3")}
			>
				Ozone
			</Button>
		</div>

		<Select.Root type="single" value={String(selectedYear)} onValueChange={handleYearChange}>
			<Select.Trigger class="w-28">{selectedYear}</Select.Trigger>
			<Select.Content>
				{#each yearOptions as year (year)}
					<Select.Item value={String(year)} label={String(year)}>{year}</Select.Item>
				{/each}
			</Select.Content>
		</Select.Root>

		<Select.Root type="single" value={String(selectedMonth)} onValueChange={handleMonthChange}>
			<Select.Trigger class="w-36">{MONTH_NAMES[selectedMonth - 1]}</Select.Trigger>
			<Select.Content>
				{#each MONTH_NAMES as name, index (name)}
					<Select.Item value={String(index + 1)} label={name}>{name}</Select.Item>
				{/each}
			</Select.Content>
		</Select.Root>

		<Select.Root type="single" value={manager.parentType} onValueChange={handleParentTypeChange}>
			<Select.Trigger class="w-56">
				{manager.regionTypes?.type(manager.parentType)?.label ?? manager.parentType}
			</Select.Trigger>
			<Select.Content>
				{#each CATEGORIES as category (category)}
					<Select.Group>
						<Select.GroupHeading class="text-muted-foreground px-2 text-xs uppercase">
							{category}
						</Select.GroupHeading>
						{#each manager.regionTypes?.asIter.types.filter((t) => t.category === category) ?? [] as regionType (regionType.type)}
							<Select.Item value={regionType.type} label={regionType.label}>
								{regionType.label}
							</Select.Item>
						{/each}
					</Select.Group>
				{/each}
			</Select.Content>
		</Select.Root>
	</div>

	<RegionCheckboxList
		regions={manager.parentRegions ?? []}
		selected={manager.parentSelection}
		onToggle={handleParentToggle}
	/>

	<div class="flex flex-col gap-4">
		{#each CATEGORIES as category (category)}
			{@const typesInCategory = manager.childTypes.filter(
				(type) => manager.regionTypes?.type(type)?.category === category
			)}
			{#if typesInCategory.length > 0}
				<div>
					<h3 class="text-muted-foreground mb-1 text-xs uppercase">{category}</h3>
					<div class="flex flex-col gap-2">
						{#each typesInCategory as type (type)}
							{@const childRegions = manager.childRegionsByType.get(type) ?? []}
							{@const childSelection = manager.childSelectionsByType.get(type) ?? new Set()}
							<details open={childSelection.size > 0}>
								<summary class="cursor-pointer text-sm font-medium">
									{manager.regionTypes?.type(type)?.label ?? type}
									{#if childSelection.size > 0}
										({childSelection.size} selected)
									{/if}
								</summary>
								<div class="mt-2 pl-4">
									<RegionCheckboxList
										regions={childRegions}
										selected={childSelection}
										onToggle={(id) => handleChildToggle(type, id)}
									/>
								</div>
							</details>
						{/each}
					</div>
				</div>
			{/if}
		{/each}
	</div>

	{#if manager.lastError}
		<p class="text-destructive text-sm">{manager.lastError}</p>
	{/if}

	<!-- min-h-[400px] (not min-h-0) since this container's flex parent no longer has a
		bounded height once the region checkbox lists and per-region calendar grid below can
		both grow past the viewport — without a floor, "flex-1" computes its size against an
		unconstrained container and collapses the map to 0 instead of giving it real screen
		space. The page scrolls as a whole (via the app shell's <main class="overflow-auto">)
		once content exceeds the viewport, rather than trying to keep the map pinned in a
		fixed-height layout. -->
	<div class="min-h-[400px] flex-1" bind:this={mapWrapper}>
		<MapShell
			integrations={[mapIntegration]}
			ready={manager.initialized}
			panelOpen={false}
			routerEscapeHatch={false}
		/>
	</div>

	{#if manager.regionCalendars}
		<div class="flex flex-row flex-wrap gap-6">
			{#each manager.regionCalendars as { region, days } (region.id)}
				<div>
					<h3 class="mb-1 text-sm font-medium">{region.name}</h3>
					<Calendar {days} />
				</div>
			{/each}
		</div>
	{/if}
</div>
