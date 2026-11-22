<script lang="ts">
	import { Button } from "$lib/components/ui/button";
	import * as Dialog from "$lib/components/ui/dialog";
	import { getMetadata, getResolvers } from "$lib/data";
	import { m } from "$lib/paraglide/messages.js";
	import { directoryFor, resolvePicks, type Resolvers } from "$lib/places/host";
	import type { PlaceDirectory } from "$lib/places/directory";
	import PlacePicker from "$lib/places/PlacePicker.svelte";
	import { addRecent, readRecent } from "$lib/places/recent";
	import type { Picks } from "$lib/places/selection";
	import type { PlaceOption } from "$lib/places/types";
	import { report } from "$lib/safety/report";
	import { useApp } from "$lib/store/app.svelte";

	/**
	 * The Air quality section's Monitors search (spec decision 7): Where's place picker offering
	 * only monitors that measure the chosen pollutant. Several monitors, with no cap; one for a
	 * single-place widget (`single`), whose pick replaces it. Disabled, with its reason, while no
	 * pollutant is chosen.
	 */
	let {
		ids,
		single,
		purpose,
		reasonId,
		ref = $bindable(null),
		onchange
	}: {
		/** The searched monitors now. */
		ids: string[];
		/** A single-place widget: one monitor, picked in single mode. */
		single: boolean;
		/** The chosen pollutant; undefined (None): the search is disabled. */
		purpose: { dataset: string; entryType: string } | undefined;
		/** The id of the text saying why the search is disabled. */
		reasonId?: string;
		/** The opening button (focus returns to it). */
		ref?: HTMLButtonElement | null;
		/** The monitors after the search: those kept, then the new picks. */
		onchange: (ids: string[]) => void;
	} = $props();

	const app = useApp();
	const uid = $props.id();
	const keepId = `${uid}-keep`;

	type Ready = {
		directory: PlaceDirectory;
		resolvers: Resolvers;
		entryType: string;
		initial: Picks;
		known: PlaceOption[];
		recent: PlaceOption[];
		/** The searched monitors the picker can't show (not measuring the pollutant, or gone). */
		kept: Set<string>;
	};

	let open = $state(false);
	let ready = $state.raw<Ready | null>(null);
	let keepShown = $state(false);
	let failed = $state(false);
	let content = $state<HTMLElement | null>(null);
	let controller: AbortController | null = null;

	const label = $derived(single ? m.get_data_monitors_choose() : m.get_data_monitors_add());

	async function load(signal: AbortSignal): Promise<void> {
		ready = null;
		failed = false;
		const entryType = purpose?.entryType;
		if (!entryType) return;
		try {
			const metadata = getMetadata();
			const resolvers = getResolvers();
			const directory = directoryFor(metadata, resolvers.regions);
			const recentRefs = await readRecent(app.platform, app.space).catch((error: unknown) => {
				report(error);
				return [];
			});
			const refs: Picks = ids.map((id) => ({ kind: "monitor", id }));
			const resolved = await resolvePicks(
				refs,
				recentRefs,
				{ directory, resolvers, entryType },
				signal
			);
			if (signal.aborted) return;
			// A monitor that doesn't measure the pollutant (or is gone) isn't offered, so it isn't a
			// chip: it stays as it is (spec decision 32), whatever the picker returns.
			const shown = new Set(resolved.initial.flatMap((r) => (r.kind === "monitor" ? [r.id] : [])));
			const kept = new Set(ids.filter((id) => !shown.has(id)));
			ready = { directory, resolvers, entryType, ...resolved, kept };
		} catch (error) {
			if (signal.aborted) return;
			report(error);
			failed = true;
		}
	}

	function show(): void {
		if (!purpose) return;
		controller?.abort();
		controller = new AbortController();
		open = true;
		void load(controller.signal);
	}

	function dismiss(): void {
		open = false;
		controller?.abort();
		controller = null;
	}

	function done(next: Picks): void {
		const kept = ready?.kept ?? new Set<string>();
		dismiss();
		const picked = next.flatMap((r) => (r.kind === "monitor" ? [r.id] : []));
		if (single) {
			if (picked.length === 0) return;
			onchange([picked[0]]);
		} else {
			const chosen = new Set(picked);
			// Kept and still-picked monitors in their order, then the new ones.
			const stays = ids.filter((id) => kept.has(id) || chosen.has(id));
			const after = [...stays, ...picked.filter((id) => !stays.includes(id))];
			if (after.length === ids.length && after.every((id, i) => id === ids[i])) return;
			onchange(after);
		}
		void (async () => {
			try {
				for (const ref of [...next].reverse()) await addRecent(app.platform, app.space, ref);
			} catch (error) {
				report(error);
			}
		})();
	}

	$effect(() => () => controller?.abort());
</script>

<div>
	<Button
		bind:ref
		variant="outline"
		size="sm"
		disabled={!purpose}
		aria-describedby={!purpose ? reasonId : undefined}
		onclick={show}
	>
		{label}
	</Button>
</div>

<Dialog.Root
	bind:open
	onOpenChange={(o) => {
		if (!o) dismiss();
	}}
>
	<Dialog.Content
		bind:ref={content}
		tabindex={-1}
		aria-describedby={keepShown ? keepId : undefined}
		class="flex max-h-[85dvh] flex-col overflow-y-auto max-sm:top-0 max-sm:left-0 max-sm:h-dvh max-sm:max-h-none max-sm:w-full max-sm:max-w-none max-sm:translate-x-0 max-sm:translate-y-0 max-sm:rounded-none max-sm:border-0 sm:max-w-lg"
		onOpenAutoFocus={(e) => {
			e.preventDefault();
			(content?.querySelector<HTMLElement>("[role=combobox]") ?? content)?.focus();
		}}
		onCloseAutoFocus={(e) => {
			e.preventDefault();
			ref?.focus();
		}}
	>
		<Dialog.Header>
			<Dialog.Title>
				{single ? m.get_data_monitors_dialog_title_single() : m.get_data_monitors_dialog_title()}
			</Dialog.Title>
		</Dialog.Header>
		{#if ready}
			<PlacePicker
				directory={ready.directory}
				purpose={{ dataset: purpose?.dataset ?? "air-quality", entryType: ready.entryType }}
				mode={single ? { kind: "single" } : { kind: "multiple", max: Infinity }}
				offer="monitors"
				initial={ready.initial}
				known={ready.known}
				recent={ready.recent}
				locate={(signal) => app.platform.geolocation.locate(signal)}
				pointKeys={(lat, lon, signal) => ready!.resolvers.points.keys(lat, lon, signal)}
				ondone={done}
				oncancel={dismiss}
				{keepId}
				onkeepline={(shown) => (keepShown = shown)}
			/>
		{/if}
		<div class={["flex flex-wrap items-center gap-2 text-sm", ready && "sr-only"]}>
			<p role="status" class={[!failed && "text-muted-foreground"]}>
				{#if failed}{m.place_picker_dialog_failed()}{:else if !ready}{m.get_data_monitors_dialog_loading()}{/if}
			</p>
			{#if failed}
				<Button
					variant="outline"
					size="xs"
					onclick={() => controller && void load(controller.signal)}
				>
					{m.place_picker_retry()}
				</Button>
			{/if}
		</div>
	</Dialog.Content>
</Dialog.Root>
