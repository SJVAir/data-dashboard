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
	import { shouldNarrow, unionOfOtherTypeSelections } from "$lib/monitors/region-narrowing";
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

	onMount(async () => {
		await manager.init();

		// route.search values come from sv-router, which parses numeric-looking query
		// values (e.g. "?year=2026") into a JS number rather than a string — each
		// decode* function already accepts string | number | boolean, so pass its raw
		// value straight through rather than pre-filtering to strings only.
		const urlYear = decodeYear(route.search.year);
		const urlMonth = decodeMonth(route.search.month);
		const urlPollutant = decodePollutant(route.search.pollutant);
		const urlRegionType = decodeRegionType(route.search.regionType);
		const urlRegions = decodeRegionSelection(route.search.regions);

		// localStorage-backed month preference is temporarily disabled (URL-only
		// fallback to the current month) while we're testing — re-add
		// `prefs.month?.year`/`prefs.month?.month` as a fallback before `defaults`
		// once that's ready to come back.
		const defaults = currentYearMonth();
		const year = urlYear ?? defaults.year;
		const month = urlMonth ?? defaults.month;
		const pollutant = urlPollutant ?? "pm25";
		const regionType = (urlRegionType as RegionType | null) ?? "county";

		manager.dateRange = monthRange(year, month);
		manager.pollutant = pollutant;

		if (regionType !== manager.selectedRegionType) {
			manager.selectedRegionType = regionType;
			await manager.refreshActiveRegions();
		}
		if (urlRegions.size > 0) {
			manager.regionSelections.set(regionType, urlRegions);
		}
		// If `regions` was absent from the URL, manager.init() already seeded
		// "all counties selected" as the default for the county type.

		if (!urlYear) {
			searchParams.set("year", encodeYear(year), { replace: true });
		}
		if (!urlMonth) {
			searchParams.set("month", encodeMonth(month), { replace: true });
		}
		if (!urlPollutant) {
			searchParams.set("pollutant", encodePollutant(pollutant), { replace: true });
		}
		if (!urlRegionType) {
			searchParams.set("regionType", encodeRegionType(regionType), { replace: true });
		}

		await Promise.all([
			manager.refreshMapAverages(),
			manager.refreshCalendar(),
			manager.refreshRegionFill()
		]);
	});

	async function handleRegionTypeChange(value: string | undefined) {
		if (!value) return;
		await manager.setRegionType(value as RegionType);
		searchParams.set("regionType", encodeRegionType(value), { replace: true });
		searchParams.set("regions", encodeRegionSelection(manager.selectedRegionIds), {
			replace: true
		});
	}

	async function handleRegionToggle(regionId: string) {
		manager.toggleRegion(regionId);
		searchParams.set("regions", encodeRegionSelection(manager.selectedRegionIds), {
			replace: true
		});
		await Promise.all([
			manager.refreshMapAverages(),
			manager.refreshCalendar(),
			manager.refreshRegionFill()
		]);
	}

	async function handleShowAll() {
		manager.disableNarrowing(manager.selectedRegionType);
		await manager.refreshActiveRegions();
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
		// localStorage-backed month preference write disabled for now — see onMount.
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
	// 4 numbers. Also, reading it off `manager.activeRegions` (a `$state`
	// array) hands back a Svelte reactive Proxy wrapping the array, not a
	// plain array — MapLibre's bounds parsing doesn't handle that correctly,
	// so `$state.snapshot()` unwraps it into a real array before we hand it
	// off.
	function toBounds(bbox: unknown): Bounds {
		return $state.snapshot(bbox) as Bounds;
	}

	// Pan/zoom the map to the union of every selected region's bounds, or back
	// out to cover every active region when none is selected. Re-runs
	// whenever the selection or the active region list changes, and also once
	// the map itself becomes ready (mapManager.map is reactive), so it
	// self-corrects if this effect ran before the map finished initializing.
	$effect(() => {
		if (!mapManager.map || !manager.activeRegions) return;

		const selectedIds = manager.selectedRegionIds;
		const targetRegions =
			selectedIds.size > 0
				? manager.activeRegions.filter((r) => selectedIds.has(r.id))
				: manager.activeRegions;

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

	// Fill each selected region with a semi-transparent version of its monthly
	// average's level color — no fill at all when nothing is selected
	// (manager.regionFillColors already reflects that scoping, computed in
	// MonitorsTabManager.refreshRegionFill()).
	// A solid-color border (same color as the fill, full opacity) traces
	// each filled region so its boundary stays legible against neighbors.
	$effect(() => {
		if (!mapManager.map || !manager.activeRegions) return;

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

		const regions = manager.activeRegions;
		const colors = manager.regionFillColors;
		const entries = colors ? Array.from(colors.entries()) : [];
		const features = entries.flatMap(([regionId, color]) => {
			const region = regions.find((r) => r.id === regionId);
			if (!region?.boundary?.geometry) return [];
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

		<Select.Root
			type="single"
			value={manager.selectedRegionType}
			onValueChange={handleRegionTypeChange}
		>
			<Select.Trigger class="w-56">
				{manager.regionTypes?.type(manager.selectedRegionType)?.label ?? manager.selectedRegionType}
			</Select.Trigger>
			<Select.Content>
				{#each ["administrative", "census", "district"] as category (category)}
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

	{#if shouldNarrow(manager.regionSelections, manager.selectedRegionType, manager.narrowingEnabled)}
		{@const otherIds = unionOfOtherTypeSelections(
			manager.regionSelections,
			manager.selectedRegionType
		)}
		{@const otherNames = (manager.activeRegions ?? [])
			.filter((r) => otherIds.has(r.id))
			.map((r) => r.name)
			.join(", ")}
		<p class="text-muted-foreground text-sm">
			Showing regions within: {otherNames || `${otherIds.size} region(s)`}
			<Button variant="link" size="sm" onclick={handleShowAll}>show all</Button>
		</p>
	{/if}

	<RegionCheckboxList
		regions={manager.activeRegions ?? []}
		selected={manager.selectedRegionIds}
		onToggle={handleRegionToggle}
	/>

	<!-- min-h-[400px] (not min-h-0) since this container's flex parent no longer has a
		bounded height once the region checkbox list and per-region calendar grid below can
		both grow past the viewport (previously only a single optional calendar sat here) —
		without a floor, "flex-1" computes its size against an unconstrained container and
		collapses the map to 0 instead of giving it real screen space. The page scrolls as a
		whole (via the app shell's <main class="overflow-auto">) once content exceeds the
		viewport, rather than trying to keep the map pinned in a fixed-height layout. -->
	{#if manager.lastError}
		<p class="text-destructive text-sm">{manager.lastError}</p>
	{/if}

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
