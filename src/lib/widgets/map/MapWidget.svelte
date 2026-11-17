<script lang="ts">
	import { getContext, onDestroy, untrack } from "svelte";
	import {
		createMap,
		focusAreaPlugin,
		MapView,
		monitorsPlugin,
		OptionsToolbar,
		type CardContext,
		type FocusAreaPlugin,
		type MapContext
	} from "@sjvair/map-sdk";
	import type { MonitorFeatureProperties, SpatialSelection } from "@sjvair/map-sdk/data";
	import { openPlacePicker } from "$lib/components/dialogs/lazy.svelte";
	import { Button } from "$lib/components/ui/button";
	import { getMetadata } from "$lib/data";
	import type { CatalogEntry } from "$lib/data/metadata";
	import { getNowClient } from "$lib/data/now";
	import type { QueryState, UnavailableReason } from "$lib/data/types";
	import type { WidgetInstance } from "$lib/documents/schema";
	import { formatNumber } from "$lib/format";
	import { HMS_FIRE, HMS_SMOKE } from "$lib/get-data/map";
	import { m } from "$lib/paraglide/messages.js";
	import { useApp } from "$lib/store/app.svelte";
	import { entryMeta, placesLayer } from "../shared/input";
	import { useTileOptions } from "../shared/tile-options.svelte";
	import { PLACE_VIEWER_KEY, type PlaceViewer } from "../shared/viewer";
	import WidgetSkeleton from "../shared/WidgetSkeleton.svelte";
	import WidgetState from "../shared/WidgetState.svelte";
	import { generatedTitle } from "../titles.svelte";
	import { navigate } from "../../../router";
	import { MapData } from "./data/loaded.svelte";
	import { isThin } from "./data/monitors";
	import { SECTION_ZOOM } from "./data/use-geometry";
	import { fitCamera } from "./camera.svelte";
	import { MapDailyFigure } from "./daily-figure.svelte";
	import { MapFillTypes } from "./data/fill-types.svelte";
	import { MapDays } from "./day-mode.svelte";
	import DayStepper from "./DayStepper.svelte";
	import { MapFrame } from "./frame.svelte";
	import { focusGeometry } from "./focus";
	import { fitTarget } from "./framing";
	import { mapConfig } from "./host/config";
	import { mapFormat } from "./host/format";
	import { mapMessages } from "./host/messages";
	import { mapMetadata } from "./host/metadata";
	import { syncMapTitle } from "./map-title.svelte";
	import { MapNoteLines } from "./note-lines.svelte";
	import FillLayer from "./layers/FillLayer.svelte";
	import HmsLayers from "./layers/HmsLayers.svelte";
	import NoticesLayer from "./layers/NoticesLayer.svelte";
	import MapLegendOverlay from "./MapLegendOverlay.svelte";
	import type { MapNoteProps } from "./MapNote.svelte";
	import MapNotes from "./MapNotes.svelte";
	import NoticesLegendNote from "./NoticesLegendNote.svelte";
	import { OnScreen } from "./on-screen.svelte";
	import { canMark, marksChange, sameIds } from "./marks";
	import { MAP_MARKS_MAX, mapOptions, PESTICIDE_NOTICES, pollutantLayers } from "./options";
	import { monitorPositions } from "./sources";
	import { MapToolbar } from "./toolbar/toolbar.svelte";
	import { MapToolbarWiring, type MapToolbarWiringInput } from "./toolbar/wiring.svelte";

	let { widget, fullscreen = false }: { widget: WidgetInstance; fullscreen?: boolean } = $props();
	const app = useApp();

	/** Below this widget width the legend folds into a "Legend" button. */
	const NARROW_PX = 360;
	/** Below this widget width (the toolbar's narrow breakpoint) the day stepper drops its slider. */
	const STEPPER_NARROW_REM = 48;

	const viewer = getContext<PlaceViewer | undefined>(PLACE_VIEWER_KEY) ?? "owner";
	const config = mapConfig();
	const metadata = getMetadata();

	let catalog = $state.raw<CatalogEntry[] | "unavailable" | undefined>();
	void metadata.catalog().then((c) => (catalog = c));
	/**
	 * The pollutants the server puts on its map (`available_pollutants`); `"unavailable"` when
	 * they can't be loaded, which shows the error state ("Try again" asks again).
	 */
	let pollutants = $state.raw<string[] | "unavailable" | undefined>();
	function loadPollutants(): void {
		pollutants = undefined;
		metadata.mapPollutants().then(
			(p) => (pollutants = p),
			() => (pollutants = "unavailable")
		);
	}
	loadPollutants();

	const known = $derived(Array.isArray(catalog) ? catalog : undefined);
	const layer = $derived(placesLayer(widget.data, known));
	/** A dataset's name from the catalog (smoke and fire's layer labels). */
	const datasetLabel = (id: string) => known?.find((d) => d.id === id)?.label;

	// The toolbar: the options it shows (a viewer's held keys over the saved ones), its changes,
	// and the filters it puts on the monitors. Its presets are made with the map.
	let toolbar = $state.raw<MapToolbar | null>(null);
	/**
	 * Where the toolbar's changes go. None (Get data's preview, say): the toolbar is read-only, its
	 * rows readable but changing nothing; a preview isn't a place to set options.
	 */
	const tileOptionsContext = useTileOptions();
	const wiring: MapToolbarWiring = new MapToolbarWiring({
		get widget() {
			return widget;
		},
		tileOptions: tileOptionsContext,
		get catalog() {
			return known;
		},
		get drawable() {
			return Array.isArray(pollutants) ? pollutants : undefined;
		},
		get monitors(): MapToolbarWiringInput["monitors"] {
			return data.monitorsDrawn?.features ?? null;
		},
		get exempt() {
			return data.exempt;
		},
		get smokeAndFireNamed() {
			return !!datasetLabel(HMS_SMOKE) && !!datasetLabel(HMS_FIRE);
		},
		get toolbar() {
			return toolbar;
		},
		get onDay() {
			return days.onDay;
		},
		get fillLabel() {
			return fillInfo?.plural;
		},
		get notices() {
			return data.notices;
		},
		get noticesLabel() {
			return noticesLabel;
		}
	});
	/** The options the tile shows (a viewer's held keys over the saved ones). */
	const shown = $derived(wiring.options);
	// The days of the tile's range: the stop showing, and the stepper's steps (saved, or a
	// viewer's held). Without a range the tile shows now.
	const days: MapDays = new MapDays({
		get widget() {
			return widget;
		},
		tileOptions: tileOptionsContext,
		get options() {
			return wiring.options;
		},
		get saved() {
			return wiring.saved;
		}
	});
	onDestroy(() => days.destroy());

	const savedFill = $derived(wiring.saved.fill);
	const fillTypes = new MapFillTypes(() => savedFill, metadata);
	onDestroy(() => fillTypes.destroy());
	/** The region type filled, when the metadata lists it; null for no fill. */
	const fillType = $derived(fillTypes.type);
	const fillInfo = $derived(fillTypes.info);
	/**
	 * The pollutant drawn now: the one showing, or (when the server's map no longer offers it) the
	 * first layer pollutant it does. Never saved back into the options.
	 */
	const entryType: string | undefined = $derived(wiring.drawn);
	const entryLabel = $derived(
		entryMeta(
			known,
			pollutantLayers(widget.data, known).find((l) => l.entryType === entryType)
		)?.entryType.label
	);
	const dailyFigure = new MapDailyFigure(
		{
			get entryType() {
				return entryType;
			},
			get ranged() {
				return days.ranged;
			},
			get onDay() {
				return days.onDay;
			}
		},
		metadata
	);
	onDestroy(() => dailyFigure.destroy());
	/** Whether the figure's name is known for the pollutant drawn (or isn't needed: on now). */
	const figureLabelSettled = $derived(dailyFigure.settled);
	/** On a day stop, what the monitors' figure is ("24-hour average"); unset on now. */
	const figureLabel = $derived(dailyFigure.label);
	const idle = $derived(
		!layer || (!layer.place && !layer.selection) || layer.place?.kind === "default-place"
	);
	/**
	 * Whether the map can show a pollutant of the tile: none the server's map offers is never drawn.
	 */
	const support = $derived.by<"loading" | "ok" | "pollutants-failed" | UnavailableReason>(() => {
		if (catalog === "unavailable") return "catalog-unavailable";
		if (catalog === undefined || pollutants === undefined) return "loading";
		if (pollutants === "unavailable") return "pollutants-failed";
		if (!entryType || !entryLabel || !pollutants.includes(entryType)) return "unknown-entry-type";
		return "ok";
	});
	const supported = $derived(support === "ok");
	/** Whether the tile loads its data: a map is (or will be) drawn, with now or a day to show. */
	const loads = $derived(!!config && supported && !idle && days.at !== null);

	const frame = new MapFrame(() => layer);
	onDestroy(() => frame.destroy());

	// The map: made once per mount (again after "Retry" when making it failed).
	let map = $state.raw<MapContext | null>(null);
	let mapError = $state.raw<{ error: unknown } | null>(null);
	let mapTries = $state(0);
	let focusArea = $state.raw<FocusAreaPlugin | null>(null);

	const pin = $derived(frame.frame?.pin ?? null);
	/** A school's name, or "Your location" / "Shared location" for an exact point. */
	const pinLabel = $derived(
		pin?.kind === "location"
			? pin.name
			: viewer === "shared"
				? m.map_pin_shared_location()
				: m.map_pin_your_location()
	);

	$effect(() => {
		void mapTries;
		// An idle map (no places yet) makes no map: no GL context, and nothing loaded below.
		if (!config || !supported || idle) return;
		const made = untrack(() => {
			try {
				const created = createMap({
					config,
					metadata: mapMetadata(metadata),
					messages: mapMessages,
					format: mapFormat
				});
				// First, so everything else draws over it.
				const focus = focusAreaPlugin({ id: "focus", layerLabel: m.map_layer_places() });
				created.addPlugin(focus);
				focusArea = focus;
				toolbar = new MapToolbar(created);
				return created;
			} catch (error) {
				return { error };
			}
		});
		if ("error" in made) {
			mapError = made;
			return;
		}
		mapError = null;
		map = made;
		return () => {
			made.destroy();
			focusArea = null;
			toolbar = null;
			map = null;
		};
	});

	// A lost WebGL context leaves a blank map: show the error, and "Retry" makes a new one.
	$effect(() => {
		const gl = map?.gl;
		if (!gl) return;
		const lost = () => (mapError = { error: new Error("WebGL context lost") });
		gl.on("webglcontextlost", lost);
		return () => gl.off("webglcontextlost", lost);
	});

	function retryMap(): void {
		mapError = null;
		mapTries++;
	}

	// The focus area: the places' outline, or the pin, set again on each change of frame; none
	// while new places resolve.
	$effect(() => {
		const plugin = focusArea;
		const current = frame.frame;
		if (!plugin) return;
		if (!current) plugin.set({ geometry: null });
		else plugin.set({ geometry: focusGeometry(current, frame.shapes), label: pinLabel });
	});

	// The basemap the options name (undo, another tab and a viewer's Reset follow too).
	$effect(() => {
		const current = map;
		const id = shown.basemap;
		if (!current) return;
		untrack(() => current.basemap.select(id ?? current.basemap.defaultId));
	});

	// The input's fields are getters, each read on its own.
	const dataInput = {
		get widget() {
			return widget;
		},
		get layer() {
			return layer;
		},
		get entryType(): string | undefined {
			return entryType;
		},
		get loads() {
			return loads;
		},
		get filters() {
			return wiring.filters;
		},
		get at() {
			return days.at ?? "now";
		},
		get ahead() {
			return days.ahead;
		},
		get today() {
			return days.today;
		},
		get fill() {
			return fillType;
		},
		// No use query yet, so pesticide use loads nothing.
		useQuery: null,
		bounds: null,
		zoom: 0,
		sectionZoom: SECTION_ZOOM,
		lensCenter: null
	};
	const data: MapData = new MapData(() => dataInput, { now: getNowClient(), rating: metadata });
	onDestroy(() => data.destroy());
	const { monitorsSource, smokeSource, fireSource, hotspotsSource, fillSource, noticesSource } =
		data;

	/** The fill is on the map: the tile has one the metadata lists, and its row hasn't hidden it. */
	const fillDrawn = $derived(!!fillInfo && wiring.fillShown);
	/** The fill's layer label: on now it says the figure is today's so far. */
	const fillLabel = $derived(
		!fillInfo
			? undefined
			: days.onDay
				? fillInfo.plural
				: m.map_fill_today_so_far({ regionType: fillInfo.plural })
	);
	/**
	 * The fill failed to load, while it's shown; or the region types it's checked against
	 * couldn't be looked up (with a saved fill, so it can't be drawn).
	 */
	const fillFailed = $derived(
		(fillDrawn && data.fillFailed) || (!!savedFill && !fillTypes.types && fillTypes.failed)
	);

	/** The fill note's Retry: the region types' lookup if that failed, else the fill. */
	function retryFill(): void {
		if (fillTypes.failed && !fillTypes.types) fillTypes.retry();
		else data.retryFill();
	}

	// Smoke and fire: now's or the day's, over the whole map, when on (the toolbar's switch hides
	// them, their data still loading).
	const smokeAndFire = $derived(data.smokeAndFire && shown.fireAndSmoke !== false);
	/** Smoke and fire failed to load, while they're shown. */
	const hmsFailed = $derived(data.hmsFailed && shown.fireAndSmoke !== false);
	/** Marker clusters: the saved choice, else the preset's default. */
	const clustered = $derived(shown.clustered ?? wiring.state?.presetDefaults.clustered !== false);
	const smokeLabel = $derived(datasetLabel(HMS_SMOKE));
	const fireLabel = $derived(datasetLabel(HMS_FIRE));

	// Spray notices: the day's (or now's), over the whole map, when the tile has them (the Layers
	// row hides them, their data still loading).
	/** The notices' layer label: the catalog's name for the data set. */
	const noticesLabel = $derived(datasetLabel(PESTICIDE_NOTICES));
	/** The notices are on the map: the tile has them, the catalog names them, and they're shown. */
	const noticesDrawn = $derived(!!noticesLabel && data.notices && wiring.noticesShown);
	/** The notices failed to load, while they're shown. */
	const noticesFailed = $derived(noticesDrawn && data.noticesFailed);
	/** A saved filter of the notices is gone, while they're shown: said, never an empty layer. */
	const noticesGone = $derived(noticesDrawn && data.noticesUnavailable === "filter-gone");
	/** The notices layer's saved filters, which the legend names. */
	const noticeFilters = $derived(
		widget.data.layers.find((l) => l.dataset === PESTICIDE_NOTICES)?.filters
	);
	/**
	 * The notices have loaded with none, for the day stop or for now (the legend says so); never
	 * while loading, after a failure or with a filter gone.
	 */
	const noNotices = $derived<"day" | "now" | null>(
		!noticesGone &&
			data.noticesState.status === "ready" &&
			data.noticesState.data.notices.length === 0
			? days.onDay
				? "day"
				: "now"
			: null
	);

	// Marks: monitors the person marks, saved in the options (one undo step each).
	const marks = $derived(mapOptions(widget).marks ?? []);
	const marksSelection = $derived<SpatialSelection | null>(
		marks.length ? { kind: "monitors", ids: marks } : null
	);
	/** Whether marks can be changed: the widget is in the current, editable dashboard. */
	const markable = $derived.by(() => {
		const session = app.current.session;
		return (
			!!session && !session.readOnly && session.doc.body.widgets.some((w) => w.id === widget.id)
		);
	});
	const limitMessage = () =>
		m.map_marks_limit({ count: formatNumber(MAP_MARKS_MAX), countValue: MAP_MARKS_MAX });

	/** Edit data on this widget (where a gone notices filter is changed). */
	function editData(): void {
		const session = app.current.session;
		if (!session || session.readOnly) return;
		void navigate("/dashboards/:id/widgets/:widgetId/edit", {
			params: { id: session.doc.id, widgetId: widget.id }
		});
	}

	/** A person's mark or unmark on the map, saved (a starter's edit goes to its copy). */
	function saveMarks(selection: SpatialSelection | null): void {
		const session = app.current.session;
		if (!session || session.readOnly) return;
		const current = session.doc.body.widgets.find((w) => w.id === widget.id);
		if (!current) return;
		const change = marksChange(current, selection?.kind === "monitors" ? selection.ids : []);
		if (change) session.apply(change);
	}

	// The monitors' plugin, added and removed as its inputs change. The other layers' plugins are
	// added by their components (`layers/`), under the monitors.
	$effect(() => {
		const current = map;
		const label = entryLabel;
		const selectionMode = markable ? "multiple" : "none";
		const clusters = clustered;
		const onDay = days.onDay;
		const figure = figureLabel;
		// On a day, made once its figure's name is known: one plugin per stop, not two.
		if (!current || !label || !loads || !figureLabelSettled) return;
		untrack(() =>
			current.addPlugin(
				monitorsPlugin({
					source: monitorsSource,
					layerLabel: label,
					selectedStyle: "ring",
					clustered: clusters,
					// On a day stop: why a monitor has no figure, and what its figure is. Unset on now.
					...(onDay && { detail: thinDetail }),
					...(figure && { figureLabel: figure })
				}),
				{
					selectionMode,
					pickWith: "modifier",
					canSelect: (next) => canMark(next, limitMessage()),
					selection: marksSelection,
					onselectionchange: saveMarks
				}
			)
		);
		return () => current.removePlugin("monitors");
	});

	// The document's marks on the map (undo, redo, another tab): setSelection fires nothing.
	$effect(() => {
		const current = map;
		const selection = marksSelection;
		if (!current || !current.plugins.some((p) => p.id === "monitors")) return;
		const shown = untrack(() => current.getSelection("monitors"));
		if (!sameIds(shown?.ids ?? [], selection?.ids ?? []))
			current.setSelection("monitors", selection);
	});

	/** A day's monitor without enough data for a figure says so where "No level" would be. */
	function thinDetail(props: MonitorFeatureProperties): string | undefined {
		return isThin(props) ? m.calendar_not_enough_data() : undefined;
	}

	/** Each notices marker's latest properties, by refKey: an open card follows its marker. */
	const noticesByRef = $derived(
		new Map(
			(noticesSource.features?.features ?? []).map((f) => [f.properties.refKey, f.properties])
		)
	);

	// The camera: fitted to the places on each change and on each (re-)attach, never saved.
	let body = $state<HTMLDivElement>();
	const positions = $derived(
		frame.frame?.focus === "monitor"
			? monitorPositions(data.placesLoaded, frame.frame.monitors)
			: new Map<string, [number, number]>()
	);
	const target = $derived(frame.frame ? fitTarget(frame.frame, frame.shapes, positions) : null);

	fitCamera({
		get map() {
			return map;
		},
		get target() {
			return target;
		},
		get fullscreen() {
			return fullscreen;
		},
		get body() {
			return body;
		}
	});

	const onScreen = new OnScreen(() => body, { activity: app.platform.activity });
	onDestroy(() => onScreen.destroy());
	// Live data polls only while the map is worth drawing (on screen, the page visible).
	$effect(() => {
		const on = onScreen.active;
		data.setPolling(on);
	});

	syncMapTitle(
		{
			get widgetId() {
				return widget.id;
			},
			get layer() {
				return layer;
			},
			get entryLabel() {
				return entryLabel;
			},
			get idle() {
				return idle;
			},
			get supported() {
				return supported;
			}
		},
		viewer
	);
	const title = $derived(widget.title ?? generatedTitle(widget.id));

	const noteLinesOf = new MapNoteLines(
		{
			get monitors() {
				return monitorsSource.features;
			},
			get marks() {
				return marks;
			},
			get entryType() {
				return entryType;
			},
			get entryLabel() {
				return entryLabel;
			},
			get inPlaces() {
				return data.inPlaces;
			},
			get dayDrawn() {
				return data.dayDrawn;
			},
			get dayUnrated() {
				return data.dayUnrated;
			},
			get dayNoFigures() {
				return data.dayNoFigures;
			}
		},
		metadata
	);
	/** The map's notes: the day's, then why marks are hidden. */
	const noteLines = $derived(noteLinesOf.lines);
	/** The notes as one text, for the map's list and its name. */
	const hiddenText = $derived(noteLinesOf.text);
	/**
	 * The feature list's note: on a day stop, what the monitors' figure is (said once, not on
	 * every row), then the map's notes.
	 */
	const listNote = $derived(
		figureLabel && hiddenText
			? m.sentence_join({ first: figureLabel, second: hiddenText })
			: figureLabel || hiddenText || undefined
	);
	/** The map's accessible name, which also says which marks aren't shown and why. */
	const mapLabel = $derived(
		!title
			? undefined
			: hiddenText
				? m.map_label_marks_hidden({ title, notes: hiddenText })
				: m.map_label({ title })
	);

	/** Why the places can't all be shown, over a map that still draws. */
	const note = $derived.by<QueryState | null>(() => {
		const s = frame.state;
		if (typeof s === "object" && "unavailable" in s) {
			return { status: "unavailable", reason: s.unavailable };
		}
		if (data.monitorsCurrent && data.monitorsUnavailable)
			return { status: "unavailable", reason: data.monitorsUnavailable };
		return data.unlisted ? { status: "unavailable", reason: "monitor-unlisted" } : null;
	});
	/** The places are scoped and loaded, but no monitor there reports the pollutant showing. */
	const noMonitors = $derived(
		!note &&
			data.monitorsCurrent &&
			data.monitorsState.status === "ready" &&
			(data.inPlaces?.size ?? 0) === 0
	);

	/** The layers' notes under the toolbar, in order. */
	const mapNotes = $derived.by(() => {
		const notes: MapNoteProps[] = [];
		if (data.monitorsRefreshFailed) {
			notes.push({
				message: m.map_refresh_failed(),
				hook: "map-refresh-note",
				action: { label: m.widget_state_retry(), onclick: () => data.retryMonitors() }
			});
		}
		if (hmsFailed) {
			notes.push({
				message: m.map_smoke_fire_failed(),
				hook: "map-hms-note",
				action: { label: m.widget_state_retry(), onclick: () => data.retryHms() }
			});
		}
		if (fillFailed) {
			notes.push({
				message: m.map_fill_failed(),
				hook: "map-fill-note",
				action: { label: m.widget_state_retry(), onclick: retryFill }
			});
		}
		if (noticesFailed) {
			notes.push({
				message: m.map_notices_failed(),
				hook: "map-notices-note",
				action: { label: m.widget_state_retry(), onclick: () => data.retryNotices() }
			});
		}
		// No Retry: only another filter brings the notices back (Edit data, for an editor).
		if (noticesGone) {
			notes.push({
				message: m.map_notices_filter_gone(),
				hook: "map-notices-gone",
				...(markable && { action: { label: m.widget_edit_data(), onclick: editData } })
			});
		}
		return notes;
	});

	/** What the widget shows instead of the map, if anything. */
	const instead = $derived.by<QueryState | null>(() => {
		if (idle) return { status: "idle" };
		if (support === "loading") return { status: "loading" };
		if (support === "pollutants-failed") {
			return { status: "error", error: new Error("Map pollutants unavailable") };
		}
		if (support !== "ok") return { status: "unavailable", reason: support };
		if (mapError) return { status: "error", error: mapError.error };
		const s = frame.state;
		if (typeof s === "object" && "error" in s) return { status: "error", error: s.error };
		if (data.monitorsState.status === "error" && data.monitorsData === undefined) {
			return { status: "error", error: data.monitorsState.error };
		}
		return null;
	});

	function retry(): void {
		if (pollutants === "unavailable") loadPollutants();
		else if (mapError) retryMap();
		else if (typeof frame.state === "object" && "error" in frame.state) frame.retry();
		else if (data.monitorsState.status === "error") data.retryMonitors();
	}

	let width = $state(0);
	const narrow = $derived(width > 0 && width < NARROW_PX);
	/** The toolbar's narrow breakpoint (48rem), which the day stepper follows. */
	const remPx = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
	const stepperNarrow = $derived(width > 0 && width < STEPPER_NARROW_REM * remPx);
	let legendOpen = $state(false);
