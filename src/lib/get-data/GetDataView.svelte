<script module lang="ts">
	/** The preview's widget id (it's in no dashboard). */
	export const PREVIEW_ID = "get-data-preview";
</script>

<script lang="ts">
	import { onDestroy, untrack } from "svelte";
	import { MediaQuery } from "svelte/reactivity";
	import { Button } from "$lib/components/ui/button";
	import { adapterIds, getMetadata } from "$lib/data";
	import { csvPending, saveDataCsv } from "$lib/data/csv";
	import type { CatalogEntry } from "$lib/data/metadata";
	import { LIMITS, type DateRangeSpec, type Layer, type Resolution } from "$lib/data/schema";
	import type { WidgetInstance } from "$lib/documents/schema";
	import { PHONE_QUERY } from "$lib/layout/config";
	import { m } from "$lib/paraglide/messages.js";
	import { fromLayer, toLayerPlaces, type Picks } from "$lib/places/selection";
	import { useApp } from "$lib/store/app.svelte";
	import { CHART_TYPE } from "$lib/widgets/chart";
	import { DEFAULT_RANGE } from "$lib/widgets/defaults";
	import { dataTypes, getWidgetType } from "$lib/widgets/registry";
	import { DataWidget } from "$lib/widgets/shared/data-widget.svelte";
	import { entryMeta, pollutantLayer } from "$lib/widgets/shared/input";
	import { MAX_OVERLAYS, overlayPlaceFor, sharedSource } from "$lib/widgets/shared/overlays";
	import { placeLabel } from "$lib/widgets/title";
	import { generatedTitle } from "$lib/widgets/titles.svelte";
	import ActionBar from "./ActionBar.svelte";
	import type { AddTarget } from "./add";
	import DetailControl from "./DetailControl.svelte";
	import { flushDraft, saveDraft, type Draft } from "./draft.svelte";
	import type { GetDataMode } from "./mode";
	import { offeredDatasets, typeBlock } from "./offer";
	import Preview, { type PreviewSize } from "./Preview.svelte";
	import { detailChoices } from "./resolution-offer";
	import ShowAs from "./ShowAs.svelte";
	import WhatSections from "./WhatSections.svelte";
	import WhenControl from "./WhenControl.svelte";
	import WhereControl from "./WhereControl.svelte";

	let {
		mode,
		initial,
		add,
		onSave,
		onCancel,
		onchange
	}: {
		mode: GetDataMode;
		initial: Draft;
		/** "Add to {name}": the dashboards offered, and the add (a dashboard id or `NEW_DASHBOARD`). */
		add?: {
			selected: AddTarget;
			others: AddTarget[];
			/** An add is running. */
			busy: boolean;
			onAdd: (targetId: string, draft: Draft) => void;
		};
		/** "Save changes" (editing a widget's data). */
		onSave?: (draft: Draft) => void;
		onCancel: () => void;
		/** The draft after each change (and once at the start). */
		onchange?: (draft: Draft) => void;
	} = $props();

	const app = useApp();
	const uid = $props.id();
	const now = new Date();

	// `initial` seeds the draft once; the view owns it from then on.
	const draft = $state<Draft>(structuredClone(untrack(() => $state.snapshot(initial)) as Draft));
	/** The draft as plain data, a new object on every change. */
	const plain = $derived($state.snapshot(draft) as Draft);

	let catalog = $state.raw<CatalogEntry[] | "unavailable" | undefined>();
	let catalogTry = $state(0);
	$effect(() => {
		void catalogTry;
		let active = true;
		catalog = undefined;
		void getMetadata()
			.catalog()
			.then((c) => {
				if (active) catalog = c;
			});
		return () => {
			active = false;
		};
	});
	const known = $derived(Array.isArray(catalog) ? catalog : undefined);

	const type = $derived(getWidgetType(plain.type));
	const range = $derived<DateRangeSpec>(plain.data.dateRange ?? DEFAULT_RANGE);
	const main = $derived(pollutantLayer(plain.data, known));
	const mainIndex = $derived(main ? plain.data.layers.indexOf(main) : -1);
	const picks = $derived(main ? fromLayer(main) : []);
	const overlayPicks = $derived(
		plain.data.layers
			.filter((l, i) => i !== mainIndex && l.entryType)
			.map((l) => ({ dataset: l.dataset, entryType: l.entryType! }))
	);

	const sections = $derived(
		known
			? offeredDatasets(known, adapterIds(), dataTypes()).filter((s) => s.entryTypes.length > 0)
			: []
	);
	const showAs = $derived(
		dataTypes().map((t) => ({
			type: t,
			block: known ? typeBlock(t, plain.data, known, now) : null
		}))
	);
	const choices = $derived.by(() => {
		const meta = entryMeta(known, main);
		if (!meta) return null;
		return detailChoices(meta.entryType, range, picks.length, type?.resolution, now);
	});

	// A detail level the range or places can no longer serve goes back to Automatic.
	$effect(() => {
		const level = main?.resolution;
		if (!choices || !level || level === "auto") return;
		const choice = choices.find((c) => c.level === level);
		if (!choice || choice.blocked) untrack(() => setDetail("auto"));
	});

	const previewWidget = $derived<WidgetInstance>({
		id: PREVIEW_ID,
		type: plain.type,
		title: null,
		rect: { x: 0, y: 0, w: type?.defaultSize.w ?? 3, h: type?.defaultSize.h ?? 6 },
		data: plain.data,
		...(plain.options ? { options: plain.options } : {})
	});

	// The same queries the preview runs (the query client shares them): every place's name for
	// Where, the overlays' series for "Overlay for", and when the data has settled.
	const data = new DataWidget(() => previewWidget, LIMITS.SELECTION_MAX);

	// The last data's names stay up while another range or type loads (a new query starts with
	// no data); they're dropped once the places change.
	const picksKey = $derived(JSON.stringify(picks));
	let lastNames = $state.raw<{ key: string; names: string[] } | null>(null);
	$effect(() => {
		const shown = data.shown;
		if (!("data" in shown) || !shown.data) return;
		const names = shown.data.places.map((p) => placeLabel(p, "owner"));
		const key = untrack(() => picksKey);
		lastNames = { key, names };
	});
	const names = $derived(lastNames?.key === picksKey ? lastNames.names : null);
	/** No names are coming: the query failed or can't run. */
	const namesSettled = $derived(data.shown.status !== "loading");

	/** "Overlay for": a Chart choice, only when the places' overlays differ (different zones). */
	const overlayFor = $derived.by(() => {
		if (plain.type !== CHART_TYPE || picks.length < 2) return null;
		const shown = data.shown;
		if (shown.status !== "ready") return null;
		const differ = data.overlays.some(
			(o) => o.state.status === "ready" && !sharedSource(o.state.data.series)
		);
		if (!differ) return null;
		const places = shown.data.places;
		const key = overlayPlaceFor(plain.options, places, picks);
		return {
			places,
			index: Math.max(
				0,
				places.findIndex((p) => p.place === key)
			)
		};
	});

	const title = $derived(generatedTitle(PREVIEW_ID) ?? type?.label() ?? "");

	// One polite announcement once the preview's data has settled, never per keystroke.
	let announcement = $state("");
	$effect(() => {
		if (data.shown.status !== "ready") return;
		const t = generatedTitle(PREVIEW_ID);
		if (t) announcement = m.get_data_preview_showing({ title: t });
	});

	$effect(() => {
		const snapshot = plain;
		untrack(() => onchange?.(snapshot));
	});

	// The draft is kept for a reload or a later visit; Edit data starts from the widget each time.
	$effect(() => {
		const snapshot = plain;
		if (mode.kind === "new") untrack(() => saveDraft(app.platform, app.space, snapshot));
	});
	$effect(() => {
		const flush = () => flushDraft();
		window.addEventListener("pagehide", flush);
		return () => window.removeEventListener("pagehide", flush);
	});
	onDestroy(flushDraft);

	let size = $state<PreviewSize>("large");
	let width = $state(0);
	const phone = new MediaQuery(PHONE_QUERY);

	// Edits. The main layer is always there (a pollutant, required); overlays follow it.
	function mainLayer(): Layer | undefined {
		return mainIndex >= 0 ? draft.data.layers[mainIndex] : undefined;
	}

	function setRange(spec: DateRangeSpec): void {
		draft.data.dateRange = spec;
	}

	function setPlaces(next: Picks): void {
		const layer = mainLayer();
		if (!layer) return;
		delete layer.place;
		delete layer.selection;
		Object.assign(layer, toLayerPlaces(next));
	}

	function setMain(pick: { dataset: string; entryType: string }): void {
		const layer = mainLayer();
		if (!layer) return;
		layer.dataset = pick.dataset;
		layer.entryType = pick.entryType;
		// A detail level the new entry type doesn't offer goes back to Automatic.
		const offered = entryMeta(known, layer)?.entryType.resolutions ?? [];
		if (layer.resolution && layer.resolution !== "auto" && !offered.includes(layer.resolution)) {
			delete layer.resolution;
		}
	}

	function toggleOverlay(pick: { dataset: string; entryType: string }, on: boolean): void {
		const layers = draft.data.layers;
		const at = layers.findIndex(
			(l, i) => i !== mainIndex && l.dataset === pick.dataset && l.entryType === pick.entryType
		);
		if (on && at < 0 && overlayPicks.length < MAX_OVERLAYS) {
			layers.push({ dataset: pick.dataset, entryType: pick.entryType });
		} else if (!on && at >= 0) {
			layers.splice(at, 1);
		}
	}

	function setDetail(level: "auto" | Resolution): void {
		const layer = mainLayer();
		if (!layer) return;
		if (level === "auto") delete layer.resolution;
		else layer.resolution = level;
	}

	function setType(next: string): void {
		draft.type = next;
	}

	function setOverlayFor(index: number): void {
		const ref = picks[index];
		if (ref) draft.options = { ...draft.options, overlayFor: ref };
	}

	function download(): void {
		void saveDataCsv("get-data", plain.data, (name, contents, type) =>
			app.platform.files.save(name, contents, type)
		);
	}
