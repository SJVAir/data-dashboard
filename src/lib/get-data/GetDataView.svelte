<script module lang="ts">
	/** The preview's widget id (it's in no dashboard). */
	export const PREVIEW_ID = "get-data-preview";
</script>

<script lang="ts">
	import { onDestroy, untrack } from "svelte";
	import { MediaQuery } from "svelte/reactivity";
	import { Button } from "$lib/components/ui/button";
	import { adapterOffers, getMetadata, getResolvers } from "$lib/data";
	import { csvPending, saveDataCsv } from "$lib/data/csv";
	import type { CatalogEntry, Level } from "$lib/data/metadata";
	import { fillableTypes } from "$lib/data/snapshot";
	import type { DateRangeSpec, Layer, PesticideFilters } from "$lib/data/schema";
	import type { WidgetInstance } from "$lib/documents/schema";
	import { PHONE_QUERY } from "$lib/layout/config";
	import { m } from "$lib/paraglide/messages.js";
	import { directoryFor } from "$lib/places/host";
	import { fromWhere, toWhere, type Picks } from "$lib/places/selection";
	import type { RegionTypeInfo } from "$lib/places/types";
	import { report } from "$lib/safety/report";
	import { useApp } from "$lib/store/app.svelte";
	import { CHART_TYPE } from "$lib/widgets/chart";
	import { DATA_TABLE_TYPE } from "$lib/widgets/table";
	import { DEFAULT_LAYER, DEFAULT_RANGE } from "$lib/widgets/defaults";
	import { CURRENT_TYPE } from "$lib/widgets/current";
	import { MAP_TYPE } from "$lib/widgets/map";
	import {
		HMS_FIRE,
		HMS_SMOKE,
		MAP_MAX_STOPS,
		PESTICIDE_NOTICES,
		PESTICIDE_USE,
		mapOptions
	} from "$lib/widgets/map/options";
	import { dataTypes, getWidgetType, placeLimit, type WidgetType } from "$lib/widgets/registry";
	import { offersNow } from "$lib/widgets/time";
	import { DataWidget } from "$lib/widgets/shared/data-widget.svelte";
	import {
		entryMeta,
		mainLayer,
		wherePurpose,
		widgetEffective,
		widgetMonitors,
		widgetPlaceKind
	} from "$lib/widgets/shared/input";
	import {
		lineRefs,
		MAX_OVERLAYS,
		overlayPlaceFor,
		overlayRefOf,
		sharedSource
	} from "$lib/widgets/shared/overlays";
	import * as layers from "./layers";
	import { placeLabel } from "$lib/widgets/title";
	import { generatedTitle } from "$lib/widgets/titles.svelte";
	import ActionBar from "./ActionBar.svelte";
	import type { AddTarget } from "./add";
	import DataResolutionControl from "./DataResolutionControl.svelte";
	import MoreOptions from "./MoreOptions.svelte";
	import { flushDraft, saveDraft, type Draft } from "./draft.svelte";
	import type { GetDataMode } from "./mode";
	import {
		fromNowDraft,
		isNowShaped,
		keptThreshold,
		nowPollutant,
		nowPollutants,
		offeredPollutants,
		selectionFits,
		switchRange,
		toNowDraft,
		type NowConversion,
		type NowDropped
	} from "./now";
	import NowControls from "./NowControls.svelte";
	import {
		fromMapDraft,
		isMapShaped,
		mapShowingOnly,
		setMapFill,
		setMapPesticideFilters,
		setNotices,
		setSmokeAndFire,
		setUse,
		toMapDraft
	} from "./map";
	import { pesticideMeta } from "./sources";
	import AirQualitySection from "./AirQualitySection.svelte";
	import MapSections from "./MapSections.svelte";
	import { isCalendarType } from "$lib/calendars/types";
	import ThresholdLineControl from "./ThresholdLineControl.svelte";
	import { formatDate, formatDateRange, formatList, formatNumber } from "$lib/format";
	import { offeredDatasets, resolutionBlock, typeBlock } from "./offer";
	import { datasetBlock, datasetBlockText } from "./dataset-offer";
	import { LEVEL_BY, LEVEL_LABEL } from "./level-phrases";
	import Preview, { type PreviewSize } from "./Preview.svelte";
	import { resolutionChoices } from "./resolution-offer";
	import { shownRange } from "./shown-range";
	import {
		LEVELS,
		MAP_LEVELS,
		offeredFrom,
		type Level as DataLevel
	} from "$lib/data/dataset-rules";
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
		onchange,
		saves = true,
		leftOut = 0,
		startNotes
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
		/**
		 * The draft is kept for a reload or a later visit (a new widget's). False opened from a
		 * Map: this visit's edits are never written to the device's saved draft (D3).
		 */
		saves?: boolean;
		/** Opened from a Map: the marks left out because they're hidden (a note, D4). */
		leftOut?: number;
		/** Opened from a Map: what its conversion left out or changed, noted as Show as notes it. */
		startNotes?: Omit<NowConversion, "draft">;
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

	/**
	 * The Map's pollutants (the monitors meta's `available_pollutants`), once loaded; `[]` when
	 * they can't be loaded, the same as a server that lists none.
	 */
	let mapPollutants = $state.raw<string[] | undefined>();
	/**
	 * The region types a Map can fill (the place directory's that the Map draws), once loaded;
	 * undefined while loading or when they can't be loaded (a saved fill is kept either way).
	 */
	let fillTypes = $state.raw<RegionTypeInfo[] | undefined>();
	$effect(() => {
		if (plain.type !== MAP_TYPE || fillTypes) return;
		const controller = new AbortController();
		void directoryFor(getMetadata(), getResolvers().regions)
			.regionTypes(controller.signal)
			.then((types) => {
				if (!controller.signal.aborted) fillTypes = fillableTypes(types);
			})
			.catch((error: unknown) => {
				if (!controller.signal.aborted) report(error);
			});
		return () => controller.abort();
	});
	/**
	 * The years with pesticide use data (the pesticide meta's, newest first), once loaded;
	 * `"unavailable"` when they couldn't be loaded (Retry asks again). Either way, or with none
	 * listed, use can't be switched on.
	 */
	let useYears = $state.raw<readonly number[] | "unavailable" | undefined>();
	let useYearsTry = $state(0);
	const loadUseYears = (): Promise<readonly number[] | "unavailable"> =>
		pesticideMeta().then(
			(meta) => meta.years ?? [],
			() => "unavailable" as const
		);
	/** Keyed on a primitive, so an edit doesn't ask for the years again. */
	const isMap = $derived(plain.type === MAP_TYPE);
	$effect(() => {
		void useYearsTry;
		if (!isMap || untrack(() => Array.isArray(useYears))) return;
		let active = true;
		void loadUseYears().then((y) => {
			if (active) useYears = y;
		});
		return () => {
			active = false;
		};
	});
	const loadMapPollutants = async () => {
		const p = await getMetadata().mapPollutants();
		return p === "unavailable" ? [] : p;
	};
	$effect(() => {
		if (plain.type !== MAP_TYPE || mapPollutants) return;
		let active = true;
		void loadMapPollutants().then((p) => {
			if (active) mapPollutants = p;
		});
		return () => {
			active = false;
		};
	});

	const type = $derived(getWidgetType(plain.type));
	/**
	 * A type with a now shape (a now type, or the Map with or without a range): its places on one
	 * layer, its own What (see `now.ts`, `map.ts`); the Map with a range has a Data resolution.
	 */
	const isNow = $derived(!!type && offersNow(type));
	/** A now type proper: no When (the Map has one, with a Now choice). */
	const nowOnly = $derived(type?.time === "now");
	const range = $derived<DateRangeSpec>(plain.data.dateRange ?? DEFAULT_RANGE);
	const main = $derived(mainLayer(plain.data, known));
	const picks = $derived(fromWhere(plain.data));
	/** The Chart's lines: its searched monitors, else its Where's places ("Overlay for"). */
	const lines = $derived(
		lineRefs({
			place: plain.data.place,
			selection: plain.data.selection,
			monitors: widgetMonitors(plain.data).monitors
		})
	);
	/** Only level layers (smoke, burn status): nothing to chart, so no Add, Save or Download. */
	const levelOnly = $derived(layers.levelOnly(plain.data, known));

	const sections = $derived(
		known
			? offeredDatasets(known, adapterOffers(), dataTypes()).filter((s) => s.entryTypes.length > 0)
			: []
	);
	// A now type is never blocked: choosing it converts the draft (`toNowDraft`). A Map, in its
	// shape or not, is checked as what `fromMapDraft` converts it to: its pollutant, at its places.
	const blockData = $derived(
		known && plain.type === MAP_TYPE ? mapShowingOnly(plain, known).draft.data : plain.data
	);
	const showAs = $derived(
		dataTypes().map((t) => {
			if (!known) return { type: t, block: null };
			// A type that offers now converts the draft to its shape, so it's never blocked, but for
			// the Map's resolution: it shows daily, monthly or yearly data.
			const block = offersNow(t)
				? t.type === MAP_TYPE && resolutionBlock(t, plain.data)
					? ("resolution" as const)
					: null
				: typeBlock(t, blockData, known, now);
			const level =
				block === "resolution"
					? (resolutionBlock(t, offersNow(t) ? plain.data : blockData) ?? undefined)
					: undefined;
			return { type: t, block, ...(level ? { level } : {}) };
		})
	);
	/** Where the places are fetched for, as the dataset rules count it. */
	const placeKind = $derived(widgetPlaceKind(plain.data));
	/** A Map on Now, or a now type: no range, so no data resolution. */
	const hasRange = $derived(!nowOnly && (!isMap || !!plain.data.dateRange));
	/**
	 * The dataset's resolution (Automatic included, decided from the range as picked), once the
	 * catalog is known. The When summary and its notes show the range at it.
	 */
	const effective = $derived(
		known && hasRange && type
			? widgetEffective({ type: plain.type, data: plain.data }, known, placeKind, range, now)
			: undefined
	);
	const resolution = $derived(effective?.resolution ?? plain.data.resolution);
	/** The dataset's resolution over another range (the Map's span counts stops at it). */
	const resolutionFor = (spec: DateRangeSpec): DataLevel =>
		widgetEffective({ type: plain.type, data: plain.data }, known, placeKind, spec, now).resolution;
	/** Data resolution's choices: none for a pinned type, Now, or a widget with no main entry type. */
	const choices = $derived.by(() => {
		if (!known || !hasRange || (isNow && !isMap)) return null;
		if (!isMap && !entryMeta(known, main)) return null;
		return resolutionChoices({
			data: plain.data,
			catalog: known,
			place: placeKind,
			range,
			// The Map counts stops, not points (its own cap).
			places: isMap ? 1 : picks.length,
			// The Map's levels are its own (`MAP_LEVELS`), not its type's pin.
			pin: isMap ? undefined : (type?.resolution as DataLevel | undefined),
			now,
			...(isMap ? { within: MAP_LEVELS } : {})
		});
	});
	/**
	 * A specific resolution never changes by itself: one that no longer fits (the range grew past
	 * the point budget, or a dataset isn't reported at it) stays chosen, shown blocked with its
	 * reason, and Add and Save wait until another is chosen.
	 */
	const resolutionBlocked = $derived.by(() => {
		const level = plain.data.resolution;
		if (!choices || !level) return false;
		const choice = choices.find((c) => c.level === level);
		return !choice || !!choice.blocked;
	});
	/** The stored level is none of the choices (a quarter, or hour on a Map; untrusted input). */
	const resolutionUnknown = $derived(
		!!choices && !!plain.data.resolution && !choices.some((c) => c.level === plain.data.resolution)
	);

	/** A dataset's name, from the catalog. */
	const datasetLabel = (layer: Layer) =>
		known?.find((d) => d.id === layer.dataset)?.label ?? layer.dataset;

	/**
	 * Why a dataset (`candidate`, its layers) can't be chosen, or undefined: on a Map on Now,
	 * pesticide use (Now has no resolution); with a specific resolution, a dataset that isn't
	 * reported at it; on Automatic, one that shares no level with those chosen (less `without`, the
	 * layer it would replace, and any that already don't line up). A pinned type (a calendar) and
	 * the Map's levels count as Automatic within them. Greyed, never hidden.
	 */
	function datasetReason(candidate: Layer[], without?: Layer): string | undefined {
		if (!known) return undefined;
		if (isMap && !plain.data.dateRange) {
			const use = candidate.find((l) => l.dataset === PESTICIDE_USE);
			const by = use && offeredFrom(use, known, placeKind);
			return by ? m.get_data_dataset_not_on_now({ by: LEVEL_BY[by]() }) : undefined;
		}
		if (!hasRange) return undefined;
		const misfits = effective?.misfits ?? [];
		const chosen = plain.data.layers.filter(
			(l) =>
				l !== without &&
				!misfits.includes(l) &&
				!candidate.some((c) => c.dataset === l.dataset && c.entryType === l.entryType)
		);
		const pinned = !isMap && !!type?.resolution;
		const block = datasetBlock({
			candidate,
			chosen,
			catalog: known,
			place: placeKind,
			resolution: pinned ? undefined : (plain.data.resolution as DataLevel | undefined),
			within: isMap ? MAP_LEVELS : LEVELS
		});
		return block ? datasetBlockText(block) : undefined;
	}
	/** The Map's place-less datasets' reasons (smoke and fire go together). */
	const mapBlocks = $derived(
		isMap
			? {
					smoke: datasetReason([{ dataset: HMS_SMOKE }, { dataset: HMS_FIRE }]),
					notices: datasetReason([{ dataset: PESTICIDE_NOTICES }]),
					use: datasetReason([{ dataset: PESTICIDE_USE }])
				}
			: {}
	);

	/**
	 * Why the draft can't be added or saved because its datasets don't line up: only a draft from
	 * untrusted input (a link, an old draft) can carry one, since the controls never build one.
	 */
	const misfitReason = $derived.by(() => {
		if (!known) return undefined;
		if (isMap && !plain.data.dateRange) {
			const use = plain.data.layers.find((l) => l.dataset === PESTICIDE_USE);
			return use ? m.get_data_not_on_now_blocked({ dataset: datasetLabel(use) }) : undefined;
		}
		const misfits = effective?.misfits ?? [];
		if (misfits.length === 0) return undefined;
		const names = [...new Set(misfits.map(datasetLabel))];
		return m.get_data_misfits_blocked({ datasets: formatList(names), countValue: names.length });
	});
	/** Automatic moved above the range's level for a dataset: says so, naming both. */
	const autoNote = $derived.by(() => {
		if (!choices || !effective?.automatic || !effective.movedBy) return undefined;
		const level = effective.resolution;
		return m.get_data_resolution_auto_moved({
			level: LEVEL_LABEL[level](),
			dataset: datasetLabel(effective.movedBy),
			by: LEVEL_BY[level]()
		});
	});
	/** The range resolved wider than picked (whole months or years): the dates it shows. */
	const widenedNote = $derived.by(() => {
		if (!effective) return undefined;
		const level = effective.resolution;
		if (level !== "month" && level !== "year") return undefined;
		const shown = shownRange(range, now, level);
		if (!shown.widened) return undefined;
		const dates = { start: formatDate(shown.start), end: formatDate(shown.end) };
		if (level === "month") {
			return shown.soFar ? m.get_data_range_widened_so_far(dates) : m.get_data_range_widened(dates);
		}
		return shown.soFar
			? m.get_data_range_widened_year_so_far(dates)
			: m.get_data_range_widened_year(dates);
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
	// Where, the overlays' series for "Overlay for", and when the data has settled. The preview
	// sets its own generated title, so this always runs under another id (two writers of one title,
	// with different caps, would undo each other forever), and a Forecast strip's place is named
	// through a PM2.5 layer, as its picker offers places.
	const namesWidget = $derived.by<WidgetInstance>(() => {
		// A now type's names come from its main layer (a Map's other layers are place-less).
		const layers = isNow
			? [main ?? { ...DEFAULT_LAYER }]
			: plain.data.layers.length > 0
				? plain.data.layers
				: [{ ...DEFAULT_LAYER }];
		return { ...previewWidget, id: `${PREVIEW_ID}-names`, data: { ...plain.data, layers } };
	});
	const data = new DataWidget(() => namesWidget);

	/** The draft has ticked monitor types: its lines are a monitor set's monitors. */
	const setLines = $derived(widgetMonitors(plain.data).types.length > 0);
	/**
	 * What Where says with no places, instead of "Everywhere": a single-place widget takes one place
	 * or one monitor, so it asks for one, or says it shows its monitor.
	 */
	const whereEmptyText = $derived.by(() => {
		if (placeLimit(type) !== 1) return undefined;
		return widgetMonitors(plain.data).monitors.length > 0
			? m.get_data_where_one_monitor()
			: m.get_data_where_place_or_monitor();
	});
	/**
	 * "Overlay for": a Chart choice, listing its lines (areas or monitors). With ticked types,
	 * whenever the set has two or more monitors (its overlay is fetched for the one chosen, spec
	 * decision 37); otherwise only when the lines' overlays differ (different zones).
	 */
	const overlayFor = $derived.by(() => {
		if (plain.type !== CHART_TYPE || data.overlays.length === 0) return null;
		if (!setLines && lines.length < 2) return null;
		const shown = data.shown;
		if (shown.status !== "ready") return null;
		const places = shown.data.places;
		if (places.length < 2) return null;
		const differ =
			setLines ||
			data.overlays.some((o) => o.state.status === "ready" && !sharedSource(o.state.data.series));
		if (!differ) return null;
		const key = overlayPlaceFor(plain.options, places, lines);
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

	// The draft is kept for a reload or a later visit; Edit data starts from the widget each time,
	// and a visit from a Map never writes it (`saves`).
	const keepsDraft = untrack(() => saves) && untrack(() => mode.kind) === "new";
	$effect(() => {
		const snapshot = plain;
		if (keepsDraft) untrack(() => saveDraft(app.platform, app.space, snapshot));
	});
	$effect(() => {
		if (!keepsDraft) return;
		const flush = () => flushDraft();
		window.addEventListener("pagehide", flush);
		return () => window.removeEventListener("pagehide", flush);
	});
	onDestroy(() => {
		if (keepsDraft) flushDraft();
	});

	let size = $state<PreviewSize>("large");
	let width = $state(0);
	const phone = new MediaQuery(PHONE_QUERY);

	// Edits. Where is on the draft's data; the main layer decides the level, and overlays follow
	// it (see `layers.ts`).

	/** Sets the range, or (`undefined`, for a type with `now`) Now. */
	function setRange(spec: DateRangeSpec | undefined): void {
		if (!spec) {
			delete draft.data.dateRange;
			return;
		}
		draft.data.dateRange = spec;
		// A calendar's day selection that the new range no longer holds is dropped with it.
		const sel = draft.data.timeSubRange && $state.snapshot(draft.data.timeSubRange);
		if (sel && !selectionFits(sel, spec, now)) {
			delete draft.data.timeSubRange;
			noteConversion({
				draft: $state.snapshot(draft) as Draft,
				dropped: ["outside"],
				selection: sel
			});
		}
	}

	/** Change places' Done: the places the person chose (the hidden-marks note goes with them). */
	function setPlaces(next: Picks): void {
		leftOutShown = false;
		delete draft.data.place;
		delete draft.data.selection;
		Object.assign(draft.data, toWhere(next));
		layers.dropStationOnPlaceChange(draft.data);
		layers.dropMonitorsForPlace(draft.data, placeLimit(getWidgetType(draft.type)));
	}

	function setPollutant(pick: layers.EntryPick | null): void {
		layers.setPollutant(draft.data, known, pick);
	}

	function setMonitorTypes(types: string[]): void {
		layers.setMonitorTypes(draft.data, known, types);
	}

	/** The searched monitors; a single-place widget's one monitor replaces its Where (decision 11). */
	function setMonitors(ids: string[]): void {
		layers.setMonitors(draft.data, known, ids);
		layers.dropWhereForMonitor(draft.data, placeLimit(getWidgetType(draft.type)));
	}

	function toggleLayer(pick: layers.EntryPick, on: boolean): void {
		layers.toggleLayer(draft.data, known, pick, on);
	}

	function addPesticideLayer(entryType: string): void {
		layers.addPesticideLayer(draft.data, known, entryType);
	}

	function removeLayer(index: number): void {
		layers.removeLayer(draft.data, index);
	}

	function setFilters(index: number, filters: PesticideFilters): void {
		layers.setFilters(draft.data, index, filters);
	}

	function setStation(station: string | undefined): void {
		layers.setStation(draft.data, station);
	}

	/** Sets the dataset's resolution; Automatic is never stored (it deletes it). */
	function setDetail(level: "auto" | DataLevel): void {
		if (level === "auto") delete draft.data.resolution;
		else draft.data.resolution = level;
	}

	/** What the last conversion left out or changed, until the next edit of the form. */
	let dropped = $state.raw<{ after: string; conversion: NowConversion } | null>(null);
	const notes = $derived.by(() => {
		if (!dropped || dropped.after !== JSON.stringify(plain)) return [];
		const { dropped: what, pollutant, fromLine } = dropped.conversion;
		const out: string[] = [];
		if (what.includes("dates")) out.push(m.get_data_dates_left_out());
		if (what.includes("overlays")) out.push(m.get_data_overlays_left_out());
		const cap = placeLimit(getWidgetType(plain.type));
		if (what.includes("places")) {
			out.push(
				cap > 1
					? m.get_data_places_over_cap_left_out({ count: formatNumber(cap), countValue: cap })
					: m.get_data_extra_places_left_out()
			);
		}
		if (what.includes("monitor-types")) out.push(m.get_data_monitor_types_left_out());
		if (pollutant) {
			const label = (dataset: string, entryType: string) =>
				entryMeta(known, { dataset, entryType })?.entryType.label ?? entryType;
			const previous = label(pollutant.from.dataset, pollutant.from.entryType);
			const to = label("air-quality", pollutant.to);
			out.push(
				plain.type === MAP_TYPE && mapPollutants?.length
					? m.get_data_map_pollutant_instead({
							pollutants: formatList(mapPollutants.map((e) => label("air-quality", e))),
							pollutant: to,
							previous
						})
					: m.get_data_pollutant_instead({ pollutant: to, previous })
			);
		}
		if (what.includes("range-cut")) {
			const counted = { count: formatNumber(MAP_MAX_STOPS), countValue: MAP_MAX_STOPS };
			const cutAt = dropped.conversion.cutAt;
			out.push(
				cutAt === "month"
					? m.get_data_range_cut_left_out_months(counted)
					: cutAt === "year"
						? m.get_data_range_cut_left_out_years(counted)
						: m.get_data_range_cut_left_out(counted)
			);
		}
		if (what.includes("marks")) out.push(m.get_data_marks_left_out());
		if (what.includes("fill")) out.push(m.getdata_note_fill_dropped());
		if (what.includes("alert")) out.push(m.get_data_level_left_out());
		const days = dropped.conversion.selection;
		if (days) {
			const text = formatDateRange(days.start, days.end);
			if (what.includes("selection")) out.push(m.get_data_selection_left_out({ days: text }));
			if (what.includes("outside")) out.push(m.get_data_selection_outside_range({ days: text }));
		}
		if (fromLine) out.push(m.get_data_alert_level_from_low_line({ level: fromLine.label }));
		return out;
	});

	/** Opened from a Map: the hidden marks' note, until the person changes the places. */
	let leftOutShown = $state(untrack(() => leftOut) > 0);
	const allNotes = $derived(
		leftOutShown
			? [
					m.get_data_marks_hidden_left_out({ count: formatNumber(leftOut), countValue: leftOut }),
					...notes
				]
			: notes
	);

	/** Shows `conversion`'s notes until the draft changes. */
	function noteConversion(conversion: NowConversion): void {
		dropped = { after: JSON.stringify($state.snapshot(draft)), conversion };
	}

	/** Opened from a Map: its conversion's notes, until the next edit. */
	const start = untrack(() => startNotes);
	function noteStart(): void {
		if (start?.dropped.length) noteConversion({ ...start, draft: $state.snapshot(draft) as Draft });
	}
	noteStart();

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

	/** Whether `d` already has now type `t`'s shape (the Map's own, for the Map). */
	function shaped(d: Draft, t: WidgetType): boolean {
		return t.type === MAP_TYPE ? isMapShaped(d, now, known) : isNowShaped(d, t);
	}

	/** The type `snapshot` converts from: none for a range draft already marked as a now type. */
	function sourceType(snapshot: Draft): WidgetType | undefined {
		const from = getWidgetType(snapshot.type);
		return from && offersNow(from) && !shaped(snapshot, from) ? undefined : from;
	}

	/** The draft as now type `next`, once its pollutant's scale has loaded. */
	async function convertToNow(next: WidgetType, catalog: CatalogEntry[]): Promise<void> {
		const id = ++changeId;
		if (next.type === MAP_TYPE) {
			// The Map offers only the monitor map's pollutants (memoized, so loaded once), and has no
			// alert level, so no scale to wait for.
			const allowed = await loadMapPollutants();
			if (id !== changeId) return;
			mapPollutants = allowed;
			const converted = toMapDraft($state.snapshot(draft) as Draft, catalog, allowed, now);
			defaultOwed = false;
			replaceDraft(converted.draft);
			noteConversion(converted);
			return;
		}
		// From a Map, its pollutant is the one that converts.
		const base = (d: Draft) => (d.type === MAP_TYPE ? mapShowingOnly(d, catalog).draft : d);
		const pollutant = nowPollutant(base($state.snapshot(draft) as Draft), next, catalog);
		const levels = await levelsOf(pollutant);
		if (id !== changeId) return;
		// An edit made while the scale loaded counts: convert the draft as it is now (again, when
		// that edit changed the pollutant).
		const fresh = $state.snapshot(draft) as Draft;
		if (nowPollutant(base(fresh), next, catalog) !== pollutant) {
			return convertToNow(next, catalog);
		}
		const converted =
			fresh.type === MAP_TYPE
				? fromMapDraft(fresh, next, catalog, levels, now)
				: toNowDraft(fresh, next, catalog, levels, sourceType(fresh));
		alertLevels = { entryType: nowEntryType(converted.draft), levels };
		defaultOwed = !!converted.defaultOwed;
		replaceDraft(converted.draft);
		noteConversion(converted);
	}

	function setType(next: string): void {
		const to = getWidgetType(next);
		if (!to) return;
		switchType(to);
	}

	function switchType(to: WidgetType): void {
		const next = to.type;
		if (offersNow(to) && known) {
			void convertToNow(to, known);
			return;
		}
		changeId++;
		defaultOwed = false;
		if (!offersNow(to) && isNow) {
			const converted =
				plain.type === MAP_TYPE
					? fromMapDraft(plain, to, known ?? [], "unavailable", now)
					: fromNowDraft(plain, to);
			replaceDraft(converted.draft);
			noteConversion(converted);
		}
		// A now type chosen before the catalog is known is converted once it is (below).
		else {
			const moved = switchRange($state.snapshot(draft.data), type, to, now);
			if (moved.dateRange) draft.data.dateRange = moved.dateRange;
			if (!moved.timeSubRange) delete draft.data.timeSubRange;
			draft.type = next;
			const days = moved.left ?? moved.outside;
			const dropped: NowDropped[] = moved.left ? ["selection"] : moved.outside ? ["outside"] : [];
			// A line the new type can't hold is left out, with a note.
			if (!to.thresholds && draft.thresholds) {
				delete draft.thresholds;
				dropped.push("alert");
			}
			if (dropped.length) {
				noteConversion({
					draft: $state.snapshot(draft) as Draft,
					dropped,
					...(days ? { selection: days } : {})
				});
			}
		}
	}

	// A draft that's a now type but not in its shape (opened from a `?type=` link or a stored
	// draft, or the type chosen before the catalog arrived) is converted once the catalog is
	// known. A saved now widget already has the shape.
	$effect(() => {
		const to = type;
		if (!known || !to || !offersNow(to)) return;
		if (!untrack(() => shaped(plain, to))) void convertToNow(to, known);
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
	// A Chart's threshold line reads its main pollutant's scale the same way (no default).
	const lineEntryType = $derived.by(() => {
		if (isNow || !type?.thresholds || !known) return undefined;
		const meta = entryMeta(known, main);
		return meta?.entryType.kind === "pollutant" ? main?.entryType : undefined;
	});
	const alertEntryType = $derived(
		isNow && type?.thresholds && known ? nowEntryType(plain) : lineEntryType
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

	// A Chart's saved line is dropped once it can't be shown or edited: the type has no
	// thresholds, or the main layer isn't a pollutant with levels.
	$effect(() => {
		if (isNow || !known || !draft.thresholds) return;
		const gone =
			!type?.thresholds ||
			lineEntryType === undefined ||
			(Array.isArray(shownLevels) && shownLevels.length === 0);
		if (gone) untrack(() => delete draft.thresholds);
	});

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
		const place = overlayFor?.places[index];
		const ref = place ? overlayRefOf(place, index, lines) : null;
		if (ref) draft.options = { ...draft.options, overlayFor: ref };
	}

	function download(): void {
		void saveDataCsv(
			"get-data",
			plain.data,
			(name, contents, mime) => app.platform.files.save(name, contents, mime),
			"owner",
			plain.type,
			plain.options
		);
	}
</script>

<div class="flex min-h-full flex-col" bind:clientWidth={width}>
	<div
		class="grid flex-1 gap-(--grid-gap) p-(--grid-gap) md:grid-cols-[minmax(16rem,20rem)_minmax(0,1fr)]"
	>
		<div class="flex min-w-0 flex-col gap-4">
			{#if allNotes.length > 0}
				<div role="status" class="flex flex-col gap-1">
					{#each allNotes as note (note)}
						<p class="text-muted-foreground text-sm">{note}</p>
					{/each}
				</div>
			{/if}

			{#if !nowOnly}
				<section class="flex flex-col gap-2" aria-labelledby="{uid}-when">
					<h2 id="{uid}-when" class="text-primary text-sm font-semibold">{m.get_data_when()}</h2>
					{#if type}
						<!-- A type with `now` (the Map) passes no range for Now. -->
						<WhenControl
							{type}
							value={type.now ? plain.data.dateRange : range}
							{now}
							{resolution}
							{resolutionFor}
							onchange={setRange}
						/>
					{/if}
					<!-- Always mounted, so a new note is announced. -->
					<p
						role="status"
						class={["text-muted-foreground text-xs", !widenedNote && "sr-only"]}
						data-testid="range-widened-note"
					>
						{widenedNote ?? ""}
					</p>
				</section>
			{/if}

			<section class="flex flex-col gap-2" aria-labelledby="{uid}-where">
				<h2 id="{uid}-where" class="text-primary text-sm font-semibold">{m.get_data_where()}</h2>
				<WhereControl
					{picks}
					max={placeLimit(type)}
					offer={plain.type === CHART_TYPE || plain.type === DATA_TABLE_TYPE ? "areas" : "where"}
					purpose={wherePurpose(plain.data, known)}
					emptyText={whereEmptyText}
					onchange={setPlaces}
				/>
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
				{:else if plain.type === MAP_TYPE}
					<section class="flex flex-col gap-2" aria-labelledby="{uid}-what">
						<h2 id="{uid}-what" class="text-primary text-sm font-semibold">
							{m.get_data_what()}
						</h2>
						<MapSections
							data={plain.data}
							catalog={known}
							offered={offeredPollutants(known, mapPollutants ?? [])}
							limit={placeLimit(type)}
							onpollutant={setPollutant}
							onmonitortypes={setMonitorTypes}
							onmonitors={setMonitors}
							onsmoke={(on) => setSmokeAndFire(draft.data, on)}
							onnotices={(on) => setNotices(draft.data, on)}
							onfilters={(filters) => setMapPesticideFilters(draft.data, filters)}
							years={useYears}
							onuse={(on) => setUse(draft, on)}
							onretryyears={() => {
								useYears = undefined;
								useYearsTry++;
							}}
							fill={mapOptions(plain).fill}
							blocks={mapBlocks}
							{fillTypes}
							onfill={(type) => setMapFill(draft, type)}
						/>
					</section>
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
						{#if main}
							<!-- One monitor or one place (decision 33); the pollutant is chosen above. -->
							<AirQualitySection
								data={plain.data}
								catalog={known}
								limit={placeLimit(type)}
								pollutants={null}
								onpollutant={setPollutant}
								ontypes={setMonitorTypes}
								onmonitors={setMonitors}
							/>
						{/if}
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
							limit={placeLimit(type)}
							maxOverlays={MAX_OVERLAYS}
							onpollutant={setPollutant}
							onmonitortypes={setMonitorTypes}
							onmonitors={setMonitors}
							ontoggle={toggleLayer}
							onaddpesticide={addPesticideLayer}
							onremove={removeLayer}
							onfilters={setFilters}
							onstation={setStation}
							blocked={datasetReason}
						/>
					{/if}
				</section>
			{/if}

			{#if choices}
				<DataResolutionControl
					{choices}
					value={(plain.data.resolution as DataLevel | undefined) ?? "auto"}
					{datasetLabel}
					note={autoNote}
					onchange={setDetail}
				/>
			{/if}

			{#if !isNow && type?.thresholds && shownLevels}
				{#if type.resolution}
					<!-- A type with a pinned resolution (a calendar): its level control stands alone. -->
					<section>
						<ThresholdLineControl
							levels={shownLevels}
							thresholds={plain.thresholds}
							onthreshold={setThreshold}
							onretry={() => alertTry++}
							marks={isCalendarType(plain.type)}
						/>
					</section>
				{:else}
					<MoreOptions>
						<ThresholdLineControl
							levels={shownLevels}
							thresholds={plain.thresholds}
							onthreshold={setThreshold}
							onretry={() => alertTry++}
							marks={isCalendarType(plain.type)}
						/>
					</MoreOptions>
				{/if}
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
		blocked={levelOnly
			? m.get_data_level_only()
			: (misfitReason ??
				(resolutionUnknown
					? m.get_data_resolution_unknown_blocked()
					: resolutionBlocked
						? m.get_data_resolution_blocked()
						: undefined))}
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
