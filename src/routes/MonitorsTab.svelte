<script lang="ts">
	import { onMount } from "svelte";
	import { addDays, differenceInCalendarDays, format, parseISO } from "date-fns";
	import { MapShell, MonitorsMapIntegration } from "@sjvair/monitor-map";
	import Calendar from "$lib/components/Calendar.svelte";
	import { Button } from "$lib/components/ui/button/index.js";
	import * as Select from "$lib/components/ui/select/index.js";
	import { MAX_CALENDAR_DAYS } from "$lib/calendar";
	import { getTabPreferences, setTabPreferences } from "$lib/preferences";
	import {
		decodeCounty,
		decodeDateRange,
		decodePollutant,
		encodeCounty,
		encodeDateRange,
		encodePollutant,
		type MonitorsPollutantParam
	} from "$lib/url-state";
	import { route, searchParams } from "../router";
	import { monitorsTabManager } from "./monitors/monitors-tab.svelte";

	const manager = monitorsTabManager;
	const mapIntegration = new MonitorsMapIntegration(manager);

	function defaultDateRange() {
		const end = new Date();
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- local, non-reactive value
		const start = new Date();
		start.setDate(end.getDate() - 6);
		return {
			start: start.toISOString().slice(0, 10),
			end: end.toISOString().slice(0, 10)
		};
	}

	function asString(value: string | number | boolean | undefined): string | undefined {
		return typeof value === "string" ? value : undefined;
	}

	onMount(async () => {
		await manager.init();

		const prefs = getTabPreferences("monitors");
		const urlRange = decodeDateRange(asString(route.search.range));
		const urlPollutant = decodePollutant(asString(route.search.pollutant));
		const urlCounty = decodeCounty(asString(route.search.county));

		const dateRange = urlRange ?? prefs.dateRange ?? defaultDateRange();
		const pollutant = urlPollutant ?? "pm25";

		manager.dateRange = dateRange;
		manager.pollutant = pollutant;
		manager.selectedCountyId = urlCounty;

		if (!urlRange) {
			searchParams.set("range", encodeDateRange(dateRange), { replace: true });
		}
		if (!urlPollutant) {
			searchParams.set("pollutant", encodePollutant(pollutant), { replace: true });
		}

		await Promise.all([manager.refreshMapAverages(), manager.refreshCalendar()]);
	});

	async function handleCountyChange(regionId: string | undefined) {
		manager.selectedCountyId = regionId ?? null;
		searchParams.set("county", regionId ? encodeCounty(regionId) : "", { replace: true });
		await Promise.all([manager.refreshMapAverages(), manager.refreshCalendar()]);
	}

	async function handlePollutantChange(pollutant: MonitorsPollutantParam) {
		manager.pollutant = pollutant;
		searchParams.set("pollutant", encodePollutant(pollutant), { replace: true });
		await Promise.all([manager.refreshMapAverages(), manager.refreshCalendar()]);
	}

	async function handleDateRangeChange(field: "start" | "end", value: string) {
		if (!value) return;

		let start = field === "start" ? value : manager.dateRange.start;
		let end = field === "end" ? value : manager.dateRange.end;

		// Normalize a reversed range (start after end) rather than erroring.
		if (start > end) [start, end] = [end, start];

		// Clamp the total span to a maximum of 5 years (MAX_CALENDAR_DAYS days). We
		// adjust whichever end the user did NOT just edit, so the edit itself is
		// preserved rather than silently ignored.
		const spanDays = differenceInCalendarDays(parseISO(end), parseISO(start)) + 1;
		if (spanDays > MAX_CALENDAR_DAYS) {
			if (value === start) {
				end = format(addDays(parseISO(start), MAX_CALENDAR_DAYS - 1), "yyyy-MM-dd");
			} else {
				start = format(addDays(parseISO(end), -(MAX_CALENDAR_DAYS - 1)), "yyyy-MM-dd");
			}
		}

		const nextRange = { start, end };
		manager.dateRange = nextRange;
		searchParams.set("range", encodeDateRange(nextRange), { replace: true });
		setTabPreferences("monitors", { dateRange: nextRange });
		await Promise.all([manager.refreshMapAverages(), manager.refreshCalendar()]);
	}

	let selectedCountyName = $derived(
		manager.counties?.find((county) => county.id === manager.selectedCountyId)?.name ??
			"All counties"
	);
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

		<label class="flex items-center gap-2 text-sm">
			Start
			<input
				type="date"
				class="border-input rounded border px-2 py-1"
				value={manager.dateRange.start}
				onchange={(event) => handleDateRangeChange("start", event.currentTarget.value)}
			/>
		</label>
		<label class="flex items-center gap-2 text-sm">
			End
			<input
				type="date"
				class="border-input rounded border px-2 py-1"
				value={manager.dateRange.end}
				onchange={(event) => handleDateRangeChange("end", event.currentTarget.value)}
			/>
		</label>

		<Select.Root
			type="single"
			value={manager.selectedCountyId ?? undefined}
			onValueChange={handleCountyChange}
		>
			<Select.Trigger class="w-56">{selectedCountyName}</Select.Trigger>
			<Select.Content>
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
		<Calendar days={manager.calendarDays} />
	{/if}
</div>
