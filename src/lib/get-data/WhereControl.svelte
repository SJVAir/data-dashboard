<script lang="ts">
	import { Button } from "$lib/components/ui/button";
	import * as Dialog from "$lib/components/ui/dialog";
	import { getMetadata, getResolvers } from "$lib/data";
	import { formatList, formatNumber } from "$lib/format";
	import { m } from "$lib/paraglide/messages.js";
	import { directoryFor, resolvePicks, type Resolvers } from "$lib/places/host";
	import type { PlaceDirectory } from "$lib/places/directory";
	import PlacePicker from "$lib/places/PlacePicker.svelte";
	import { addRecent, readRecent } from "$lib/places/recent";
	import type { Picks } from "$lib/places/selection";
	import type { PlaceOption } from "$lib/places/types";
	import { report } from "$lib/safety/report";
	import { useApp } from "$lib/store/app.svelte";

	let {
		picks,
		names,
		namesSettled,
		max,
		purpose,
		onchange
	}: {
		picks: Picks;
		/** The places' names from the preview's latest data; `null` before it has any. */
		names: string[] | null;
		/** No names are coming (the query failed or can't run): show the count instead. */
		namesSettled: boolean;
		/** The chosen widget type's `accepts.maxPlaces`. */
		max: number;
		purpose: { dataset: string; entryType: string };
		onchange: (picks: Picks) => void;
	} = $props();

	const app = useApp();

	type Ready = {
		directory: PlaceDirectory;
		resolvers: Resolvers;
		initial: Picks;
		known: PlaceOption[];
		recent: PlaceOption[];
	};

	let open = $state(false);
	let ready = $state.raw<Ready | null>(null);
	let failed = $state(false);
	let content = $state<HTMLElement | null>(null);
	let opener = $state<HTMLButtonElement | null>(null);
	let controller: AbortController | null = null;

	const summary = $derived.by(() => {
		if (names && names.length > 0) return formatList(names);
		if (picks.length > 1 || namesSettled) {
			return m.get_data_places_count({
				count: formatNumber(picks.length),
				countValue: picks.length
			});
		}
		return m.get_data_places_loading();
	});

	async function load(signal: AbortSignal): Promise<void> {
		ready = null;
		failed = false;
		try {
			const metadata = getMetadata();
			const resolvers = getResolvers();
			const directory = directoryFor(metadata, resolvers.regions);
			const recentRefs = await readRecent(app.platform, app.space).catch((error: unknown) => {
				report(error);
				return [];
			});
			const resolved = await resolvePicks(
				picks,
				recentRefs,
				{ directory, resolvers, entryType: purpose.entryType },
				signal
			);
			if (signal.aborted) return;
			ready = { directory, resolvers, ...resolved };
		} catch (error) {
			if (signal.aborted) return;
			report(error);
			failed = true;
		}
	}

	function show(): void {
		controller?.abort();
		controller = new AbortController();
		open = true;
		void load(controller.signal);
	}

	function close(): void {
		open = false;
		controller?.abort();
		controller = null;
	}

	function done(next: Picks): void {
		close();
		if (next.length === 0) return;
		onchange(next);
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

<div class="flex flex-wrap items-center gap-2">
	<p class="min-w-0 flex-1 text-sm" data-testid="where-summary">{summary}</p>
	<Button
		bind:ref={opener}
		variant="outline"
		size="sm"
		aria-label={m.get_data_places_change_label()}
		onclick={show}
	>
		{m.get_data_places_change()}
	</Button>
</div>

<Dialog.Root
	bind:open
	onOpenChange={(o) => {
		if (!o) close();
	}}
>
	<Dialog.Content
		bind:ref={content}
		tabindex={-1}
		class="flex max-h-[85dvh] flex-col overflow-y-auto max-sm:top-0 max-sm:left-0 max-sm:h-dvh max-sm:max-h-none max-sm:w-full max-sm:max-w-none max-sm:translate-x-0 max-sm:translate-y-0 max-sm:rounded-none max-sm:border-0 sm:max-w-lg"
		onOpenAutoFocus={(e) => {
			e.preventDefault();
			(content?.querySelector<HTMLElement>("[role=combobox]") ?? content)?.focus();
		}}
		onCloseAutoFocus={(e) => {
			e.preventDefault();
			opener?.focus();
		}}
	>
		<Dialog.Header>
			<Dialog.Title>
				{max > 1 ? m.place_picker_dialog_title_multiple() : m.place_picker_dialog_title()}
			</Dialog.Title>
		</Dialog.Header>
		{#if ready}
			<PlacePicker
				directory={ready.directory}
				{purpose}
				mode={max > 1 ? { kind: "multiple", max } : { kind: "single" }}
				initial={ready.initial}
				known={ready.known}
				recent={ready.recent}
				locate={(signal) => app.platform.geolocation.locate(signal)}
				pointKeys={(lat, lon, signal) => ready!.resolvers.points.keys(lat, lon, signal)}
				ondone={done}
				oncancel={close}
			/>
		{/if}
		<div class={["flex flex-wrap items-center gap-2 text-sm", ready && "sr-only"]}>
			<p role="status" class={[!failed && "text-muted-foreground"]}>
				{#if failed}{m.place_picker_dialog_failed()}{:else if !ready}{m.place_picker_dialog_loading()}{/if}
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
