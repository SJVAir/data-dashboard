<script lang="ts">
	import { untrack } from "svelte";
	import { stationsForLayer } from "./sources";
	import { stationChoice, type WeatherStation } from "$lib/data/adapters/weather";
	import type { Layer } from "$lib/data/schema";
	import { formatNumber } from "$lib/format";
	import { m } from "$lib/paraglide/messages.js";

	let {
		place,
		value,
		onchange
	}: {
		/** The widget's one place (the main layer's). */
		place: Pick<Layer, "place" | "selection">;
		/** The saved station; none means the first listed. */
		value: string | undefined;
		/** A station id, or `undefined` for the first (default) station. */
		onchange: (station: string | undefined) => void;
	} = $props();

	const uid = $props.id();

	let stations = $state.raw<WeatherStation[]>([]);
	const placeKey = $derived(JSON.stringify([place.place, place.selection]));
	$effect(() => {
		void placeKey;
		const controller = new AbortController();
		stations = [];
		// Only a change of place asks again (the draft is a new object on every edit).
		const { place: one, selection } = untrack(() => place);
		stationsForLayer({ dataset: "weather", place: one, selection }, controller.signal).then(
			(list) => {
				// The server's order: inside ones first, then nearby ones, nearest first. Its first is
				// the default, as the fetch uses it.
				stations = list;
			},
			() => {
				// No list (offline, or the place can't be looked up): the layer uses its default.
			}
		);
		return () => controller.abort();
	});

	const chosen = $derived(stationChoice(stations, value));

	function optionLabel(station: WeatherStation): string {
		const name = station.inside
			? station.name
			: m.get_data_station_nearby({
					name: station.name,
					miles: formatNumber(station.distance, { maximumFractionDigits: 1 })
				});
		return station.active ? name : m.get_data_station_no_recent({ station: name });
	}
</script>

{#if stations.length > 0 && chosen}
	<div class="flex flex-wrap items-center gap-2 text-sm">
		<label for="{uid}-station" class="font-medium">{m.get_data_station()}</label>
		<select
			id="{uid}-station"
			value={chosen.id}
			onchange={(e) => {
				const id = e.currentTarget.value;
				onchange(id === stations[0].id ? undefined : id);
			}}
			class="border-input bg-card text-field h-8 max-w-full min-w-0 rounded-(--radius-control) border px-2 md:text-sm"
		>
			{#each stations as station (station.id)}
				<option value={station.id}>{optionLabel(station)}</option>
			{/each}
		</select>
	</div>
{/if}
