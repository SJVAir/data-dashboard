<script module lang="ts">
	/** The preview's widget id (it's in no dashboard). */
	export const PREVIEW_ID = "get-data-preview";
</script>

<script lang="ts">
	import { onDestroy, untrack } from "svelte";
	import type { Attachment } from "svelte/attachments";
	import { MediaQuery } from "svelte/reactivity";
	import { Button } from "$lib/components/ui/button";
	import { scrollFocusable } from "$lib/components/shared/scroll-focusable";
	import { adapterOffers, getMetadata, getResolvers } from "$lib/data";
	import { csvPending, saveDataCsv } from "$lib/data/csv";
	import { AIR_QUALITY } from "$lib/data/layer-kind";
	import type { CatalogEntry, Level, LocationGroup } from "$lib/data/metadata";
	import { fillableTypes } from "$lib/data/snapshot";
	import type { ChosenPlace, DateRangeSpec, Layer, PesticideFilters } from "$lib/data/schema";
	import type { WidgetInstance } from "$lib/documents/schema";
	import { PHONE_QUERY } from "$lib/layout/config";
	import { m } from "$lib/paraglide/messages.js";
	import { directoryFor } from "$lib/places/host";
	import { areasOnly } from "$lib/places/replace";
	import { fromWhere, toWhere, type Picks } from "$lib/places/selection";
	import type { RegionTypeInfo } from "$lib/places/types";
	import { report } from "$lib/safety/report";
	import { useApp } from "$lib/store/app.svelte";
	import { CHART_TYPE } from "$lib/widgets/chart";
	import { DEFAULT_LAYER, DEFAULT_RANGE } from "$lib/widgets/defaults";
	import { CURRENT_TYPE } from "$lib/widgets/current";
	import { OUTSIDE_TYPE } from "$lib/widgets/outside";
	import {
		currentPollutants,
		firstPollutantOnly,
		setCurrentPollutants
	} from "$lib/widgets/current/pollutants";
	import { thresholdFor, withThreshold } from "$lib/thresholds/levels";
	import type { Threshold } from "$lib/thresholds/schema";
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
	import TypeOptionsButton from "./TypeOptionsButton.svelte";
	import MapOptions, { hasMapOptions } from "./MapOptions.svelte";
	import { hasAlertLevels, hasLevelLine } from "./type-options";
	import { flushDraft, saveDraft, type Draft } from "./draft.svelte";
	import type { GetDataMode } from "./mode";
	import {
		fromRangeDraft,
		isNowShaped,
		keptThreshold,
		nowPollutant,
		offeredPollutants,
		selectionFits,
		switchRange,
		areaToLookUp,
		withArea,
		type NowConversion
	} from "./now";
	import { showAsDraft } from "./show-as";
	import NowControls, { type NowAlert } from "./NowControls.svelte";
	import {
		isMapShaped,
		mapShowingOnly,
		setLocationTypes,
		setMapFill,
		locationsLayer,
		setMapPesticideFilters,
		setNotices,
		setSmokeAndFire,
		setUse
	} from "./map";
	import { pesticideMeta } from "./sources";
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
	/**
	 * The pollutants with school guidelines (what "Can we go outside?" offers), once loaded. When
	 * they can't be loaded they stay unknown (undefined): nothing says none have guidelines, the
	 * draft keeps its pollutant, and the next type change asks again.
	 */
	let guidelinePollutants = $state.raw<string[] | undefined>();
	/** Asked since the last type change (so a failed load isn't asked again until the next one). */
	let guidelinesAsked = false;
	const loadGuidelinePollutants = (): Promise<string[] | undefined> => {
		guidelinesAsked = true;
		return getMetadata()
			.guidelinePollutants()
			.catch((error: unknown) => {
				report(error, { operation: "guideline-pollutants" });
				return undefined;
			});
	};
	const draftType = $derived(plain.type);
	$effect(() => {
		if (draftType !== OUTSIDE_TYPE || guidelinePollutants || untrack(() => guidelinesAsked)) {
			return;
		}
		let active = true;
		void loadGuidelinePollutants().then((p) => {
			if (active) guidelinePollutants = p;
		});
		return () => {
			active = false;
		};
	});
	/**
	 * The location groups (the regions meta's, by order), a section each on every type's What, once
	 * loaded. When they can't be loaded none show, the failure is reported, and the next type change
	 * asks again (as the guideline pollutants do).
	 */
	let locationGroups = $state.raw<LocationGroup[] | undefined>();
	/** Asked since the last type change (so a failed load isn't asked again until the next one). */
	let locationGroupsAsked = false;
	/** Aborts a groups load still running when the view closes (a type change doesn't). */
	const closing = new AbortController();
	onDestroy(() => closing.abort());
	$effect(() => {
		void draftType;
		if (locationGroups || untrack(() => locationGroupsAsked)) return;
		locationGroupsAsked = true;
		getMetadata()
			.locationGroups(closing.signal)
			.then(
				(groups) => {
					if (!closing.signal.aborted) locationGroups = groups;
				},
				(error: unknown) => {
					if (!closing.signal.aborted) report(error, { operation: "location-groups" });
				}
			);
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
	/** Current conditions with no pollutant ticked (C2): Add and Save ask for one. */
	const noPollutant = $derived(
		plain.type === CURRENT_TYPE && currentPollutants(plain.data).length === 0
	);
	/** Only level layers (smoke, burn status): nothing to chart, so no Add, Save or Download. */
	const levelOnly = $derived(layers.levelOnly(plain.data, known));

	const sections = $derived(
		known
			? offeredDatasets(known, adapterOffers(), dataTypes()).filter((s) => s.entryTypes.length > 0)
			: []
	);
	// A now type is never blocked: choosing it converts the draft (`toNowDraft`). A Map, in its
	// shape or not, is checked as what `fromMapDraft` converts it to: its pollutant, at its places;
	// Current conditions as its first pollutant (`firstPollutantOnly`), which Show as converts.
	const blockData = $derived(
		known && plain.type === MAP_TYPE
			? mapShowingOnly(plain, known).draft.data
			: firstPollutantOnly(plain).data
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
	 * layer it would replace, and any that already don't line up). A pinned type (a calendar) checks
	 * against its level; the Map's levels count as Automatic within them. Greyed, never hidden.
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
			resolution: pinned
				? (type?.resolution as DataLevel | undefined)
				: (plain.data.resolution as DataLevel | undefined),
			within: isMap ? MAP_LEVELS : LEVELS
		});
		return block ? datasetBlockText(block, pinned) : undefined;
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

	/**
	 * Keeps `--get-data-top` at the view's distance from the top of the page, so on two columns it
	 * fills the screen below the top nav and the heading, whatever their height (a notice bar can
	 * come and go).
	 */
	const fillsView: Attachment<HTMLElement> = (node) => {
		const update = () => {
			const top = node.getBoundingClientRect().top + window.scrollY;
			node.style.setProperty("--get-data-top", `${Math.max(0, top)}px`);
		};
		const resize = new ResizeObserver(update);
		resize.observe(document.body);
		window.addEventListener("resize", update);
		update();
		return () => {
			resize.disconnect();
			window.removeEventListener("resize", update);
		};
	};

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
		// Clear (no places): said once, in the view's polite status region.
		if (next.length === 0) announcement = m.get_data_places_cleared();
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
		const others = dropped.conversion.leftOut ?? [];
		if (what.includes("pollutants") && others.length > 0) {
			const names = others.map((p) => entryMeta(known, p)?.entryType.label ?? p.entryType);
			out.push(
				m.get_data_pollutants_left_out({
					pollutants: formatList(names),
					countValue: names.length
				})
			);
		}
		const cap = placeLimit(getWidgetType(plain.type));
		if (what.includes("places")) {
			out.push(
				cap > 1
					? m.get_data_places_over_cap_left_out({ count: formatNumber(cap), countValue: cap })
					: m.get_data_extra_places_left_out()
			);
		}
		if (what.includes("monitor-types")) out.push(m.get_data_monitor_types_left_out());
		if (what.includes("area")) out.push(m.get_data_school_point_left_out());
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
		if (what.includes("locations")) {
			// The ticked groups' labels (the regions meta's); none known: a note naming none.
			const ticked = dropped.conversion.locationTypes ?? [];
			const names = (locationGroups ?? [])
				.filter((g) => g.types.some((t) => ticked.includes(t.type)))
				.map((g) => g.label);
			out.push(
				names.length
					? m.get_data_dropped_locations({ layers: formatList(names) })
					: m.get_data_dropped_locations_unnamed()
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

	/**
	 * Each pollutant's scale (empty when it has none), by entry type, once asked for;
	 * `"unavailable"` when it couldn't be loaded. Shared by the now types' alert levels and the
	 * Chart's line: each scale loads once, and one that failed loads again on its own (Retry, or the
	 * next change that asks for it).
	 */
	let alertLevels = $state.raw<Record<string, Level[] | "unavailable">>({});
	// eslint-disable-next-line svelte/prefer-svelte-reactivity -- bookkeeping, not rendered
	const levelsLoading = new Map<string, Promise<Level[] | "unavailable">>();
	/** `entryType`'s scale: the loaded one, else loads it (once at a time); `[]` for none. */
	function levelsOf(entryType: string | undefined): Promise<Level[] | "unavailable"> {
		if (!entryType) return Promise.resolve([]);
		const have = alertLevels[entryType];
		if (Array.isArray(have)) return Promise.resolve(have);
		let loading = levelsLoading.get(entryType);
		if (!loading) {
			loading = getMetadata()
				.levels(entryType)
				.catch(() => "unavailable" as const)
				.then((levels) => {
					levelsLoading.delete(entryType);
					alertLevels = { ...alertLevels, [entryType]: levels };
					if (Array.isArray(levels)) payDefault(entryType, levels);
					return levels;
				});
			levelsLoading.set(entryType, loading);
		}
		return loading;
	}

	/** Bumped by each type or pollutant change, so a slower earlier one doesn't land after it. */
	let changeId = 0;
	/**
	 * The pollutants owed a default alert level: a conversion or a newly ticked pollutant whose
	 * scale couldn't be loaded. Set once the scale loads, unless the person chooses one first.
	 */
	// eslint-disable-next-line svelte/prefer-svelte-reactivity -- bookkeeping, not rendered
	const owed = new Set<string>();

	/** Whether `d` already has now type `t`'s shape (the Map's own, for the Map). */
	function shaped(d: Draft, t: WidgetType): boolean {
		return t.type === MAP_TYPE ? isMapShaped(d, now, known) : isNowShaped(d, t);
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
			const converted = showAsDraft($state.snapshot(draft) as Draft, next, {
				catalog,
				allowed,
				levels: "unavailable",
				now
			});
			owed.clear();
			replaceDraft(converted.draft);
			noteConversion(converted);
			return;
		}
		// From a Map, its pollutant is the one that converts.
		const base = (d: Draft) => (d.type === MAP_TYPE ? mapShowingOnly(d, catalog).draft : d);
		// "Can we go outside?" offers only the pollutants with school guidelines; while they can't be
		// loaded, any pollutant (the draft keeps its own).
		const guidelines = next.type === OUTSIDE_TYPE ? await loadGuidelinePollutants() : undefined;
		if (id !== changeId) return;
		if (guidelines) guidelinePollutants = guidelines;
		const offered =
			next.type !== OUTSIDE_TYPE
				? undefined
				: (guidelines ?? offeredPollutants(catalog).map((e) => e.id));
		const pollutant = nowPollutant(base($state.snapshot(draft) as Draft), next, catalog, offered);
		const levels = await levelsOf(pollutant);
		if (id !== changeId) return;
		// An edit made while the scale loaded counts: convert the draft as it is now (again, when
		// that edit changed the pollutant).
		const fresh = $state.snapshot(draft) as Draft;
		if (nowPollutant(base(fresh), next, catalog, offered) !== pollutant) {
			return convertToNow(next, catalog);
		}
		const converted = showAsDraft(fresh, next, {
			catalog,
			allowed: offered ?? [],
			levels,
			now
		});
		owed.clear();
		const owing = converted.defaultOwed ? nowEntryType(converted.draft) : undefined;
		if (owing) owed.add(owing);
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
		guidelinesAsked = false;
		locationGroupsAsked = false;
		if (offersNow(to) && known) {
			void convertToNow(to, known);
			return;
		}
		const id = ++changeId;
		owed.clear();
		const school = areaToLookUp(plain, next);
		if (school) {
			// A Chart or Table holds areas only: the school or point's area first (as the starter
			// looks it up), else it's left out with a note.
			void (async () => {
				const area = await import("$lib/starter/area")
					.then(({ starterAreaOf }) => starterAreaOf(school))
					.catch((error: unknown) => {
						report(error, { operation: "show-as-area" });
						return null;
					});
				if (id === changeId) convertRange(to, area);
			})();
			return;
		}
		if (!offersNow(to)) convertRange(to, null);
		// A now type chosen before the catalog is known is converted once it is (below).
		else {
			const moved = switchRange($state.snapshot(draft.data), type, to, now);
			if (moved.dateRange) draft.data.dateRange = moved.dateRange;
			if (!moved.timeSubRange) delete draft.data.timeSubRange;
			draft.type = next;
		}
	}

	/** Show as a range type: `area` stands in for a school or point the type can't show. */
	function convertRange(to: WidgetType, area: ChosenPlace | null): void {
		if (isNow) {
			const converted = withArea(
				showAsDraft(plain, to, { catalog: known ?? [], allowed: [], levels: "unavailable", now }),
				area
			);
			replaceDraft(converted.draft);
			noteConversion(converted);
		} else {
			const converted = withArea(fromRangeDraft(plain, type, to, now), area);
			replaceDraft(converted.draft);
			if (converted.dropped.length) noteConversion(converted);
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

	// The alert level: the pollutant's scale (the one on the draft's layer once it's shaped).
	const nowEntryType = (d: Draft) =>
		d.type === CURRENT_TYPE
			? currentPollutants(d.data)[0]
			: d.type === OUTSIDE_TYPE
				? d.data.layers.find((l) => l.dataset === AIR_QUALITY)?.entryType
				: nowPollutant(d, getWidgetType(d.type)!, known ?? []);
	const isCurrent = $derived(plain.type === CURRENT_TYPE);
	// A Chart's threshold line reads its main pollutant's scale the same way (no default).
	const lineEntryType = $derived.by(() => {
		if (isNow || !type?.thresholds || !known) return undefined;
		const meta = entryMeta(known, main);
		return meta?.entryType.kind === "pollutant" ? main?.entryType : undefined;
	});
	/** The pollutants whose scales the form shows: Current conditions' each, else one. */
	const alertEntryTypes = $derived.by<string[]>(() => {
		if (!isNow) return lineEntryType ? [lineEntryType] : [];
		if (!type?.thresholds || !known) return [];
		if (isCurrent) return currentPollutants(plain.data);
		const one = nowEntryType(plain);
		return one ? [one] : [];
	});
	// Keyed on a string, so an edit that keeps the pollutants asks for nothing.
	const alertKey = $derived(alertEntryTypes.join(" "));
	$effect(() => {
		const wanted = alertKey ? alertKey.split(" ") : [];
		untrack(() => wanted.forEach((e) => void levelsOf(e)));
	});
	/** The Chart's line's scale; null while loading or without a line. */
	const shownLevels = $derived(lineEntryType ? (alertLevels[lineEntryType] ?? null) : null);
	/** The now types' alert levels: Current conditions' one per pollutant, else the one. */
	const nowAlerts = $derived<NowAlert[]>(
		isNow
			? alertEntryTypes.map((entryType) => ({
					entryType,
					label:
						entryMeta(known, { dataset: AIR_QUALITY, entryType })?.entryType.label ?? entryType,
					levels: alertLevels[entryType] ?? null,
					threshold: thresholdFor(plain.thresholds, isCurrent ? entryType : undefined)
				}))
			: []
	);

	/** Whether the type's options panel is open; a type change closes it. */
	let optionsOpen = $state(false);
	// The type alone (a string): any other draft change, such as a level picked in the panel,
	// doesn't close it.
	const shownType = $derived(plain.type);
	$effect(() => {
		void shownType;
		untrack(() => (optionsOpen = false));
	});

	/** The Map's ticked location types (saved order), for its options panel. */
	const tickedLocations = $derived(locationsLayer(plain.data)?.locationTypes ?? []);
	/**
	 * The type's own options have something to show: the level line or alert levels, or the Map's
	 * points of interest and fill.
	 */
	const showTypeOptions = $derived(
		plain.type === MAP_TYPE
			? hasMapOptions(locationGroups, tickedLocations, fillTypes, mapOptions(plain).fill)
			: !!type?.thresholds &&
					(isNow ? hasAlertLevels(nowAlerts) : hasLevelLine(shownLevels ?? undefined))
	);
	// The panel's last control gone (e.g. a dropped location type unticked): it closes, and focus,
	// which was in it, goes to the chosen type in Show as rather than the page.
	$effect(() => {
		if (showTypeOptions || !untrack(() => optionsOpen)) return;
		untrack(() => (optionsOpen = false));
		const inPanel =
			document.activeElement === document.body || !document.activeElement?.isConnected;
		if (inPanel) {
			document.querySelector<HTMLElement>("[data-show-as][aria-checked=true]")?.focus();
		}
	});
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

	/** Sets the draft's alert levels (none deletes them). */
	function putThresholds(next: Threshold[] | undefined): void {
		if (next) draft.thresholds = next;
		else delete draft.thresholds;
	}

	/**
	 * Sets the default alert level owed to `entryType` (a conversion, or a newly ticked pollutant,
	 * whose scale couldn't load), keeping the notes up. Current conditions' is tagged with its
	 * pollutant; another type's has none.
	 */
	function payDefault(entryType: string, levels: Level[]): void {
		if (!owed.delete(entryType)) return;
		const current = draft.type === CURRENT_TYPE;
		const shown = current
			? currentPollutants(draft.data).includes(entryType)
			: nowEntryType(draft) === entryType;
		if (!shown) return;
		const saved = $state.snapshot(draft.thresholds) as Threshold[] | undefined;
		if (current ? thresholdFor(saved, entryType) : saved?.length) return;
		const noted = !!dropped && dropped.after === JSON.stringify(plain);
		const made = keptThreshold(undefined, levels, true, current ? entryType : undefined);
		if (!made) return;
		putThresholds(current ? withThreshold(saved, entryType, made[0]) : made);
		if (noted && dropped) noteConversion(dropped.conversion);
	}

	/**
	 * "Can we go outside?"'s pollutant: the alert level keeps its key if the new scale has it, else
	 * takes its default. When the scale can't be loaded, the alert level is kept as it is.
	 */
	async function setNowPollutant(entryType: string): Promise<void> {
		const id = ++changeId;
		const levels = await levelsOf(entryType);
		if (id !== changeId) return;
		const layer = draft.data.layers[0];
		if (!layer) return;
		layer.entryType = entryType;
		if (levels === "unavailable") return;
		putThresholds(keptThreshold($state.snapshot(draft.thresholds), levels, false));
	}

	/**
	 * Current conditions' ticked pollutants (C2, C3): their layers, in the order given (the offered
	 * order; the monitor stays on the first); a newly ticked one gets its scale's default alert
	 * level (owed until the scale loads), an unticked one's goes.
	 */
	function setNowPollutants(entryTypes: string[]): void {
		const before = currentPollutants(draft.data);
		draft.data = setCurrentPollutants($state.snapshot(draft.data), entryTypes);
		let thresholds = $state.snapshot(draft.thresholds) as Threshold[] | undefined;
		for (const e of before) {
			if (entryTypes.includes(e)) continue;
			owed.delete(e);
			thresholds = withThreshold(thresholds, e, undefined);
		}
		putThresholds(thresholds);
		for (const e of entryTypes) {
			if (before.includes(e)) continue;
			owed.add(e);
			const levels = alertLevels[e];
			// A scale already loaded pays now; else once it loads (`levelsOf`).
			if (Array.isArray(levels)) payDefault(e, levels);
			else void levelsOf(e);
		}
	}

	/** A now type's alert level for `entryType` (tagged on Current conditions), or Off. */
	function setThreshold(entryType: string, level: string | null): void {
		owed.delete(entryType);
		if (draft.type === CURRENT_TYPE) {
			const saved = $state.snapshot(draft.thresholds) as Threshold[] | undefined;
			putThresholds(withThreshold(saved, entryType, level ? { level, entryType } : undefined));
		} else putThresholds(level ? [{ level }] : undefined);
	}

	/** A Chart's or calendar's line level, or Off. */
	function setLineThreshold(level: string | null): void {
		putThresholds(level ? [{ level }] : undefined);
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

<!-- On two columns the view fills the screen below what's above it (the top nav, the heading):
     the left column scrolls on its own and Show as, the preview and the action bar stay in view
     (spec decision 18). On a phone the columns stack and the page scrolls. -->
<div
	class="flex min-h-full flex-col md:h-[calc(100dvh-var(--get-data-top,0px))] md:min-h-0"
	bind:clientWidth={width}
	{@attach fillsView}
>
	<div
		class="grid flex-1 gap-(--grid-gap) p-(--grid-gap) md:min-h-0 md:grid-cols-[minmax(16rem,20rem)_minmax(0,1fr)] md:grid-rows-[minmax(0,1fr)]"
	>
		<div
			class="focus-visible:ring-ring flex min-w-0 flex-col gap-4 rounded-sm focus-visible:ring-2 focus-visible:outline-none md:relative md:-m-1 md:min-h-0 md:overflow-y-auto md:overscroll-contain md:p-1"
			role="group"
			aria-label={m.get_data_choices_label()}
			data-testid="get-data-choices"
			{@attach scrollFocusable}
		>
			{#if allNotes.length > 0}
				<div role="status" class="flex flex-col gap-1">
					{#each allNotes as note (note)}
						<p class="text-muted-foreground text-sm">{note}</p>
					{/each}
				</div>
			{/if}

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
					offer={areasOnly(plain.type) ? "areas" : "where"}
					purpose={wherePurpose(plain.data, known)}
					emptyText={whereEmptyText}
					clearable={placeLimit(type) !== 1}
					onchange={setPlaces}
				/>
			</section>

			<section class="flex flex-col gap-2" aria-labelledby="{uid}-what">
				<h2 id="{uid}-what" class="text-primary text-sm font-semibold">{m.get_data_what()}</h2>
				{#if !known || !type}
					{@render catalogState()}
				{:else}
					<WhatSections
						{type}
						types={dataTypes()}
						{sections}
						data={plain.data}
						catalog={known}
						places={picks.length}
						limit={placeLimit(type)}
						maxOverlays={MAX_OVERLAYS}
						onpollutant={setPollutant}
						onnowpollutant={(e) => void setNowPollutant(e)}
						onnowpollutants={setNowPollutants}
						onmonitortypes={setMonitorTypes}
						onmonitors={setMonitors}
						ontoggle={toggleLayer}
						onaddpesticide={addPesticideLayer}
						onremove={removeLayer}
						onfilters={setFilters}
						onstation={setStation}
						blocked={datasetReason}
						guidelines={guidelinePollutants && known
							? offeredPollutants(known, guidelinePollutants)
							: undefined}
						map={{
							pollutants: offeredPollutants(known, mapPollutants ?? []),
							onsmoke: (on) => setSmokeAndFire(draft.data, on),
							onnotices: (on) => setNotices(draft.data, on),
							onfilters: (filters) => setMapPesticideFilters(draft.data, filters),
							years: useYears,
							onuse: (on) => setUse(draft, on),
							onretryyears: () => {
								useYears = undefined;
								useYearsTry++;
							},
							blocks: mapBlocks
						}}
					/>
				{/if}
			</section>

			{#if choices}
				<DataResolutionControl
					{choices}
					value={(plain.data.resolution as DataLevel | undefined) ?? "auto"}
					{datasetLabel}
					note={autoNote}
					onchange={setDetail}
				/>
			{/if}
		</div>

		<div
			class="focus-visible:ring-ring flex min-w-0 flex-col gap-2 rounded-sm focus-visible:ring-2 focus-visible:outline-none md:relative md:-m-1 md:min-h-0 md:overflow-y-auto md:overscroll-contain md:p-1"
			role="group"
			aria-label={m.get_data_preview_column_label()}
			data-testid="get-data-preview-column"
			{@attach scrollFocusable}
		>
			<!-- Show as and the type's own options (a button opening a panel over the preview). The
			     button sits at the row's bottom, so its panel opens below all of Show as. -->
			<div class="flex flex-wrap items-end gap-2">
				<div class="min-w-0 flex-1">
					<ShowAs types={showAs} value={plain.type} onchange={setType} />
				</div>
				{#if showTypeOptions && type?.optionsLabel}
					<TypeOptionsButton label={type.optionsLabel()} bind:open={optionsOpen}>
						{#if plain.type === MAP_TYPE}
							<MapOptions
								groups={locationGroups}
								ticked={tickedLocations}
								onlocations={(types) => setLocationTypes(draft, types, locationGroups)}
								fill={mapOptions(plain).fill}
								{fillTypes}
								onfill={(t) => setMapFill(draft, t)}
							/>
						{:else if isNow}
							<!-- A now type's alert levels, one per pollutant (chosen in Air quality). -->
							<NowControls
								alerts={nowAlerts}
								onthreshold={setThreshold}
								onretry={(e) => void levelsOf(e)}
							/>
						{:else if shownLevels}
							<ThresholdLineControl
								levels={shownLevels}
								thresholds={plain.thresholds}
								onthreshold={setLineThreshold}
								onretry={() => void levelsOf(lineEntryType)}
								marks={isCalendarType(plain.type)}
							/>
						{/if}
					</TypeOptionsButton>
				{/if}
			</div>
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
			{#if noPollutant}
				<!-- Current conditions with nothing ticked (C2): nothing to preview yet. -->
				<!-- Not a status: the action bar's blocked reason says it once. -->
				<p class="text-muted-foreground text-sm">{m.get_data_choose_pollutant()}</p>
			{:else}
				<Preview
					widget={previewWidget}
					{title}
					{size}
					gridWidth={width}
					phone={phone.current}
					onsize={(s) => (size = s)}
				/>
			{/if}
		</div>
	</div>

	<p role="status" class="sr-only" data-testid="get-data-announcement">{announcement}</p>

	<ActionBar
		blocked={levelOnly
			? m.get_data_level_only()
			: noPollutant
				? m.get_data_choose_pollutant()
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