</script>

{#snippet nothing()}{/snippet}

{#snippet noticesNote()}
	<NoticesLegendNote filters={noticeFilters} skipped={data.noticesSkipped} none={noNotices} />
{/snippet}

{#snippet cardActions(ctx: CardContext)}
	{#if ctx.selectable}
		<Button size="sm" variant="outline" onclick={() => ctx.toggle()}>
			{ctx.selected ? m.map_mark_remove() : m.map_mark_select()}
		</Button>
	{/if}
{/snippet}

{#snippet toolbarSlot()}
	{#if wiring.state}
		<OptionsToolbar
			groups={wiring.state.groups}
			values={wiring.state.values}
			defaults={wiring.state.defaults}
			basemapKey="basemap"
			readonly={!tileOptionsContext}
			onchange={wiring.onchange}
		/>
	{/if}
{/snippet}

{#snippet overlays()}
	{#if map}
		<MapLegendOverlay {map} {narrow} bind:open={legendOpen} />
	{/if}
	{#if map && (!map.ready || data.monitorsLoading)}
		<!-- Over the map and its legend, under the notes (the toolbar and list stay usable). -->
		<div class="bg-card absolute inset-0 p-2">
			<WidgetSkeleton />
		</div>
	{/if}
	<MapNotes
		{widget}
		place={note}
		{noMonitors}
		onDay={days.onDay}
		onretry={retry}
		notes={mapNotes}
	/>
{/snippet}

{#if map}
	<FillLayer {map} source={fillSource} label={fillLabel} {loads} drawn={fillDrawn} />
	<HmsLayers
		{map}
		{smokeSource}
		{fireSource}
		{hotspotsSource}
		{smokeLabel}
		{fireLabel}
		{loads}
		shown={smokeAndFire}
	/>
	<NoticesLayer
		{map}
		source={noticesSource}
		label={noticesLabel}
		drawn={noticesDrawn}
		{loads}
		{clustered}
		onNow={(days.at ?? "now") === "now"}
		byRef={noticesByRef}
		note={noticesNote}
	/>
{/if}

<div class="relative h-full w-full" bind:this={body} bind:clientWidth={width}>
	{#if !config}
		<p class="text-muted-foreground flex h-full items-center justify-center text-center text-sm">
			{m.map_unavailable_no_key()}
		</p>
	{:else if instead}
		<WidgetState
			state={instead}
			{widget}
			onretry={retry}
			onchoose={() => openPlacePicker({ widgetId: widget.id })}
			children={nothing}
		/>
	{:else if map}
		<!-- No WebGL: MapView fails to make its GL map, and the error state offers "Retry". -->
		<div class="flex h-full w-full flex-col">
			<svelte:boundary onerror={(error) => (mapError = { error })}>
				<MapView
					{map}
					class="min-h-0 w-full flex-1"
					active={onScreen.active}
					label={mapLabel}
					featureList={{ reveal: "focus", note: listNote }}
					selectionBar={false}
					tooltip="pointer"
					card={{ actions: cardActions }}
					toolbar={toolbarSlot}
					{overlays}
				/>
			</svelte:boundary>
			{#if days.ranged}
				<div class="border-border border-t" data-map-days>
					<DayStepper
						stops={days.stops}
						at={days.index}
						notFinal={data.dayNotFinal}
						narrow={stepperNarrow}
						onstep={days.step}
						ondragend={days.dragEnd}
					/>
				</div>
			{/if}
			<p
				class={["text-muted-foreground text-xs", noteLines.length && "px-2 pt-1"]}
				role="status"
				data-map-marks-hidden
			>
				{#each noteLines as line (line)}
					<span class="block">{line}</span>
				{/each}
			</p>
		</div>
	{/if}
</div>
