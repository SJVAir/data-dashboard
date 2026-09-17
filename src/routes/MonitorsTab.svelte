<!-- src/routes/MonitorsTab.svelte -->
<script lang="ts">
	import { onMount } from "svelte";
	import { endOfMonth, format, startOfMonth } from "date-fns";
	import { MapShell, mapManager, MonitorsMapIntegration } from "@sjvair/monitor-map";
	import Calendar from "$lib/components/Calendar.svelte";
	import { Button } from "$lib/components/ui/button/index.js";
	import * as Select from "$lib/components/ui/select/index.js";
	import { type Bounds, unionBounds } from "$lib/monitors/region-bounds";
	import {
		decodeCounty,
		decodeMonth,
		decodePollutant,
		decodeYear,
		encodeCounty,
		encodeMonth,
		encodePollutant,
		encodeYear,
		type MonitorsPollutantParam
	} from "$lib/url-state";
	import { route, searchParams } from "../router";
	import { monitorsTabManager } from "./monitors/monitors-tab.svelte";

	const manager = monitorsTabManager;
	const mapIntegration = new MonitorsMapIntegration(manager);

	// Sentinel value for the county Select's "All counties" item — bits-ui's Select
	// doesn't accept an empty string as an item value, so a real county id can never
	// collide with this.
	const ALL_COUNTIES_VALUE = "all";

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
		const urlCounty = decodeCounty(route.search.county);

		// localStorage-backed month preference is temporarily disabled (URL-only
		// fallback to the current month) while we're testing — re-add
		// `prefs.month?.year`/`prefs.month?.month` as a fallback before `defaults`
		// once that's ready to come back.
		const defaults = currentYearMonth();
		const year = urlYear ?? defaults.year;
		const month = urlMonth ?? defaults.month;
		const pollutant = urlPollutant ?? "pm25";

		manager.dateRange = monthRange(year, month);
		manager.pollutant = pollutant;
		manager.selectedCountyId = urlCounty;

		if (!urlYear) {
			searchParams.set("year", encodeYear(year), { replace: true });
		}
		if (!urlMonth) {
			searchParams.set("month", encodeMonth(month), { replace: true });
		}
		if (!urlPollutant) {
			searchParams.set("pollutant", encodePollutant(pollutant), { replace: true });
		}

		await Promise.all([
			manager.refreshMapAverages(),
			manager.refreshCalendar(),
			manager.refreshCountyFill()
		]);
	});

	async function handleCountyChange(value: string | undefined) {
		const regionId = value && value !== ALL_COUNTIES_VALUE ? value : null;
		manager.selectedCountyId = regionId;
		searchParams.set("county", regionId ? encodeCounty(regionId) : "", { replace: true });
		await Promise.all([
			manager.refreshMapAverages(),
			manager.refreshCalendar(),
			manager.refreshCountyFill()
		]);
	}

	async function handlePollutantChange(pollutant: MonitorsPollutantParam) {
		manager.pollutant = pollutant;
		searchParams.set("pollutant", encodePollutant(pollutant), { replace: true });
		await Promise.all([
			manager.refreshMapAverages(),
			manager.refreshCalendar(),
			manager.refreshCountyFill()
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
			manager.refreshCountyFill()
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

	let selectedCountyName = $derived(
		manager.counties?.find((county) => county.id === manager.selectedCountyId)?.name ??
			"All counties"
	);

	// Zod's tuple inference types `RegionBoundary.bbox` as
	// `[number, number, number, number, ...unknown[]]` rather than a clean
	// 4-tuple, even though the schema (and the server) always sends exactly
	// 4 numbers. Also, reading it off `manager.counties` (a `$state` array)
	// hands back a Svelte reactive Proxy wrapping the array, not a plain
	// array — MapLibre's bounds parsing doesn't handle that correctly, so
	// `$state.snapshot()` unwraps it into a real array before we hand it off.
	function toBounds(bbox: unknown): Bounds {
		return $state.snapshot(bbox) as Bounds;
	}

	// Pan/zoom the map to the selected county's bounds, or back out to cover
	// every county when none is selected. Re-runs whenever the selection or
	// the county list changes, and also once the map itself becomes ready
	// (mapManager.map is reactive), so it self-corrects if this effect ran
	// before the map finished initializing.
	$effect(() => {
		if (!mapManager.map || !manager.counties) return;

		if (manager.selectedCountyId) {
			const region = manager.counties.find((county) => county.id === manager.selectedCountyId);
			if (region?.boundary?.bbox) {
				mapManager.map.fitBounds(toBounds(region.boundary.bbox), { padding: 40 });
			}
			return;
		}

		const allBounds = manager.counties
			.map((county) => county.boundary?.bbox)
			.filter((bbox) => bbox != null)
			.map(toBounds);
		const bounds = unionBounds(allBounds);
		if (bounds) {
			mapManager.map.fitBounds(bounds, { padding: 40 });
		}
	});

	const COUNTY_FILL_SOURCE_ID = "county-fill";
	const COUNTY_FILL_LAYER_ID = "county-fill-polygons";
	const COUNTY_FILL_BORDER_LAYER_ID = "county-fill-border";

	// Fill each county with a semi-transparent version of its monthly
	// average's level color — every county when none is selected, only the
	// selected one otherwise (manager.countyFillColors already reflects
	// that scoping, computed in MonitorsTabManager.refreshCountyFill()).
	// A solid-color border (same color as the fill, full opacity) traces
	// each filled county so its boundary stays legible against neighbors.
	$effect(() => {
		if (!mapManager.map || !manager.counties) return;

		if (!mapManager.map.getSource(COUNTY_FILL_SOURCE_ID)) {
			mapManager.map.addSource(COUNTY_FILL_SOURCE_ID, {
				type: "geojson",
				data: { type: "FeatureCollection", features: [] }
			});
			mapManager.map.addLayer({
				id: COUNTY_FILL_LAYER_ID,
				type: "fill",
				source: COUNTY_FILL_SOURCE_ID,
				paint: {
					"fill-color": ["get", "color"],
					"fill-opacity": 0.35
				}
			});
			mapManager.map.addLayer({
				id: COUNTY_FILL_BORDER_LAYER_ID,
				type: "line",
				source: COUNTY_FILL_SOURCE_ID,
				paint: {
					"line-color": ["get", "color"],
					"line-width": 2
				}
			});
		}

		const counties = manager.counties;
		const colors = manager.countyFillColors;
		const entries = colors ? Array.from(colors.entries()) : [];
		const features = entries.flatMap(([regionId, color]) => {
			const county = counties.find((c) => c.id === regionId);
			if (!county?.boundary?.geometry) return [];
			return [
				{
					type: "Feature" as const,
					properties: { color },
					geometry: $state.snapshot(county.boundary.geometry)
				}
			];
		});

		mapManager.setDataSource(COUNTY_FILL_SOURCE_ID, features);
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
			value={manager.selectedCountyId ?? ALL_COUNTIES_VALUE}
			onValueChange={handleCountyChange}
		>
			<Select.Trigger class="w-56">{selectedCountyName}</Select.Trigger>
			<Select.Content>
				<Select.Item value={ALL_COUNTIES_VALUE} label="All counties">All counties</Select.Item>
				{#each manager.counties ?? [] as county (county.id)}
					<Select.Item value={county.id} label={county.name}>{county.name}</Select.Item>
				{/each}
			</Select.Content>
		</Select.Root>
	</div>

	<div class="h-96 shrink-0">
		<MapShell
			integrations={[mapIntegration]}
			ready={manager.initialized}
			panelOpen={false}
			routerEscapeHatch={false}
		/>
	</div>

	{#if manager.calendarDays}
		<div class="self-start">
			<Calendar days={manager.calendarDays} />
		</div>
	{:else if manager.countyCalendars}
		<div class="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
			{#each manager.countyCalendars as entry (entry.county.id)}
				<div>
					<h3 class="mb-2 text-sm font-semibold">{entry.county.name}</h3>
					<Calendar days={entry.days} />
				</div>
			{/each}
		</div>
	{/if}
</div>
