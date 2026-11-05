<script lang="ts">
	import LocateFixedIcon from "@lucide/svelte/icons/locate-fixed";
	import XIcon from "@lucide/svelte/icons/x";
	import { onDestroy, tick } from "svelte";
	import { Button } from "$lib/components/ui/button";
	import type { PlaceRef } from "$lib/data/schema";
	import { m } from "$lib/paraglide/messages.js";
	import type { GeoResult } from "$lib/platform/types";
	import type { PlaceDirectory } from "./directory";
	import { errorText, PickerState, refKey } from "./picker-state.svelte";
	import ResultList from "./ResultList.svelte";
	import type { PickerMode, Picks } from "./selection";
	import type { PlaceOption } from "./types";

	// eslint-disable-next-line svelte/no-unused-props -- `purpose.dataset` is part of the host contract; only the entry type filters today.
	let {
		directory,
		purpose,
		mode,
		activeOnly = false,
		initial,
		recent,
		known = [],
		locate,
		pointKeys,
		ondone,
		oncancel
	}: {
		directory: PlaceDirectory;
		/** What the places are for; only the entry type filters monitors today (by monitor type). */
		purpose: { dataset: string; entryType: string };
		mode: PickerMode;
		activeOnly?: boolean;
		initial: Picks;
		/** Resolved by the host; also names any of `initial` they hold. */
		recent: PlaceOption[];
		/** Places the host already resolved (e.g. `initial`), so chips can name them. */
		known?: PlaceOption[];
		locate: (signal: AbortSignal) => Promise<GeoResult>;
		/** The region keys holding a point; none means it's outside SJVAir's area. */
		pointKeys: (lat: number, lon: number, signal: AbortSignal) => Promise<string[]>;
		/** Single mode: the first pick. Multiple mode: Done. */
		ondone: (picks: Picks) => void;
		oncancel: () => void;
	} = $props();

	const uid = $props.id();
	const listboxId = `${uid}-results`;
	const locationReasonId = `${uid}-location-reason`;
	const browseId = `${uid}-browse`;

	// `initial` seeds the picks once; later changes to it don't reset what the person picked.
	// svelte-ignore state_referenced_locally
	const startPicks = initial;
	const picker = new PickerState(
		() => ({
			directory,
			entryType: purpose.entryType,
			activeOnly,
			mode,
			recent,
			known,
			locate,
			pointKeys,
			ondone
		}),
		startPicks,
		uid
	);
	onDestroy(() => picker.destroy());

	const multiple = $derived(mode.kind === "multiple");

	let input = $state<HTMLInputElement | null>(null);
	let chips = $state<HTMLUListElement | null>(null);

	$effect(() => {
		input?.focus();
	});

	function onkeydown(event: KeyboardEvent) {
		switch (event.key) {
			case "ArrowDown":
			case "ArrowUp":
				event.preventDefault();
				picker.move(event.key === "ArrowDown" ? 1 : -1);
				break;
			case "Enter":
				event.preventDefault();
				if (picker.active) picker.pick(picker.active);
				break;
			case "Escape":
				event.preventDefault();
				if (picker.query !== "") {
					// Clearing is handled here; don't let a host dialog close too.
					event.stopPropagation();
					picker.setQuery("");
				} else {
					oncancel();
				}
				break;
		}
	}

	async function remove(ref: PlaceRef, index: number) {
		picker.remove(ref);
		await tick();
		const buttons = chips?.querySelectorAll<HTMLButtonElement>("button") ?? [];
		(buttons[Math.min(index, buttons.length - 1)] ?? input)?.focus();
	}
</script>

<div class="flex min-w-0 flex-col gap-3">
	{#if multiple && picker.picks.length > 0}
		<ul bind:this={chips} aria-label={m.place_picker_chosen()} class="flex flex-wrap gap-1.5">
			{#each picker.picks as ref, index (refKey(ref))}
				{@const name = picker.nameOf(ref)}
				<li
					class="border-border bg-secondary text-secondary-foreground flex max-w-full items-center gap-1 rounded-full border py-0.5 pr-0.5 pl-2.5 text-sm"
				>
					<span class="min-w-0 break-words">{name}</span>
					<Button
						variant="ghost"
						size="icon-xs"
						class="rounded-full"
						aria-label={m.place_picker_remove({ name })}
						onclick={() => remove(ref, index)}
					>
						<XIcon aria-hidden="true" />
					</Button>
				</li>
			{/each}
		</ul>
	{/if}

	<input
		bind:this={input}
		type="text"
		role="combobox"
		autocomplete="off"
		spellcheck="false"
		aria-label={m.place_picker_label()}
		aria-autocomplete="list"
		aria-expanded={picker.rows.length > 0 ? "true" : "false"}
		aria-controls={listboxId}
		aria-activedescendant={picker.active?.id}
		placeholder={m.place_picker_placeholder()}
		value={picker.query}
		oninput={(e) => picker.setQuery(e.currentTarget.value)}
		{onkeydown}
		class="border-input bg-card placeholder:text-muted-foreground focus-visible:border-ring focus-visible:outline-ring text-field h-9 w-full min-w-0 rounded-(--radius-control) border px-2.5 focus-visible:outline-2"
	/>

	<div class="flex flex-col items-start gap-1">
		<Button
			variant="outline"
			size="sm"
			aria-disabled={picker.locationReason ? "true" : undefined}
			aria-describedby={picker.locationReason ? locationReasonId : undefined}
			class="aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
			onclick={() => picker.useLocation()}
		>
			<LocateFixedIcon aria-hidden="true" />
			{m.place_picker_use_location()}
		</Button>
		{#if picker.locationReason}
			<p id={locationReasonId} class="text-muted-foreground text-xs">{picker.locationReason}</p>
		{/if}
		<p data-picker-location-status role="status" class="text-sm">
			{#if picker.geo.status === "locating"}{m.place_picker_locating()}{:else if picker.geo.status === "message"}{picker
					.geo.text}{/if}
		</p>
	</div>

	<ResultList {picker} id={listboxId} label={m.place_picker_results()} {multiple} />

	{#if picker.typing}
		{#each picker.failed as key (key)}
			<p data-picker-error class="flex flex-wrap items-center gap-2 text-sm">
				<span>{errorText(key)}</span>
				<Button variant="outline" size="xs" onclick={() => picker.retry()}>
					{m.place_picker_retry()}
				</Button>
			</p>
		{/each}
		{#if picker.more}
			<p class="text-muted-foreground text-xs italic">{m.place_picker_more()}</p>
		{/if}
	{:else}
		<section aria-labelledby={browseId} class="flex flex-col gap-1">
			<h2
				id={browseId}
				class="text-muted-foreground px-2 text-xs font-medium tracking-wide uppercase"
			>
				{m.place_picker_browse()}
			</h2>
			<!-- Task 11: the Browse panel (region types and Monitors) renders here. -->
		</section>
	{/if}

	<!-- Separate whole messages, one per node, never joined into a sentence. -->
	<div data-picker-live role="status" class="sr-only">
		{#each picker.announcement as text, i (i)}<p>{text}</p>{/each}
	</div>

	{#if multiple}
		<div class="border-border flex justify-end gap-2 border-t pt-3">
			<Button variant="outline" onclick={oncancel}>{m.place_picker_cancel()}</Button>
			<Button
				disabled={picker.picks.length === 0}
				onclick={() => ondone($state.snapshot(picker.picks))}>{m.place_picker_done()}</Button
			>
		</div>
	{/if}
</div>
