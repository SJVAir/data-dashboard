<script lang="ts">
	import ChevronLeft from "@lucide/svelte/icons/chevron-left";
	import ChevronRight from "@lucide/svelte/icons/chevron-right";
	import { Button } from "$lib/components/ui/button";
	import { Slider } from "$lib/components/ui/slider";
	import { formatLongWeekdayDate } from "$lib/format";
	import { m } from "$lib/paraglide/messages.js";
	import { stepKey, type Stop } from "./days";

	type Props = {
		stops: Stop[];
		/** Index of the stop shown. */
		at: number;
		/** The shown day's readings may still change. */
		notFinal: boolean;
		/** Too narrow for the slider: only the buttons and the date. */
		narrow: boolean;
		onstep: (index: number, via: "button" | "key" | "slider") => void;
		/** A slider drag ended (the caller closes its undo run). */
		ondragend: () => void;
	};

	let { stops, at, notFinal, narrow, onstep, ondragend }: Props = $props();

	// While the slider has focus it announces each step itself (its value text), so the date's
	// live region stays quiet: a step is announced once.
	let sliderFocused = $state(false);

	const stop = $derived(stops[at]);
	const label = $derived(
		stop === undefined
			? ""
			: stop === "now"
				? m.map_day_now()
				: formatLongWeekdayDate(stop.day, { year: true })
	);

	// What the slider announces: the strip's live region is off while it has focus, so "not final
	// yet" is part of its value text.
	const valueText = $derived(notFinal ? m.map_day_value_not_final({ day: label }) : label);

	// The standard slider keys, run through `stepKey` so the steps (Page Up/Down is a week) are
	// exactly ours; bits-ui never sees them.
	function onkeydown(event: KeyboardEvent) {
		if (event.altKey || event.ctrlKey || event.metaKey) return;
		const next = stepKey(event.key, at, stops.length);
		if (next === null) return;
		event.preventDefault();
		event.stopPropagation();
		if (next !== at) onstep(next, "key");
	}
</script>

{#if stops.length === 0}
	<p class="text-muted-foreground px-2 py-1 text-sm">{m.map_day_none_yet()}</p>
{:else}
	<div class="flex items-center gap-2 px-2 py-1" data-day-stepper>
		<Button
			variant="ghost"
			size="icon"
			aria-label={m.map_day_previous()}
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
					thumbProps={{ "aria-label": m.map_day_slider(), "aria-valuetext": valueText }}
				/>
			</div>
		{/if}
		<Button
			variant="ghost"
			size="icon"
			aria-label={m.map_day_next()}
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
