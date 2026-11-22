<script lang="ts">
	import { untrack } from "svelte";
	import { Button } from "$lib/components/ui/button";
	import * as Dialog from "$lib/components/ui/dialog";
	import { getMetadata, getResolvers } from "$lib/data";
	import { formatList, formatNumber } from "$lib/format";
	import { m } from "$lib/paraglide/messages.js";
	import { directoryFor, resolveOption, resolvePicks, type Resolvers } from "$lib/places/host";
	import type { PlaceDirectory } from "$lib/places/directory";
	import PlacePicker from "$lib/places/PlacePicker.svelte";
	import type { PickerOffer } from "$lib/places/picker-state.svelte";
	import { addRecent, readRecent } from "$lib/places/recent";
	import type { Picks } from "$lib/places/selection";
	import type { PlaceOption } from "$lib/places/types";
	import { report } from "$lib/safety/report";
	import { useApp } from "$lib/store/app.svelte";

	let {
		picks,
		max,
		offer,
		purpose,
		emptyText,
		clearable = false,
		onchange
	}: {
		picks: Picks;
		/** How many places the chosen widget type takes (`placeLimit`). */
		max: number;
		/** `areas` for a Chart or Table (no schools or points), `where` for the other types. */
		offer: Exclude<PickerOffer, "monitors">;
		purpose: { dataset: string; entryType: string };
		/**
		 * What the summary says with no picks instead of "Everywhere" (a single-place widget with no
		 * monitor asks for one; with its one monitor it says so).
		 */
		emptyText?: string;
		/**
		 * Whether a "Clear" action goes back to no places (a type whose empty Where means
		 * everywhere; not a single-place type, whose empty Where asks for one). It calls `onchange`
		 * with no picks.
		 */
		clearable?: boolean;
		onchange: (picks: Picks) => void;
	} = $props();

	const app = useApp();
	const uid = $props.id();
	const keepId = `${uid}-keep`;

	type Ready = {
		directory: PlaceDirectory;
		resolvers: Resolvers;
		initial: Picks;
		known: PlaceOption[];
		recent: PlaceOption[];
	};

	let open = $state(false);
	let ready = $state.raw<Ready | null>(null);
	/** The picker's keep line is shown: the dialog's description names it only then. */
	let keepShown = $state(false);
	let failed = $state(false);
	let content = $state<HTMLElement | null>(null);
	let opener = $state<HTMLButtonElement | null>(null);
	let controller: AbortController | null = null;

	const pickerMode = $derived(
		max > 1 ? { kind: "multiple" as const, max } : { kind: "single" as const }
	);

	/**
	 * The picks' own names (looked up as the picker names its chips), kept for the picks they name:
	 * `undefined` while they load; `null` when any can't be named (a point, a failed lookup).
	 */
	let named = $state.raw<{ key: string; names: string[] | null } | undefined>(undefined);
	const picksKey = $derived(JSON.stringify(picks));

	$effect(() => {
		const key = picksKey;
		if (picks.length === 0) return;
		const refs = untrack(() => [...picks]);
		const abort = new AbortController();
		void (async () => {
			try {
				const ctx = {
					directory: directoryFor(getMetadata(), getResolvers().regions),
					resolvers: getResolvers(),
					entryType: purpose.entryType
				};
				// A point is its own label, else "Your location" (as the picker's chips name it).
				const found = await Promise.all(
					refs.map((ref) =>
						ref.kind === "point"
							? Promise.resolve(ref.label ?? m.place_picker_your_location())
							: resolveOption(ref, ctx, abort.signal)
									.then((o) => o?.name ?? null)
									.catch(() => null)
					)
				);
				if (abort.signal.aborted) return;
				const names = found.every((n) => n !== null) ? (found as string[]) : null;
				named = { key, names };
			} catch (error) {
				if (abort.signal.aborted) return;
				report(error);
				named = { key, names: null };
			}
		})();
		return () => abort.abort();
	});

	const summary = $derived.by(() => {
		if (picks.length === 0) return emptyText ?? m.get_data_where_everywhere();
		if (named?.key !== picksKey) return m.get_data_places_loading();
		if (named.names) return formatList(named.names);
		return m.get_data_places_count({
			count: formatNumber(picks.length),
			countValue: picks.length
		});
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

	/** Cancel, Escape, or the dialog closing by itself. */
	function dismiss(): void {
		open = false;
		controller?.abort();
		controller = null;
	}

	function done(next: Picks): void {
		dismiss();
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

	/** Clear: no places; focus goes to Change places (the Clear button goes away). */
	function clear(): void {
		onchange([]);
		opener?.focus();
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
	{#if clearable && picks.length > 0}
		<Button variant="ghost" size="sm" aria-label={m.get_data_places_clear_label()} onclick={clear}>
			{m.get_data_places_clear()}
		</Button>
	{/if}
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
			opener?.focus();
		}}
	>
		<Dialog.Header>
			<Dialog.Title>
				{pickerMode.kind === "multiple"
					? m.place_picker_dialog_title_multiple()
					: m.place_picker_dialog_title()}
			</Dialog.Title>
		</Dialog.Header>
		{#if ready}
			<PlacePicker
				directory={ready.directory}
				{purpose}
				mode={pickerMode}
				{offer}
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
