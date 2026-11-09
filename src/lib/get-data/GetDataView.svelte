<script module lang="ts">
	/** The preview's widget id (it's in no dashboard). */
	export const PREVIEW_ID = "get-data-preview";
</script>

<script lang="ts">
	import { onDestroy, untrack } from "svelte";
	import { MediaQuery } from "svelte/reactivity";
	import { Button } from "$lib/components/ui/button";
	import { adapterOffers, getMetadata } from "$lib/data";
	import { csvPending, saveDataCsv } from "$lib/data/csv";
	import type { CatalogEntry, Level } from "$lib/data/metadata";
	import {
		LIMITS,
		type DateRangeSpec,
		type Layer,
		type PesticideFilters,
		type Resolution
	} from "$lib/data/schema";
	import type { WidgetInstance } from "$lib/documents/schema";
	import { PHONE_QUERY } from "$lib/layout/config";
	import { m } from "$lib/paraglide/messages.js";
	import { fromLayer, toLayerPlaces, type Picks } from "$lib/places/selection";
	import { useApp } from "$lib/store/app.svelte";
	import { CHART_TYPE } from "$lib/widgets/chart";
	import { DEFAULT_RANGE } from "$lib/widgets/defaults";
	import { CURRENT_TYPE } from "$lib/widgets/current";
	import { dataTypes, getWidgetType, type WidgetType } from "$lib/widgets/registry";
	import { DataWidget } from "$lib/widgets/shared/data-widget.svelte";
	import {
		entryMeta,
		mainLayer,
		placesEntryType,
		placesLayer,
		placesQueryLayer
	} from "$lib/widgets/shared/input";
	import { MAX_OVERLAYS, overlayPlaceFor, sharedSource } from "$lib/widgets/shared/overlays";
	import * as layers from "./layers";
	import { placeLabel } from "$lib/widgets/title";
	import { generatedTitle } from "$lib/widgets/titles.svelte";
	import ActionBar from "./ActionBar.svelte";
	import type { AddTarget } from "./add";
	import ShowValuesControl from "./ShowValuesControl.svelte";
	import { flushDraft, saveDraft, type Draft } from "./draft.svelte";
	import type { GetDataMode } from "./mode";
	import {
		fromNowDraft,
		isNowShaped,
		keptThreshold,
		nowPollutant,
		nowPollutants,
		toNowDraft,
		type NowConversion
	} from "./now";
	import NowControls from "./NowControls.svelte";
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
	/** A "now" type: no dates, one layer with one place (see `now.ts`). */
	const isNow = $derived(type?.time === "now");
	const range = $derived<DateRangeSpec>(plain.data.dateRange ?? DEFAULT_RANGE);
	// A Forecast strip's one layer has no entry type, so isn't a `mainLayer`; it holds the place.
	const main = $derived(isNow ? placesLayer(plain.data, known) : mainLayer(plain.data, known));
	const mainIndex = $derived(main ? plain.data.layers.indexOf(main) : -1);
	const picks = $derived(main ? fromLayer(main) : []);
	/** Only level layers (smoke, burn status): nothing to chart, so no Add, Save or Download. */
	const levelOnly = $derived(layers.levelOnly(plain.data, known));

	const sections = $derived(
		known
			? offeredDatasets(known, adapterOffers(), dataTypes()).filter((s) => s.entryTypes.length > 0)
			: []
	);
	// A now type is never blocked: choosing it converts the draft (`toNowDraft`).
	const showAs = $derived(
		dataTypes().map((t) => ({
			type: t,
			block: known && t.time !== "now" ? typeBlock(t, plain.data, known, now) : null
		}))
	);
	const choices = $derived.by(() => {
		if (isNow) return null;
		const meta = entryMeta(known, main);
		if (!meta) return null;
		return detailChoices(
			meta.dataset.id,
			meta.entryType,
			range,
			picks.length,
			type?.resolution,
			now
		);
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
		...(plain.options ? { options: plain.options } : {}),
		...(plain.thresholds ? { thresholds: plain.thresholds } : {})
	});

	// The same queries the preview runs (the query client shares them): every place's name for
	// Where, the overlays' series for "Overlay for", and when the data has settled. A now tile
	// sets its own generated title, so for those this runs under another id (two writers of one
	// title would undo each other forever), and a Forecast strip's place is named through a PM2.5
	// layer, as its picker offers places.
	const namesWidget = $derived.by<WidgetInstance>(() => {
		if (!isNow) return previewWidget;
		const layers = plain.data.layers.map(placesQueryLayer);
		return { ...previewWidget, id: `${PREVIEW_ID}-names`, data: { ...plain.data, layers } };
	});
	const data = new DataWidget(() => namesWidget, LIMITS.SELECTION_MAX);

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

	// Edits. The main layer holds the places and the level; overlays follow it (see `layers.ts`).
	function mainDraftLayer(): Layer | undefined {
		return mainIndex >= 0 ? draft.data.layers[mainIndex] : undefined;
	}

	function setRange(spec: DateRangeSpec): void {
		draft.data.dateRange = spec;
	}

	function setPlaces(next: Picks): void {
		const layer = mainDraftLayer();
		if (!layer) return;
		delete layer.place;
		delete layer.selection;
		Object.assign(layer, toLayerPlaces(next));
		layers.dropStationOnPlaceChange(draft.data);
	}

	function setPollutant(pick: layers.EntryPick | null): void {
		layers.setPollutant(draft.data, known, pick);
	}

	function toggleLayer(pick: layers.EntryPick, on: boolean): void {
		layers.toggleLayer(draft.data, known, pick, on);
	}

	function addPesticideLayer(entryType: string): void {
		layers.addPesticideLayer(draft.data, known, entryType);
	}

	function removeLayer(index: number): void {
		layers.removeLayer(draft.data, known, index);
	}

	function setFilters(index: number, filters: PesticideFilters): void {
		layers.setFilters(draft.data, index, filters);
	}

	function setStation(station: string | undefined): void {
		layers.setStation(draft.data, station);
	}

	function setDetail(level: "auto" | Resolution): void {
		const layer = mainDraftLayer();
		if (!layer) return;
		if (level === "auto") delete layer.resolution;
		else layer.resolution = level;
	}

	/** What the last conversion left out or changed, until the next edit of the form. */
	let dropped = $state.raw<{ after: string; conversion: NowConversion } | null>(null);
	const notes = $derived.by(() => {
		if (!dropped || dropped.after !== JSON.stringify(plain)) return [];
		const { dropped: what, pollutant } = dropped.conversion;
		const out: string[] = [];
		if (what.some((d) => d === "dates" || d === "overlays" || d === "places")) {
			out.push(m.get_data_now_dropped());
		}
		if (pollutant) {
			const label = (dataset: string, entryType: string) =>
				entryMeta(known, { dataset, entryType })?.entryType.label ?? entryType;
			out.push(
				m.get_data_pollutant_instead({
					pollutant: label("air-quality", pollutant.to),
					previous: label(pollutant.from.dataset, pollutant.from.entryType)
				})
			);
		}
		if (what.includes("alert")) out.push(m.get_data_alert_left_out());
		return out;
	});

	/** Shows `conversion`'s notes until the draft changes. */
	function noteConversion(conversion: NowConversion): void {
		dropped = { after: JSON.stringify($state.snapshot(draft)), conversion };
	}

	/** Replaces the whole draft (a conversion between range and now types). */
	function replaceDraft(next: Draft): void {
		draft.type = next.type;
		draft.data = next.data;
		if (next.options) draft.options = next.options;
		else delete draft.options;
		if (next.thresholds) draft.thresholds = next.thresholds;
		else delete draft.thresholds;
	}

	/** A pollutant's scale (empty when it has none), or `"unavailable"` when it can't be loaded. */
	async function levelsOf(entryType: string | undefined): Promise<Level[] | "unavailable"> {
		if (!entryType) return [];
		try {
			return await getMetadata().levels(entryType);
		} catch {
			return "unavailable";
		}
	}

	/** Bumped by each type or pollutant change, so a slower earlier one doesn't land after it. */
	let changeId = 0;
	/**
	 * A conversion that should have set the default alert level couldn't load the scale: it's set
	 * once the scale loads, unless the person chooses one first.
	 */
	let defaultOwed = false;

	/** The type `snapshot` converts from: none for a range draft already marked as a now type. */
	function sourceType(snapshot: Draft): WidgetType | undefined {
		const from = getWidgetType(snapshot.type);
		return from?.time === "now" && !isNowShaped(snapshot, from) ? undefined : from;
	}

	/** The draft as now type `next`, once its pollutant's scale has loaded. */
	async function convertToNow(next: WidgetType, catalog: CatalogEntry[]): Promise<void> {
		const id = ++changeId;
		const pollutant = nowPollutant($state.snapshot(draft) as Draft, next, catalog);
		const levels = await levelsOf(pollutant);
		if (id !== changeId) return;
		// An edit made while the scale loaded counts: convert the draft as it is now (again, when
		// that edit changed the pollutant).
		const fresh = $state.snapshot(draft) as Draft;
		if (nowPollutant(fresh, next, catalog) !== pollutant) return convertToNow(next, catalog);
		const converted = toNowDraft(fresh, next, catalog, levels, sourceType(fresh));
		alertLevels = { entryType: nowEntryType(converted.draft), levels };
		defaultOwed = !!converted.defaultOwed;
		replaceDraft(converted.draft);
		noteConversion(converted);
	}

	function setType(next: string): void {
		const to = getWidgetType(next);
		if (!to) return;
		if (to.time === "now" && known) {
			void convertToNow(to, known);
			return;
		}
		changeId++;
		defaultOwed = false;
		if (to.time !== "now" && isNow) {
			const converted = fromNowDraft(plain, to);
			replaceDraft(converted.draft);
			noteConversion(converted);
		}
		// A now type chosen before the catalog is known is converted once it is (below).
		else draft.type = next;
	}

	// A draft that's a now type but not in its shape (opened from a `?type=` link or a stored
	// draft, or the type chosen before the catalog arrived) is converted once the catalog is
	// known. A saved now widget already has the shape.
	$effect(() => {
		const to = type;
		if (!known || to?.time !== "now") return;
		if (!untrack(() => isNowShaped(plain, to))) void convertToNow(to, known);
	});

	// The alert level: the pollutant's scale ("Can we go outside?" reads PM2.5 whatever's saved).
	const nowEntryType = (d: Draft) =>
		d.type === CURRENT_TYPE
			? d.data.layers[0]?.entryType
			: nowPollutant(d, getWidgetType(d.type)!, known ?? []);
	let alertLevels = $state.raw<{
		entryType: string | undefined;
		levels: Level[] | "unavailable";
	} | null>(null);
	let alertTry = $state(0);
	const alertEntryType = $derived(
		isNow && type?.thresholds && known ? nowEntryType(plain) : undefined
	);
	$effect(() => {
		void alertTry;
		const entryType = alertEntryType;
		if (!entryType) return;
		const have = untrack(() => alertLevels);
		if (have?.entryType === entryType && have.levels !== "unavailable") return;
		let active = true;
		void levelsOf(entryType).then((levels) => {
			if (!active) return;
			alertLevels = { entryType, levels };
			if (Array.isArray(levels)) untrack(() => payDefault(levels));
		});
		return () => {
			active = false;
		};
	});
	const shownLevels = $derived(
		alertEntryType && alertLevels?.entryType === alertEntryType ? alertLevels.levels : null
	);

	/** Sets the default alert level a conversion owed, keeping its notes up. */
	function payDefault(levels: Level[]): void {
		if (!defaultOwed) return;
		defaultOwed = false;
		if (draft.thresholds) return;
		const noted = !!dropped && dropped.after === JSON.stringify(plain);
		const thresholds = keptThreshold(undefined, levels, true);
		if (!thresholds) return;
		draft.thresholds = thresholds;
		if (noted && dropped) noteConversion(dropped.conversion);
	}

	/**
	 * Current conditions' pollutant: the alert level keeps its key if the new scale has it, else
	 * takes its default. When the scale can't be loaded, the alert level is kept as it is.
	 */
	async function setNowPollutant(entryType: string): Promise<void> {
		const id = ++changeId;
		const levels = await levelsOf(entryType);
		if (id !== changeId) return;
		const layer = draft.data.layers[0];
		if (!layer) return;
		layer.entryType = entryType;
		alertLevels = { entryType, levels };
		if (levels === "unavailable") return;
		const thresholds = keptThreshold($state.snapshot(draft.thresholds), levels, false);
		if (thresholds) draft.thresholds = thresholds;
		else delete draft.thresholds;
	}

	function setThreshold(level: string | null): void {
		defaultOwed = false;
		if (level) draft.thresholds = [{ level }];
		else delete draft.thresholds;
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
			{#if notes.length > 0}
				<div role="status" class="flex flex-col gap-1">
					{#each notes as note (note)}
						<p class="text-muted-foreground text-sm">{note}</p>
					{/each}
				</div>
			{/if}

			{#if !isNow}
				<section class="flex flex-col gap-2" aria-labelledby="{uid}-when">
					<h2 id="{uid}-when" class="text-primary text-sm font-semibold">{m.get_data_when()}</h2>
					{#if type}
						<WhenControl {type} value={range} {now} onchange={setRange} />
					{/if}
				</section>
			{/if}

			<section class="flex flex-col gap-2" aria-labelledby="{uid}-where">
				<h2 id="{uid}-where" class="text-primary text-sm font-semibold">{m.get_data_where()}</h2>
				{#if main?.entryType || (isNow && main)}
					<WhereControl
						{picks}
						{names}
						{namesSettled}
						max={type?.accepts?.maxPlaces ?? 1}
						purpose={{
							dataset: main.dataset,
							// A Forecast strip's place is any place PM2.5 is offered for.
							entryType: placesEntryType(main)
						}}
						onchange={setPlaces}
					/>
				{/if}
			</section>

			{#snippet catalogState()}
				{#if catalog === undefined}
					<p role="status" class="text-muted-foreground text-sm">{m.get_data_loading()}</p>
				{:else if catalog === "unavailable"}
					<div class="flex flex-wrap items-center gap-2">
						<p role="status" class="text-sm">{m.get_data_catalog_unavailable()}</p>
						<Button variant="outline" size="sm" onclick={() => catalogTry++}>
							{m.get_data_retry()}
						</Button>
					</div>
				{/if}
			{/snippet}

			{#if isNow}
				{#if !known}
					{@render catalogState()}
				{:else if plain.type === CURRENT_TYPE || type?.thresholds}
					<section class="flex flex-col gap-3" aria-labelledby="{uid}-what">
						<h2 id="{uid}-what" class="text-primary text-sm font-semibold">
							{m.get_data_what()}
						</h2>
						<NowControls
							pollutants={plain.type === CURRENT_TYPE ? nowPollutants(known) : null}
							entryType={main?.entryType}
							levels={type?.thresholds ? shownLevels : null}
							thresholds={plain.thresholds}
							onpollutant={(e) => void setNowPollutant(e)}
							onthreshold={setThreshold}
							onretry={() => alertTry++}
						/>
					</section>
				{/if}
			{:else}
				<section class="flex flex-col gap-2" aria-labelledby="{uid}-what">
					<h2 id="{uid}-what" class="text-primary text-sm font-semibold">{m.get_data_what()}</h2>
					{#if !known}
						{@render catalogState()}
					{:else}
						<WhatSections
							{sections}
							data={plain.data}
							catalog={known}
							places={picks.length}
							maxOverlays={MAX_OVERLAYS}
							onpollutant={setPollutant}
							ontoggle={toggleLayer}
							onaddpesticide={addPesticideLayer}
							onremove={removeLayer}
							onfilters={setFilters}
							onstation={setStation}
						/>
					{/if}
				</section>
			{/if}

			{#if choices}
				<section>
					<ShowValuesControl {choices} value={main?.resolution ?? "auto"} onchange={setDetail} />
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
		blocked={levelOnly ? m.get_data_level_only() : undefined}
		downloading={csvPending("get-data")}
		ondownload={type?.downloadable ? download : undefined}
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
