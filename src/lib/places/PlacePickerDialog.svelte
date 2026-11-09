<script module lang="ts">
	/** How long a live-link lookup of "your location"'s region may take before it counts as failed. */
	const LOOKUP_TIMEOUT_MS = 20_000;
</script>

<script lang="ts">
	import { untrack } from "svelte";
	import { toast } from "svelte-sonner";
	import { announce } from "$lib/a11y/announcer.svelte";
	import { placePicker } from "$lib/components/dialogs/lazy.svelte";
	import { Button } from "$lib/components/ui/button";
	import * as Dialog from "$lib/components/ui/dialog";
	import { getMetadata, getResolvers, placeRegion } from "$lib/data";
	import type { CatalogEntry } from "$lib/data/metadata";
	import type { Layer, WidgetDataConfig } from "$lib/data/schema";
	import type { WidgetInstance } from "$lib/documents/schema";
	import { requestFocus } from "$lib/layout/focus-request.svelte";
	import { m } from "$lib/paraglide/messages.js";
	import { report } from "$lib/safety/report";
	import { useApp } from "$lib/store/app.svelte";
	import type { DocumentSession } from "$lib/store/document-session.svelte";
	import { calendarInput } from "$lib/calendars/input";
	import { isCalendarType } from "$lib/calendars/types";
	import { getWidgetType } from "$lib/widgets/registry";
	import {
		chartInput,
		nowInput,
		placesEntryType,
		placesLayer,
		placesQueryLayer
	} from "$lib/widgets/shared/input";
	import { pickedData } from "./apply";
	import type { PlaceDirectory } from "./directory";
	import { directoryFor, resolvePicks, type Resolvers } from "./host";
	import PlacePicker from "./PlacePicker.svelte";
	import { addRecent, readRecent } from "./recent";
	import { regionName as nameOf } from "./region-name";
	import { fromLayer, type PickerMode, type Picks } from "./selection";
	import type { PlaceOption, PointPlace } from "./types";

	const app = useApp();

	type Ready = {
		widgetId: string;
		directory: PlaceDirectory;
		resolvers: Resolvers;
		catalog: CatalogEntry[] | undefined;
		max: number;
		purpose: { dataset: string; entryType: string };
		mode: PickerMode;
		initial: Picks;
		known: PlaceOption[];
		recent: PlaceOption[];
	};

	let ready = $state.raw<Ready | null>(null);
	let content = $state<HTMLElement | null>(null);
	let phase = $state<"loading" | "failed" | "ready">("loading");
	/** A live-link Done looking up the region "your location" is saved as. */
	let lookup = $state<"idle" | "looking" | "failed">("idle");
	/** Kept mounted through the close animation; unmounted once closed. */
	let mounted = $state(false);
	/** The picks of a Done whose lookup failed, for Retry. */
	let pending: Picks | null = null;
	/** Counts Done presses, so only the latest one applies. */
	let doneRun = 0;
	/** This opening's work; aborted when the dialog closes. */
	let controller: AbortController | null = null;

	const showPicker = $derived(mounted && phase === "ready" && ready !== null);
	const failed = $derived(phase === "failed");

	const title = $derived(
		ready?.mode.kind === "multiple"
			? m.place_picker_dialog_title_multiple()
			: m.place_picker_dialog_title()
	);

	// Each opening starts fresh; closing aborts whatever it was doing.
	$effect(() => {
		const open = placePicker.open;
		void placePicker.opening;
		untrack(() => {
			controller?.abort();
			controller = null;
			if (!open) return;
			controller = new AbortController();
			mounted = true;
			void load(controller.signal);
		});
	});
	$effect(() => () => controller?.abort());

	/** The editable session and the widget in it, read when needed. */
	function find(): { session: DocumentSession; widget: WidgetInstance } | null {
		const session = app.current.session;
		const id = placePicker.widgetId;
		if (!session || session.readOnly || !id) return null;
		const widget = session.doc.body.widgets.find((w) => w.id === id);
		return widget ? { session, widget } : null;
	}

	function close(): void {
		placePicker.open = false;
	}

	async function load(signal: AbortSignal): Promise<void> {
		phase = "loading";
		ready = null;
		lookup = "idle";
		pending = null;
		try {
			const metadata = getMetadata();
			const resolvers = getResolvers();
			const directory = directoryFor(metadata, resolvers.regions);
			const found = await metadata.catalog(signal);
			const catalog = found === "unavailable" ? undefined : found;
			if (signal.aborted) return;
			const target = find();
			const max = target ? (getWidgetType(target.widget.type)?.accepts?.maxPlaces ?? 0) : 0;
			const layer = target ? placesLayer(target.widget.data, catalog) : undefined;
			if (!target || max < 1 || !layer) {
				close();
				return;
			}
			// A Forecast strip's layer has no entry type: its places are picked as PM2.5's are.
			const entryType = placesEntryType(layer);
			const initial = fromLayer(layer);
			const recentRefs = await readRecent(app.platform, app.space).catch((error: unknown) => {
				report(error);
				return [];
			});
			const picks = await resolvePicks(
				initial,
				recentRefs,
				{ directory, resolvers, entryType },
				signal
			);
			if (signal.aborted) return;
			ready = {
				widgetId: target.widget.id,
				directory,
				resolvers,
				catalog,
				max,
				purpose: { dataset: layer.dataset, entryType },
				mode: max > 1 ? { kind: "multiple", max } : { kind: "single" },
				...picks
			};
			phase = "ready";
		} catch (error) {
			if (signal.aborted) return;
			report(error);
			phase = "failed";
		}
	}

	/** The data with the main layer's places swapped for `point`. */
	function withPoint(data: WidgetDataConfig, layer: Layer, point: PointPlace): WidgetDataConfig {
		// eslint-disable-next-line @typescript-eslint/no-unused-vars -- dropped from the copy
		const { place, selection, ...rest } = layer;
		return {
			...data,
			layers: data.layers.map((l) => (l === layer ? { ...rest, place: point } : l))
		};
	}

	/** The region the widget would use for `point`, aborted with the dialog or after a timeout. */
	async function regionOf(
		ctx: Ready,
		widgetType: string,
		data: WidgetDataConfig,
		point: PointPlace,
		signal: AbortSignal
	): Promise<{ type: string; code: string } | null> {
		const layer = placesLayer(data, ctx.catalog);
		if (!layer) return null;
		// A Forecast strip's layer is looked up as a PM2.5 one at the same place.
		const pointData = withPoint(data, layer, point);
		const lookup = {
			...pointData,
			layers: pointData.layers.map(placesQueryLayer)
		};
		// A now tile reads the layer's hourly averages, not 30 days of them.
		// A calendar reads one daily row per day.
		const input = isCalendarType(widgetType)
			? calendarInput(lookup, ctx.catalog, widgetType)
			: getWidgetType(widgetType)?.time === "now"
				? nowInput(placesLayer(lookup, ctx.catalog))
				: chartInput(lookup, ctx.catalog, ctx.max).input;
		if (!input) return null;
		const timed = new AbortController();
		const stop = () => timed.abort();
		signal.addEventListener("abort", stop, { once: true });
		const timer = setTimeout(stop, LOOKUP_TIMEOUT_MS);
		try {
			return await placeRegion(input, timed.signal);
		} finally {
			clearTimeout(timer);
			signal.removeEventListener("abort", stop);
		}
	}

	async function done(picks: Picks): Promise<void> {
		const ctx = ready;
		const signal = controller?.signal;
		if (!ctx || !signal || signal.aborted) return;
		const run = ++doneRun;
		const stale = () => signal.aborted || run !== doneRun;
		const target = find();
		if (!target) {
			close();
			return;
		}
		pending = picks;
		// Read now, not at opening: a link turned on meanwhile counts. A live link without "Share my
		// exact location" gets the point's region.
		const state = app.sync?.states[target.session.doc.id];
		const liveLink = !!state?.shareToken && !state.shareExact;
		lookup = liveLink && picks[0]?.kind === "point" ? "looking" : "idle";
		let result: Awaited<ReturnType<typeof pickedData>>;
		try {
			result = await pickedData(target.widget.data, picks, {
				liveLink,
				catalog: ctx.catalog,
				regionOf: (point) => regionOf(ctx, target.widget.type, target.widget.data, point, signal)
			});
		} catch {
			if (stale()) return;
			lookup = "failed";
			return;
		}
		if (stale()) return;
		const saved = result?.savedAsRegion ?? null;
		let regionName: string | null = null;
		if (saved) {
			regionName = await nameOf(ctx.resolvers.regions, saved, signal);
			if (stale()) return;
		}
		// Applied to the widget as it is now (an edit made meanwhile isn't undone).
		let applied = false;
		const latest = find();
		if (latest && result) {
			const final = saved ? [{ kind: "region" as const, ...saved }] : picks;
			const next = await pickedData(latest.widget.data, final, {
				liveLink: false,
				catalog: ctx.catalog,
				regionOf: async () => null
			});
			if (stale()) return;
			if (next) {
				latest.session.apply({
					op: "setWidgetData",
					target: { widgetId: latest.widget.id },
					from: latest.widget.data,
					to: next.data
				});
				applied = true;
			}
		}
		void remember(picks);
		close();
		// Said only when it was saved (an edit made meanwhile may already have made it so).
		if (applied && regionName) {
			const text = m.place_picker_saved_as_region({ region: regionName });
			toast(text);
			// The toast's own region is cut off by this dialog until it has gone.
			announce(text, { onlyInDialog: true });
		}
	}

	/** Adds the picks to Recent, the first newest ("your location" never is). */
	async function remember(picks: Picks): Promise<void> {
		try {
			for (const ref of [...picks].reverse()) await addRecent(app.platform, app.space, ref);
		} catch (error) {
			report(error);
		}
	}

	function retry(): void {
		if (pending) void done(pending);
	}

	/** The search box when the picker is already shown; else the dialog, until the picker focuses it. */
	function onOpenAutoFocus(event: Event): void {
		event.preventDefault();
		(content?.querySelector<HTMLElement>("[role=combobox]") ?? content)?.focus();
	}

	function onCloseAutoFocus(event: Event): void {
		event.preventDefault();
		const opener = placePicker.opener;
		if (opener?.isConnected) opener.focus();
		else if (placePicker.widgetId) requestFocus({ kind: "title", id: placePicker.widgetId });
	}