</script>

<div class="flex min-h-full flex-col" bind:clientWidth={width}>
	<div
		class="grid flex-1 gap-(--grid-gap) p-(--grid-gap) md:grid-cols-[minmax(16rem,20rem)_minmax(0,1fr)]"
	>
		<div class="flex min-w-0 flex-col gap-4">
			<section class="flex flex-col gap-2" aria-labelledby="{uid}-when">
				<h2 id="{uid}-when" class="text-primary text-sm font-semibold">{m.get_data_when()}</h2>
				{#if type}
					<WhenControl {type} value={range} {now} onchange={setRange} />
				{/if}
			</section>

			<section class="flex flex-col gap-2" aria-labelledby="{uid}-where">
				<h2 id="{uid}-where" class="text-primary text-sm font-semibold">{m.get_data_where()}</h2>
				{#if main?.entryType}
					<WhereControl
						{picks}
						{names}
						{namesSettled}
						max={type?.accepts?.maxPlaces ?? 1}
						purpose={{ dataset: main.dataset, entryType: main.entryType }}
						onchange={setPlaces}
					/>
				{/if}
			</section>

			<section class="flex flex-col gap-2" aria-labelledby="{uid}-what">
				<h2 id="{uid}-what" class="text-primary text-sm font-semibold">{m.get_data_what()}</h2>
				{#if catalog === undefined}
					<p role="status" class="text-muted-foreground text-sm">{m.get_data_loading()}</p>
				{:else if catalog === "unavailable"}
					<div class="flex flex-wrap items-center gap-2">
						<p role="status" class="text-sm">{m.get_data_catalog_unavailable()}</p>
						<Button variant="outline" size="sm" onclick={() => catalogTry++}>
							{m.get_data_retry()}
						</Button>
					</div>
				{:else}
					<WhatSections
						{sections}
						main={main?.entryType
							? { dataset: main.dataset, entryType: main.entryType }
							: undefined}
						overlays={overlayPicks}
						maxOverlays={MAX_OVERLAYS}
						onmain={setMain}
						ontoggle={toggleOverlay}
					/>
				{/if}
			</section>

			{#if choices}
				<section>
					<DetailControl {choices} value={main?.resolution ?? "auto"} onchange={setDetail} />
				</section>
			{/if}
		</div>

		<div class="flex min-w-0 flex-col gap-2">
			<ShowAs types={showAs} value={plain.type} onchange={setType} />
			{#if overlayFor}
				<label class="flex flex-wrap items-center gap-2 text-sm">
					<span class="font-medium">{m.get_data_overlay_for()}</span>
					<select
						value={String(overlayFor.index)}
						onchange={(e) => setOverlayFor(Number(e.currentTarget.value))}
						class="border-input bg-card text-field h-8 min-w-0 rounded-(--radius-control) border px-2 md:text-sm"
					>
						{#each overlayFor.places as place, i (place.place)}
							<option value={String(i)}>{placeLabel(place, "owner")}</option>
						{/each}
					</select>
				</label>
			{/if}
			<Preview
				widget={previewWidget}
				{title}
				{size}
				gridWidth={width}
				phone={phone.current}
				onsize={(s) => (size = s)}
			/>
		</div>
	</div>

	<p role="status" class="sr-only" data-testid="get-data-announcement">{announcement}</p>

	<ActionBar
		downloading={csvPending("get-data")}
		ondownload={download}
		oncancel={onCancel}
		add={add && {
			selected: add.selected,
			others: add.others,
			busy: add.busy,
			onadd: (targetId) => add.onAdd(targetId, plain)
		}}
		onsave={onSave && (() => onSave(plain))}
	/>
</div>
