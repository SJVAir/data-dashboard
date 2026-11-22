<script lang="ts">
	import { onMount, untrack } from "svelte";
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
		onchange,
		keep
	}: {
		picks: Picks;
		/** The chosen widget type's `accepts.maxPlaces`. */
		max: number;
		/** `areas` for a Chart or Table (no schools or points), `where` for the other types. */
		offer: Exclude<PickerOffer, "monitors">;
		purpose: { dataset: string; entryType: string };
		onchange: (picks: Picks) => void;
		/**
		 * Keep mode: the picks are over a cap. The dialog opens at once to choose which to keep (at
		 * `keep.max`); Done calls `onkeep`, and Cancel, Escape or closing calls `oncancel` (once).
		 */
		keep?: {
			max: number;
			onkeep: (picks: Picks) => void;
			oncancel: () => void;
			/**
			 * Where focus goes when the dialog closes (the control that asked, say); false when it
			 * can't, and focus returns to Change places.
			 */
			restoreFocus?: () => boolean;
		};
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
	/** This open's keep request is answered (so closing after Done, or twice, cancels nothing). */
	let settled = false;
	/** Where the closing dialog returns focus, taken from the keep request it answered. */
	let restore: (() => boolean) | undefined;

	const pickerMode = $derived(
		keep
			? { kind: "multiple" as const, max: keep.max }
			: max > 1
				? { kind: "multiple" as const, max }
				: { kind: "single" as const }
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
				const options = await Promise.all(
					refs.map((ref) => resolveOption(ref, ctx, abort.signal).catch(() => null))
				);
				if (abort.signal.aborted) return;
				const names = options.every((o) => o !== null) ? options.map((o) => o!.name) : null;
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
		if (picks.length === 0) return m.get_data_where_everywhere();
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
		settled = false;
		open = true;
		void load(controller.signal);
	}

	function close(): void {
		restore = keep?.restoreFocus;
		open = false;
		controller?.abort();
		controller = null;
	}

	/** Cancel, Escape, or the dialog closing by itself. */
	function dismiss(): void {
		close();
		if (keep && !settled) {
			settled = true;
			keep.oncancel();
		}
	}

	function done(next: Picks): void {
		if (next.length === 0) {
			dismiss();
			return;
		}
		const keeping = keep && !settled ? keep : null;
		settled = true;
		close();
		if (keeping) keeping.onkeep(next);
		else onchange(next);
		void (async () => {
			try {
				for (const ref of [...next].reverse()) await addRecent(app.platform, app.space, ref);
			} catch (error) {
				report(error);
			}
		})();
	}

	$effect(() => () => controller?.abort());

	onMount(() => {
		if (keep) show();
	});
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
			// A keep request from elsewhere (Show as) takes focus back there; otherwise (the dialog
			// opened on mount, not from this button) focus returns to the button, which still exists.
			const back = restore;
			restore = undefined;
			if (!back?.()) opener?.focus();
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
