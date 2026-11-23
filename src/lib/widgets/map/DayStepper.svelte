<script lang="ts">
	import ChevronLeft from "@lucide/svelte/icons/chevron-left";
	import ChevronRight from "@lucide/svelte/icons/chevron-right";
	import { Button } from "$lib/components/ui/button";
	import { Slider } from "$lib/components/ui/slider";
	import { m } from "$lib/paraglide/messages.js";
	import { PAGE_STOPS, stepKey, stopLabel, type MapLevel, type Stop } from "./days";

	type Props = {
		stops: Stop[];
		/** What the stops step by: days, months or years. */
		resolution: MapLevel;
		/** Index of the stop shown. */
		at: number;
		/** The shown stop's readings may still change. */
		notFinal: boolean;
		/** Too narrow for the slider: only the buttons and the date. */
		narrow: boolean;
		onstep: (index: number, via: "button" | "key" | "slider") => void;
		/** A slider drag ended (the caller closes its undo run). */
		ondragend: () => void;
	};

	let { stops, resolution, at, notFinal, narrow, onstep, ondragend }: Props = $props();

	/** The stepper's words at each level (no sentence is built from parts). */
	const WORDS: Record<
		MapLevel,
		{ previous: () => string; next: () => string; slider: () => string; none: () => string }
	> = {
		day: {
			previous: () => m.map_day_previous(),
			next: () => m.map_day_next(),
			slider: () => m.map_day_slider(),
			none: () => m.map_day_none_yet()
		},
		month: {
			previous: () => m.map_month_previous(),
			next: () => m.map_month_next(),
			slider: () => m.map_month_slider(),
			none: () => m.map_month_none_yet()
		},
		year: {
			previous: () => m.map_year_previous(),
			next: () => m.map_year_next(),
			slider: () => m.map_year_slider(),
			none: () => m.map_year_none_yet()
		}
	};
	const words = $derived(WORDS[resolution]);

	// While the slider has focus it announces each step itself (its value text), so the date's
	// live region stays quiet: a step is announced once.
	let sliderFocused = $state(false);

	const stop = $derived(stops[at]);
	const label = $derived(stop === undefined ? "" : stopLabel(stop, resolution));

	// What the slider announces: the strip's live region is off while it has focus, so "not final
	// yet" is part of its value text.
	const valueText = $derived(notFinal ? m.map_day_value_not_final({ day: label }) : label);

	// The standard slider keys, run through `stepKey` so the steps (Page Up/Down is a week, a year
	// of months or ten years) are exactly ours; bits-ui never sees them.
	function onkeydown(event: KeyboardEvent) {
		if (event.altKey || event.ctrlKey || event.metaKey) return;
		const next = stepKey(event.key, at, stops.length, PAGE_STOPS[resolution]);
		if (next === null) return;
		event.preventDefault();
		event.stopPropagation();
		if (next !== at) onstep(next, "key");
	}
</script>

{#if stops.length === 0}
	<p class="text-muted-foreground px-2 py-1 text-sm">{words.none()}</p>
{:else}
	<div class="flex items-center gap-2 px-2 py-1" data-day-stepper>
		<Button
			variant="ghost"
			size="icon"
			aria-label={words.previous()}
			disabled={at <= 0}
			onclick={() => onstep(at - 1, "button")}
		>
			<ChevronLeft aria-hidden="true" />
		</Button>
		{#if !narrow}
			<div
				class="min-w-24 flex-1"
				onkeydowncapture={onkeydown}
				onfocusin={() => (sliderFocused = true)}
				onfocusout={() => (sliderFocused = false)}
			>
				<Slider
					value={at}
					min={0}
					max={stops.length - 1}
					step={1}
					onValueChange={(v) => {
						if (v !== at) onstep(v, "slider");
					}}
					onValueCommit={() => ondragend()}
					thumbProps={{ "aria-label": words.slider(), "aria-valuetext": valueText }}
				/>
			</div>
		{/if}
		<Button
			variant="ghost"
			size="icon"
			aria-label={words.next()}
			disabled={at >= stops.length - 1}
			onclick={() => onstep(at + 1, "button")}
		>
			<ChevronRight aria-hidden="true" />
		</Button>
		<span
			class="flex flex-wrap items-baseline gap-x-2 text-sm"
			aria-live={sliderFocused && !narrow ? "off" : "polite"}
			data-day-status
		>
			<span class="font-medium" data-day-label>{label}</span>
			{#if notFinal}
				<span class="text-muted-foreground text-xs">{m.map_day_not_final()}</span>
			{/if}
		</span>
	</div>
{/if}