</script>

<Dialog.Root
	bind:open={placePicker.open}
	onOpenChangeComplete={(open) => {
		if (!open) mounted = false;
	}}
>
	<Dialog.Content
		bind:ref={content}
		tabindex={-1}
		data-place-picker-dialog
		class="flex max-h-[85dvh] flex-col overflow-y-auto max-sm:top-0 max-sm:left-0 max-sm:h-dvh max-sm:max-h-none max-sm:w-full max-sm:max-w-none max-sm:translate-x-0 max-sm:translate-y-0 max-sm:rounded-none max-sm:border-0 sm:max-w-lg"
		{onOpenAutoFocus}
		{onCloseAutoFocus}
	>
		<Dialog.Header>
			<Dialog.Title>{title}</Dialog.Title>
			<!-- A live-link Done's lookup: rendered empty first, so its messages are announced. -->
			<div class="flex flex-wrap items-center gap-2 text-sm">
				<p role="status">
					{#if lookup === "looking"}{m.place_picker_dialog_looking_up()}{:else if lookup === "failed"}{m.place_picker_dialog_lookup_failed()}{/if}
				</p>
				{#if lookup === "failed"}
					<Button variant="outline" size="xs" onclick={retry}>{m.place_picker_retry()}</Button>
				{/if}
			</div>
		</Dialog.Header>
		{#if showPicker && ready}
			<PlacePicker
				directory={ready.directory}
				purpose={ready.purpose}
				mode={ready.mode}
				initial={ready.initial}
				known={ready.known}
				recent={ready.recent}
				locate={(signal) => app.platform.geolocation.locate(signal)}
				pointKeys={(lat, lon, signal) => ready!.resolvers.points.keys(lat, lon, signal)}
				ondone={(picks) => void done(picks)}
				oncancel={close}
			/>
		{/if}
		<!-- One persistent status for loading and failure, so either is announced. -->
		<div class={["flex flex-wrap items-center gap-2 text-sm", showPicker && "sr-only"]}>
			<p role="status" data-place-picker-load-status class={[!failed && "text-muted-foreground"]}>
				{#if failed}{m.place_picker_dialog_failed()}{:else if !showPicker}{m.place_picker_dialog_loading()}{/if}
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
