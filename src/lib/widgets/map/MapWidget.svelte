<script lang="ts">
	import { getContext, onDestroy, untrack } from "svelte";
	import {
		createMap,
		focusAreaPlugin,
		geometryBbox,
		MapView,
		monitorsPlugin,
		OptionsToolbar,
		type CardContext,
		type FocusAreaPlugin,
		type MapContext,
		type ShapesLens
	} from "@sjvair/map-sdk";
	import type { MonitorFeatureProperties, SpatialSelection } from "@sjvair/map-sdk/data";
	import { hasTypedTitle } from "$lib/actions/widget";
	import { openPlacePicker } from "$lib/components/dialogs/lazy.svelte";
	import { Button } from "$lib/components/ui/button";
	import { getMetadata } from "$lib/data";
	import { unavailableMessage } from "$lib/data/messages";
	import type { CatalogEntry, LocationGroup } from "$lib/data/metadata";
	import { getNowClient } from "$lib/data/now";
	import type { QueryState, UnavailableReason } from "$lib/data/types";
	import type { WidgetInstance } from "$lib/documents/schema";
	import { formatList, formatNumber, pacificDay, parseDateKey } from "$lib/format";
	import {
		HMS_FIRE,
		HMS_SMOKE,
		hasNotices,
		hasSmokeAndFire,
		locationsLayer
	} from "$lib/get-data/map";
	import { m } from "$lib/paraglide/messages.js";
	import { useApp } from "$lib/store/app.svelte";
	import {
		drawnMonitors,
		entryMeta,
		hasWhere,
		idleTypes,
		mainLayer,
		wherePurpose,
		widgetEffective,
		widgetPlaceKind
	} from "../shared/input";
	import { idleTypesNote } from "../shared/misfit-notes";
	import { useTileOptions } from "../shared/tile-options.svelte";
	import { PLACE_VIEWER_KEY, type PlaceViewer } from "../shared/viewer";
	import WidgetSkeleton from "../shared/WidgetSkeleton.svelte";
	import WidgetState from "../shared/WidgetState.svelte";
	import { generatedTitle } from "../titles.svelte";
	import { navigate } from "../../../router";
	import { MapData } from "./data/loaded.svelte";
	import type { UseQuery } from "./data/use";
	import { USE_FIELDS } from "./data/use-fields";
	import { sectionZoom } from "./data/use-geometry";
	import { fitCamera } from "./camera.svelte";
	import { MapPeriodFigure } from "./period-figure.svelte";
	import { MapFillTypes } from "./data/fill-types.svelte";
	import { MapDays } from "./day-mode.svelte";
	import { mapLevel, type MapLevel } from "./days";
	import DayStepper from "./DayStepper.svelte";
	import { MapFrame } from "./frame.svelte";
	import { focusGeometry } from "./focus";
	import { fitTarget } from "./framing";
	import { mapConfig } from "./host/config";
	import { mapFormat } from "./host/format";
	import { mapMessages } from "./host/messages";
	import { mapMetadata } from "./host/metadata";
	import { mapShowsLabel, syncMapTitle } from "./map-title.svelte";
	import { MapNoteLines } from "./note-lines.svelte";
	import { setMapSend } from "./send-registry";
	import { runShowIn } from "./show-in-items";
	import FillLayer from "./layers/FillLayer.svelte";
	import HmsLayers from "./layers/HmsLayers.svelte";
	import LocationsLayer from "./layers/LocationsLayer.svelte";
	import NoticesLayer from "./layers/NoticesLayer.svelte";
	import UseLayers from "./layers/UseLayers.svelte";
	import MapLegendOverlay from "./MapLegendOverlay.svelte";
	import type { MapNoteProps } from "./MapNote.svelte";
	import MapNotes from "./MapNotes.svelte";
	import NoticesLegendNote from "./NoticesLegendNote.svelte";
	import UseLegendNote from "./UseLegendNote.svelte";
	import { OnScreen } from "./on-screen.svelte";
	import { periodLegendUnits, thinDetail } from "./thin-detail";
	import { canMark, marksChange, sameIds } from "./marks";
	import {
		MAP_MARKS_MAX,
		mapOptions,
		PESTICIDE_NOTICES,
		PESTICIDE_USE,
		pollutantLayer
	} from "./options";
	import type { NoticesDay } from "./section-links";
	import { mapNotShown, notShownNotes } from "./not-shown";
	import { periodLabel, periodOfStop, type UsePeriod } from "./use-period";
	import { monitorPositions } from "./sources";
	import { MapToolbar } from "./toolbar/toolbar.svelte";
	import { MapToolbarWiring, type MapToolbarWiringInput } from "./toolbar/wiring.svelte";

	let { widget, fullscreen = false }: { widget: WidgetInstance; fullscreen?: boolean } = $props();
	const app = useApp();

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

	/** The ticked location types (missing or empty: none, so nothing is drawn). */
	const locationTypes = $derived(locationsLayer(widget.data)?.locationTypes ?? []);
	/**
	 * The regions meta's location groups (their keys, labels and types), loaded once the tile
	 * ticks a type; `"failed"` when they couldn't be read ("Retry" asks again).
	 */
	let locationGroups = $state.raw<LocationGroup[] | "failed" | undefined>();
	function loadLocationGroups(): void {
		locationGroups = undefined;
		metadata.locationGroups().then(
			(groups) => (locationGroups = groups),
			() => (locationGroups = "failed")
		);
	}
	$effect(() => {
		if (locationTypes.length && untrack(() => locationGroups) === undefined) {
			untrack(loadLocationGroups);
		}
	});
	/**
	 * The location groups drawn: each with a ticked type, in the meta's order, labelled by it,
	 * with its ticked types. A ticked type the meta doesn't list is in none, so isn't drawn.
	 */
	const tickedGroups = $derived.by(() => {
		if (!Array.isArray(locationGroups) || !locationTypes.length) return [];
		return locationGroups.flatMap((g) => {
			const types = g.types.map((t) => t.type).filter((t) => locationTypes.includes(t));
			return types.length ? [{ key: g.key, label: g.label, types }] : [];
		});
	});
	/**
	 * The tile draws schools or child care: once the groups are known, a group has a ticked type
	 * (types the meta doesn't list draw nothing); until then, or when they fail (their note and
	 * Retry show over the map), any ticked type.
	 */
	const drawsLocations = $derived(
		Array.isArray(locationGroups) ? tickedGroups.length > 0 : locationTypes.length > 0
	);
	const layer = $derived(mainLayer(widget.data, known));
	/** A dataset's name from the catalog (smoke and fire's layer labels). */
	const datasetLabel = (id: string) => known?.find((d) => d.id === id)?.label;

	/** The tile's own pesticide use layer (no entry type: its figure is an option), if any. */
	const useLayer = $derived(
		widget.data.layers.find((l) => l.dataset === PESTICIDE_USE && !l.entryType)
	);
	/** The catalog's pesticide use figures the map draws (its labels, units and precision). */
	const useFigures = $derived(
		(known?.find((d) => d.id === PESTICIDE_USE)?.entryTypes ?? []).filter((t) =>
			Object.hasOwn(USE_FIELDS, t.id)
		)
	);

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
		get notShown() {
			return notShown;
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
		},
		get locationGroups() {
			return tickedGroups;
		},
		get use() {
			return !!useLayer;
		},
		get useLabel() {
			return datasetLabel(PESTICIDE_USE);
		},
		get useFigures() {
			return useFigures;
		}
	});
	/** The options the tile shows (a viewer's held keys over the saved ones). */
	const shown = $derived(wiring.options);
	/**
	 * The Map's dataset over its range (Automatic included: the finest level from Daily up that
	 * every layer offers), as of today; null without a range (Now).
	 */
	const effective = $derived.by(() => {
		const range = widget.data.dateRange;
		if (!range) return null;
		const place = widgetPlaceKind(widget.data);
		const now = pacificDay(days.today, 12);
		return widgetEffective(widget, known, place, range, now);
	});
	/** What the stops step by: the effective resolution; Daily without a range. */
	const resolution = $derived<MapLevel>(effective ? mapLevel(effective.resolution) : "day");
	/**
	 * The place-less datasets not drawn at the resolution (or, for use, on Now), from untrusted
	 * input: no plugin, no toolbar row, and a note. Known once the catalog is.
	 */
	const notShown = $derived(known ? mapNotShown(widget.data, effective) : []);
	// The periods of the tile's range at its resolution: the stop showing, and the stepper's steps
	// (saved, or a viewer's held). Without a range the tile shows now.
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
		},
		get resolution() {
			return resolution;
		}
	});
	onDestroy(() => days.destroy());

	const savedFill = $derived(wiring.saved.fill);
	const fillTypes = new MapFillTypes(() => savedFill, metadata);
	onDestroy(() => fillTypes.destroy());
	/** The region type filled, when the metadata lists it; null for no fill. */
	const fillType = $derived(fillTypes.type);
	const fillInfo = $derived(fillTypes.info);
	/** The pollutant drawn: the Map's one (unavailable when the server's map doesn't offer it). */
	const entryType: string | undefined = $derived(wiring.drawn);
	const entryInfo = $derived(entryMeta(known, pollutantLayer(widget.data, known))?.entryType);
	const entryLabel = $derived(entryInfo?.label);
	const periodFigure = new MapPeriodFigure(
		{
			get entryType() {
				return entryType;
			},
			get resolution() {
				return days.resolution;
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
	onDestroy(() => periodFigure.destroy());
	/** Whether the figure's name is known for the pollutant drawn (or isn't needed: on now). */
	const figureLabelSettled = $derived(periodFigure.settled);
	/**
	 * On a stop, what the monitors' figure is ("24-hour average", or at Monthly and Yearly "Average
	 * of 24-hour averages"); unset on now.
	 */
	const figureLabel = $derived(periodFigure.label);
	/**
	 * On a Monthly or Yearly stop, the legend's line under the pollutant's section: its units and
	 * figure, for the monitors and the fill (one shared section). Unset on a day or now.
	 */
	const legendUnits = $derived(
		periodLegendUnits({
			onDay: days.onDay,
			resolution: days.resolution,
			figure: figureLabel,
			units: entryInfo?.units
		})
	);
	/**
	 * The Map has a pollutant to draw (an air-quality layer with an entry type: None keeps the
	 * layer's types and monitors with none). A pollutant is optional (spec decision 6).
	 */
	const hasPollutant = $derived(!!pollutantLayer(widget.data, known)?.entryType);
	/** The Map has a Where: with none, nothing that needs a place draws (ticked types, sites). */
	const whereSet = $derived(hasWhere(widget.data));
	/** Ticked monitor types that draw nothing for want of a Where. */
	const typesIdle = $derived(hasPollutant ? idleTypes(widget.data, known) : []);
	/** Ticked sites that draw nothing for want of a Where. */
	const sitesIdle = $derived(drawsLocations && !whereSet);
	/**
	 * The Map has something to draw: a pollutant (inside a Where, or its searched monitors), smoke
	 * and fire, spray notices, sites inside a Where, pesticide use or a region fill. With none, it
	 * says what to add: a place, when one would make something draw.
	 */
	const drawsAnything = $derived(
		(hasPollutant && (whereSet || drawnMonitors(widget.data, known).monitors.length > 0)) ||
			hasSmokeAndFire(widget.data) ||
			hasNotices(widget.data) ||
			(drawsLocations && whereSet) ||
			!!useLayer ||
			!!savedFill
	);
	/** A place would make something draw: ticked types or sites idle for want of a Where. */
	const needsPlace = $derived(typesIdle.length > 0 || sitesIdle);
	/** No map is made: nothing to draw, or only the starter's unresolved place. */
	const idle = $derived(!drawsAnything || widget.data.place?.kind === "default-place");
	/**
	 * Whether the map can show a pollutant of the tile: none the server's map offers is never drawn.
	 */
	const support = $derived.by<"loading" | "ok" | "pollutants-failed" | UnavailableReason>(() => {
		if (catalog === "unavailable") return "catalog-unavailable";
		if (catalog === undefined) return "loading";
		// With no pollutant the server's map pollutants don't matter: the other layers draw.
		if (hasPollutant) {
			if (pollutants === undefined) return "loading";
			if (pollutants === "unavailable") return "pollutants-failed";
			if (!entryType || !entryLabel || !pollutants.includes(entryType)) {
				return "unknown-entry-type";
			}
		}
		// A stored level outside the Map's (hour or raw, from untrusted input) draws nothing.
		if (effective?.unusable) return "no-resolution";
		return "ok";
	});
	const supported = $derived(support === "ok");
	/** Whether the tile loads its data: a map is (or will be) drawn, with now or a day to show. */
	const loads = $derived(!!config && supported && !idle && days.at !== null);

	// The Where frames the map whatever it draws: with no pollutant, a point's region is looked
	// up as a new widget's (PM2.5, `wherePurpose`). Nothing is framed while idle.
	const frame = new MapFrame(
		() => (idle ? undefined : (layer ?? wherePurpose(widget.data, known))),
		() => widget.data
	);
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
		get useQuery() {
			return useQuery;
		},
		get bounds() {
			return map?.bounds ?? null;
		},
		get zoom() {
			return map?.camera.zoom ?? 0;
		},
		get sectionZoom() {
			return useZoom;
		},
		get lensCenter() {
			return lensCenter;
		}
	};
	// Pesticide use: the figure and period drawn (never written back), its query, and the zoom
	// that switches townships to sections.
	const useFigureId = $derived(wiring.useFigure);
	const useFigureInfo = $derived(useFigures.find((t) => t.id === useFigureId));
	/** The period drawn: the month or year stop showing (none on a day or on Now). */
	const stopPeriod = $derived.by<UsePeriod | null>(() => (days.at ? periodOfStop(days.at) : null));
	/**
	 * Use is on the map: the tile has it, the catalog names it and its figure, a month or year stop
	 * shows, and it's shown.
	 */
	const useDrawn = $derived(
		!!useLayer &&
			!!datasetLabel(PESTICIDE_USE) &&
			!!useFigureInfo &&
			!!stopPeriod &&
			!notShown.includes(PESTICIDE_USE) &&
			wiring.useShown
	);
	/** What use draws; null while it's off, hidden, unparseable, or the catalog lacks it. */
	const useQuery = $derived.by<UseQuery | null>(() => {
		const info = useFigureInfo;
		const period = stopPeriod;
		if (!useDrawn || !info || !period) return null;
		return {
			figure: info.id,
			period,
			filters: useLayer?.filters ?? {},
			info: { label: info.label, units: info.units, precision: info.precision ?? 0 }
		};
	});
	/** The use layer's label: the figure and the period ("Pounds Applied, 2023"). */
	const useLabel = $derived(
		useFigureInfo && stopPeriod
			? m.map_use_layer({ figure: useFigureInfo.label, period: periodLabel(stopPeriod) })
			: undefined
	);
	/** The figures the use cards list: the catalog's labels, units and precision. */
	const useCardFigures = $derived(
		useFigures.map((t) => ({
			id: t.id,
			label: t.label,
			units: t.units,
			precision: t.precision ?? 0
		}))
	);
	/** The query as a key: the plugins are made again when it changes. */
	const useKey = $derived(useQuery ? JSON.stringify(useQuery) : null);
	/** The day the notices layer shows when that is a past day: the card's "Notices here" link. */
	const noticesPastDay = $derived.by<NoticesDay | null>(() => {
		const at = days.at;
		if (!noticesDrawn || !at || at === "now" || !("day" in at)) return null;
		const day = parseDateKey(at.day);
		return { year: day.y, month: day.m };
	});
	/** The township the lens is centred on (the lens plugin's, through UseLayers). */
	let lensCenter = $state<string | null>(null);
	/** The lens plugin, for the township card's "Show square miles". */
	let useLens = $state.raw<ShapesLens | null>(null);

	const data: MapData = new MapData(() => dataInput, { now: getNowClient(), rating: metadata });
	onDestroy(() => data.destroy());
	const {
		monitorsSource,
		smokeSource,
		fireSource,
		hotspotsSource,
		fillSource,
		noticesSource,
		locationsSource
	} = data;

	/** The location groups on the map: those drawn that the Layers rows haven't switched off. */
	const locationsShown = $derived(
		tickedGroups.filter((g) => wiring.locationGroupsShown.includes(g.key))
	);
	/** The groups shown, named as one list ("Schools and Child care"), for the notes. */
	const locationsLabel = $derived(formatList(locationsShown.map((g) => g.label)));

	/** The map body's size (the legend folds, the stepper narrows, the section zoom). */
	let width = $state(0);
	let height = $state(0);
	/** The last latitude known, kept while a new key loads (its townships aren't in yet). */
	let lastUseLat: number | null = null;
	/**
	 * The latitude the section zoom is computed at: fixed, so a pan never re-makes the plugins. The
	 * places' centre, else the middle of the valley's townships, else the last one known; null
	 * until one is.
	 */
	const useLat = $derived.by<number | null>(() => {
		const fit = target;
		if (fit && "bbox" in fit) return (lastUseLat = (fit.bbox[1] + fit.bbox[3]) / 2);
		if (fit) return (lastUseLat = fit.center[1]);
		let south = Infinity;
		let north = -Infinity;
		for (const f of data.useBlock.townships.features?.features ?? []) {
			const box = geometryBbox(f.geometry);
			if (!box) continue;
			south = Math.min(south, box[1]);
			north = Math.max(north, box[3]);
		}
		if (south <= north) lastUseLat = (south + north) / 2;
		return lastUseLat;
	});
	/** The section zoom for the map's size and latitude, raised by the server's refusals. */
	const useZoom = $derived(
		Math.round(sectionZoom(width, height, useLat ?? 0) + data.useBlock.refusedZoom)
	);
	/**
	 * Nothing will draw for the key (an unlisted period, a failed load, a gone filter), so the
	 * section zoom doesn't matter.
	 */
	const useNothingToDraw = $derived(
		["no-data", "error", "filter-gone"].includes(data.useBlock.townshipsState)
	);
	/**
	 * The use plugins are on the map once it has a size and the latitude is known, or without one
	 * when nothing will draw (for the legend's status row and note).
	 */
	const useLayersDrawn = $derived(
		useDrawn && width > 0 && height > 0 && (useLat !== null || useNothingToDraw)
	);

	/** The use note's Retry: what failed. */
	function retryUse(): void {
		data.retryUse();
	}
	const useFailed = $derived(useDrawn && data.useBlock.townshipsState === "error");
	const useGone = $derived(useDrawn && data.useUnavailable === "filter-gone");
	const useSectionsFailed = $derived(useDrawn && data.useBlock.sectionsFailed);

	/**
	 * The fill is on the map: the tile has one the metadata lists, and its row hasn't hidden it.
	 * With no pollutant it is the regions' outlines alone, with no legend section.
	 */
	const fillDrawn = $derived(!!fillInfo && wiring.fillShown);
	/**
	 * The fill's layer label: on now it says the figure is today's so far, and on the current month
	 * or year that it's the period's so far.
	 */
	const fillLabel = $derived.by(() => {
		if (!fillInfo) return undefined;
		const regionType = fillInfo.plural;
		// Outlines alone (no pollutant) have no figure to be "so far".
		if (!hasPollutant) return regionType;
		if (!days.onDay) return m.map_fill_today_so_far({ regionType });
		if (!days.soFar) return regionType;
		return days.resolution === "year"
			? m.map_fill_year_so_far({ regionType })
			: m.map_fill_month_so_far({ regionType });
	});
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
	// them, their data still loading). Daily only: not drawn at Monthly or Yearly.
	const smokeAndFire = $derived(
		data.smokeAndFire &&
			shown.fireAndSmoke !== false &&
			!notShown.includes(HMS_SMOKE) &&
			!notShown.includes(HMS_FIRE)
	);
	/** Smoke and fire failed to load, while they're shown. */
	const hmsFailed = $derived(data.hmsFailed && smokeAndFire);
	/** Marker clusters: the saved choice, else the preset's default. */
	const clustered = $derived(shown.clustered ?? wiring.state?.presetDefaults.clustered !== false);
	const smokeLabel = $derived(datasetLabel(HMS_SMOKE));
	const fireLabel = $derived(datasetLabel(HMS_FIRE));

	// Spray notices: the day's (or now's), over the whole map, when the tile has them (the Layers
	// row hides them, their data still loading).
	/** The notices' layer label: the catalog's name for the data set. */
	const noticesLabel = $derived(datasetLabel(PESTICIDE_NOTICES));
	/**
	 * The notices are on the map: the tile has them, the catalog names them, the resolution is
	 * Daily (or Now), and they're shown.
	 */
	const noticesDrawn = $derived(
		!!noticesLabel && data.notices && !notShown.includes(PESTICIDE_NOTICES) && wiring.noticesShown
	);
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
	 * before they first load, after a failure or with a filter gone. A poll (loading again for
	 * the same day and filters) keeps the last loaded value, so the line doesn't flicker.
	 */
	const noNotices = $derived.by<"day" | "now" | null>(() => {
		const state = data.noticesState;
		const loaded = state.status === "ready" || state.status === "loading" ? state.data : undefined;
		if (noticesGone || loaded === undefined || loaded.notices.length > 0) return null;
		// Spray notices are daily: a month or year stop has none to say "none" about.
		if (days.onDay && days.resolution !== "day") return null;
		return days.onDay ? "day" : "now";
	});

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
		const units = legendUnits;
		// On a day, made once its figure's name is known: one plugin per stop, not two.
		if (!current || !label || !loads || !figureLabelSettled) return;
		untrack(() =>
			current.addPlugin(
				monitorsPlugin({
					source: monitorsSource,
					layerLabel: label,
					selectedStyle: "ring",
					clustered: clusters,
					// On a stop: why a monitor has no figure, and what its figure is. Unset on now.
					...(onDay && { detail: monitorThinDetail }),
					...(figure && { figureLabel: figure }),
					...(units && { legendUnits: units })
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

	/** A stop's monitor without enough data for a figure says so where "No level" would be. */
	function monitorThinDetail(props: MonitorFeatureProperties): string | undefined {
		return thinDetail(props, days.resolution);
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
	// Fullscreen, the map takes the wheel and one finger (no Ctrl needed); on the dashboard it
	// keeps cooperative gestures, so the page scrolls past it. Reads `fullscreen` and `map` only.
	$effect(() => {
		const on = !fullscreen;
		map?.setCooperativeGestures(on);
	});
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
			get data() {
				return widget.data;
			},
			get layer() {
				return layer ?? wherePurpose(widget.data, known);
			},
			get entryLabel() {
				return hasPollutant ? entryLabel : showsLabel;
			},
			get monitorsShown() {
				return hasPollutant;
			},
			// Waiting only for a place, it's still titled by what it shows ("PM2.5 map").
			get idle() {
				return idle && !needsPlace;
			},
			get supported() {
				return supported;
			}
		},
		viewer
	);
	/**
	 * What a Map with no pollutant shows, for its title (so its map has an accessible name): its
	 * layers' names, the catalog's where it has one ("Pesticide Use, ZIP Codes").
	 */
	const showsLabel = $derived(
		mapShowsLabel([
			hasSmokeAndFire(widget.data) ? m.get_data_smoke_and_fire() : undefined,
			hasNotices(widget.data) ? noticesLabel : undefined,
			...tickedGroups.map((g) => g.label),
			useLayer ? datasetLabel(PESTICIDE_USE) : undefined,
			savedFill ? fillInfo?.plural : undefined
		])
	);
	/** The person typed a title (an empty or blank one names nothing). */
	const typed = $derived(hasTypedTitle(widget));
	const title = $derived(typed ? widget.title! : generatedTitle(widget.id));

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
			},
			get level() {
				return days.resolution;
			}
		},
		metadata
	);
	// What the ⋯ menu's Show in a chart / table sends (D21): the sent marks, and the dataset as
	// this person sees it. None in a preview (no tile options; D23); with no mark the entry is empty
	// (the menu lists nothing) but still serves a section card's button.
	const sendOwner = Symbol();
	$effect(() => {
		const { ids, leftOut } = noteLinesOf.send;
		// An empty entry still holds the draft a section card's button sends.
		if (!tileOptionsContext) return;
		return setMapSend(widget.id, sendOwner, {
			marks: ids,
			leftOut,
			// A plain snapshot: the hand-off clones it.
			draft: () =>
				$state.snapshot({ type: widget.type, data: widget.data, options: wiring.options })
		});
	});
	/** A section card's "Show in a chart": its MTRS code (the feature's name) goes to the Chart. */
	function showSectionInChart(ctx: CardContext) {
		const source = ctx.pluginId === "lens" ? data.useBlock.lens : data.useBlock.sections;
		const found = source.features?.features?.find((f) => f.properties.refKey === ctx.refKey);
		// Only a section the source still holds: its name is its MTRS code.
		if (found?.properties.level !== "section" || !found.properties.name) return;
		runShowIn(app, widget.id, { kind: "section", code: found.properties.name }, "chart");
	}
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
	/**
	 * The map's accessible name, which also says which marks aren't shown and why. A generated
	 * title already names the map; a typed one gets "map" after it.
	 */
	const mapLabel = $derived.by(() => {
		if (!title) return undefined;
		if (!typed) return hiddenText ? m.sentence_join({ first: title, second: hiddenText }) : title;
		return hiddenText
			? m.map_label_marks_hidden({ title, notes: hiddenText })
			: m.map_label({ title });
	});

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
		// Ticked types or sites with no Where draw nothing: say what's missing.
		const typesNote = idleTypesNote(widget.data, known, markable);
		if (typesNote) notes.push({ message: typesNote, hook: "map-types-need-place" });
		if (sitesIdle && tickedGroups.length) {
			const layers = formatList(tickedGroups.map((g) => g.label));
			notes.push({
				message: markable
					? m.map_sites_need_place({ layers })
					: m.map_sites_need_place_view({ layers }),
				hook: "map-sites-need-place"
			});
		}
		if (locationTypes.length && locationGroups === "failed") {
			notes.push({
				message: m.map_locations_groups_failed(),
				hook: "map-locations-groups-failed",
				action: { label: m.widget_state_retry(), onclick: loadLocationGroups }
			});
		}
		if (locationsShown.length && data.locationsFailed) {
			notes.push({
				message: m.map_locations_failed({ layers: locationsLabel }),
				hook: "map-locations-failed",
				action: { label: m.widget_state_retry(), onclick: () => data.retryLocations() }
			});
		}
		// No Retry: only another Where brings them back. Said once when the place's own note
		// already gives the same reason.
		const locationsWhy = data.locationsUnavailable;
		if (
			locationsShown.length &&
			locationsWhy &&
			!(note?.status === "unavailable" && note.reason === locationsWhy)
		) {
			notes.push({
				message: m.sentence_join({
					first: m.map_locations_unavailable({ layers: locationsLabel }),
					second: unavailableMessage(locationsWhy)
				}),
				hook: "map-locations-unavailable"
			});
		}
		if (useFailed) {
			notes.push({
				message: m.map_use_failed(),
				hook: "map-use-failed",
				action: { label: m.widget_state_retry(), onclick: retryUse }
			});
		}
		// A Map with a pollutant but no ticked types and no searched monitors (a new Map whose
		// catalog couldn't be read, say) draws no monitors: say so, and how to choose some.
		if (layer?.entryType && !layer.monitorTypes?.length && !layer.monitors?.length) {
			notes.push({
				message: m.map_no_monitors_chosen(),
				hook: "map-no-monitors-chosen",
				...(markable && { action: { label: m.widget_edit_data(), onclick: editData } })
			});
		}
		if (useGone) {
			notes.push({
				message: m.map_use_filter_gone(),
				hook: "map-use-gone",
				...(markable && { action: { label: m.widget_edit_data(), onclick: editData } })
			});
		}
		if (useSectionsFailed) {
			notes.push({
				message: m.map_use_sections_failed(),
				hook: "map-use-sections-failed",
				action: { label: m.widget_state_retry(), onclick: retryUse }
			});
		}
		// No Retry: only another resolution (or dates) brings them back (Edit data, for an editor).
		for (const { id, message } of notShownNotes(notShown, known, markable)) {
			notes.push({
				message,
				hook: `map-not-shown-${id}`,
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

	/** The toolbar's narrow breakpoint (48rem), which the day stepper follows. */
	const remPx = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
	const stepperNarrow = $derived(width > 0 && width < STEPPER_NARROW_REM * remPx);
	let legendOpen = $state<boolean | null>(null);
</script>

{#snippet nothing()}{/snippet}

{#snippet noticesNote()}
	<NoticesLegendNote filters={noticeFilters} skipped={data.noticesSkipped} none={noNotices} />
{/snippet}

{#snippet useNote()}
	<UseLegendNote filters={useLayer?.filters} />
{/snippet}

{#snippet cardActions(ctx: CardContext)}
	{#if ctx.selectable}
		<Button size="sm" variant="outline" onclick={() => ctx.toggle()}>
			{ctx.selected ? m.map_mark_remove() : m.map_mark_select()}
		</Button>
	{/if}
	<!-- Only the sections' cards (the townships' have none); none in a preview (D23). The code is
		read at the click, so a refetch never unmounts the button under focus. -->
	{#if tileOptionsContext && (ctx.pluginId === "sections" || ctx.pluginId === "lens")}
		<Button size="sm" variant="outline" onclick={() => showSectionInChart(ctx)}>
			{m.map_show_in_chart()}
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
		<MapLegendOverlay {map} bind:open={legendOpen} />
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
		level={days.resolution}
		onretry={retry}
		notes={mapNotes}
	/>
{/snippet}

{#if map}
	<UseLayers
		{map}
		townships={data.useBlock.townships}
		sections={data.useBlock.sections}
		lensSource={data.useBlock.lens}
		block={(refKey) => data.useBlock.blockOf(refKey)}
		parentOf={(props) => data.useBlock.parentOf(props)}
		childrenLoaded={(refKey) => data.useBlock.childrenLoaded(refKey)}
		label={useLabel}
		units={useFigureInfo?.units ?? ""}
		zoom={useZoom}
		queryKey={useKey}
		query={useQuery}
		figures={useCardFigures}
		drawn={useLayersDrawn}
		{loads}
		note={useNote}
		onlens={(center) => (lensCenter = center)}
		noticesDay={noticesPastDay}
		bind:lens={useLens}
	/>
	<FillLayer
		{map}
		source={fillSource}
		label={fillLabel}
		{loads}
		drawn={fillDrawn}
		level={days.onDay ? days.resolution : undefined}
		{legendUnits}
	/>
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
	{#each locationsShown as group (group.key)}
		<LocationsLayer
			{map}
			id={`locations-${group.key}`}
			source={locationsSource}
			label={group.label}
			types={group.types}
			later={tickedGroups
				.slice(tickedGroups.findIndex((g) => g.key === group.key) + 1)
				.map((g) => `locations-${g.key}`)}
			{loads}
		/>
	{/each}
{/if}

<div
	class="relative h-full w-full"
	bind:this={body}
	bind:clientWidth={width}
	bind:clientHeight={height}
>
	{#if !config}
		<p class="text-muted-foreground flex h-full items-center justify-center text-center text-sm">
			{m.map_unavailable_no_key()}
		</p>
	{:else if instead}
		<!-- With nothing to draw it says what to add (never "Choose a place": a Where alone draws
			nothing); only the starter's unresolved place asks for a place. -->
		<WidgetState
			state={instead}
			{widget}
			onretry={retry}
			onchoose={drawsAnything || needsPlace
				? () => openPlacePicker({ widgetId: widget.id })
				: undefined}
			idleText={drawsAnything
				? undefined
				: needsPlace
					? m.map_empty_add_place()
					: m.map_empty_add_layers()}
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
						resolution={days.resolution}
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
