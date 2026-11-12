<script lang="ts">
	import { getContext, onDestroy, untrack } from "svelte";
	import {
		createMap,
		focusAreaPlugin,
		hmsFirePlugin,
		hmsSmokePlugin,
		Legend,
		MapView,
		monitorsPlugin,
		type CardContext,
		type FocusAreaPlugin,
		type MapContext
	} from "@sjvair/map-sdk";
	import type {
		DataSource,
		DataStatus,
		FireFeatureProperties,
		MonitorFeatureProperties,
		SpatialSelection
	} from "@sjvair/map-sdk/data";
	import type { MonitorLatest } from "@sjvair/sdk";
	import { ancestorAnimationsSettled } from "$lib/charts/settled";
	import { openPlacePicker } from "$lib/components/dialogs/lazy.svelte";
	import { Button } from "$lib/components/ui/button";
	import { getMetadata, getQueryClient } from "$lib/data";
	import { LiveQuery } from "$lib/data/live-query.svelte";
	import type { CatalogEntry } from "$lib/data/metadata";
	import { getNowClient } from "$lib/data/now";
	import type { NowState } from "$lib/data/now/client";
	import { NowQuery } from "$lib/data/now/now-query.svelte";
	import type { QueryState, UnavailableReason } from "$lib/data/types";
	import type { WidgetInstance } from "$lib/documents/schema";
	import { formatNumber } from "$lib/format";
	import { hasSmokeAndFire, HMS_FIRE, HMS_SMOKE } from "$lib/get-data/map";
	import { m } from "$lib/paraglide/messages.js";
	import { useApp } from "$lib/store/app.svelte";
	import { entryMeta, nowInput, placesLayer } from "../shared/input";
	import { PLACE_VIEWER_KEY, type PlaceViewer } from "../shared/viewer";
	import WidgetSkeleton from "../shared/WidgetSkeleton.svelte";
	import WidgetState from "../shared/WidgetState.svelte";
	import { placeLabel } from "../title";
	import { generatedTitle, setGeneratedTitle } from "../titles.svelte";
	import { hmsEntry, type HmsData } from "./data/hms";
	import { monitorsEntry } from "./data/monitors";
	import { MapFrame } from "./frame.svelte";
	import { focusGeometry } from "./focus";
	import { fitTarget } from "./framing";
	import { mapConfig } from "./host/config";
	import { mapFormat } from "./host/format";
	import { mapMessages } from "./host/messages";
	import { mapMetadata } from "./host/metadata";
	import { OnScreen } from "./on-screen.svelte";
	import { canMark, hiddenMarks, marksChange } from "./marks";
	import { MAP_MARKS_MAX, mapOptions, pollutantLayers, showingOf } from "./options";
	import { monitorIds, monitorPositions } from "./sources";

	let { widget, fullscreen = false }: { widget: WidgetInstance; fullscreen?: boolean } = $props();
	const app = useApp();

	/** Below this widget width the legend folds into a "Legend" button. */
	const NARROW_PX = 360;
	const FIT_PADDING = 32;

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
	/** The pollutant drawn now. */
	const entryType = $derived(showingOf(widget.data, mapOptions(widget), known));
	const entryLabel = $derived(
		entryMeta(
			known,
			pollutantLayers(widget.data, known).find((l) => l.entryType === entryType)
		)?.entryType.label
	);
	/** A dataset's name from the catalog (smoke and fire's layer labels). */
	const datasetLabel = (id: string) => known?.find((d) => d.id === id)?.label;
	const idle = $derived(
		!layer || (!layer.place && !layer.selection) || layer.place?.kind === "default-place"
	);
	/**
	 * Whether the map can show the pollutant showing. One the server's map doesn't offer is never
	 * drawn.
	 */
	const support = $derived.by<"loading" | "ok" | "pollutants-failed" | UnavailableReason>(() => {
		if (catalog === "unavailable") return "catalog-unavailable";
		if (catalog === undefined || pollutants === undefined) return "loading";
		if (pollutants === "unavailable") return "pollutants-failed";
		if (!entryType || !entryLabel || !pollutants.includes(entryType)) return "unknown-entry-type";
		return "ok";
	});
	const supported = $derived(support === "ok");
	/** Whether the tile loads its data: a map is (or will be) drawn. */
	const loads = $derived(!!config && supported && !idle);

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

	// The focus area: the places' outline, or the pin, set again on each change of frame.
	$effect(() => {
		const plugin = focusArea;
		const current = frame.frame;
		if (!plugin || !current) return;
		plugin.set({ geometry: focusGeometry(current, frame.shapes), label: pinLabel });
	});

	/**
	 * A now state as map-sdk's data status. Errors are the widget's to show (its error state or
	 * its notes, each with one Retry), so map-sdk never sees one: held data reads as ready.
	 */
	function dataStatus(state: NowState<unknown>): DataStatus {
		return state.data === undefined && state.status !== "error"
			? { state: "loading" }
			: { state: "ready" };
	}

	const nowClient = getNowClient();

	// The monitors: the pollutant showing's readings, limited by the places.
	const monitorsQuery = new NowQuery<MonitorLatest[]>(nowClient);
	onDestroy(() => monitorsQuery.destroy());
	/** The pollutant the monitors query loads (the readings' scale). */
	let monitorsFor = $state<string | undefined>();
	/** Why the places can't be scoped to monitors, if they can't. */
	let monitorsUnavailable = $state.raw<UnavailableReason | null>(null);
	/** The places, as a key: the monitors' scope is resolved again only when they change. */
	const placesKey = $derived(
		layer ? JSON.stringify([layer.place ?? null, layer.selection ?? null]) : ""
	);
	/** What the monitors are wanted for now: the places and the pollutant showing. */
	const wantedKey = $derived(`${placesKey}|${entryType ?? ""}`);
	/** What the monitors query was resolved for; while it isn't `wantedKey`, its data is stale. */
	let resolvedFor = $state<string | null>(null);

	$effect(() => {
		const wanted = wantedKey;
		const type = entryType;
		if (!loads || !type) {
			monitorsUnavailable = null;
			monitorsQuery.set(null);
			return;
		}
		const data = untrack(() => $state.snapshot(widget.data));
		let cancelled = false;
		const abort = new AbortController();
		const resolve = (signal?: AbortSignal) =>
			monitorsEntry.source({ data, entryType: type }, signal);
		resolve(abort.signal).then(
			(source) => {
				if (cancelled) return;
				monitorsUnavailable = source && "unavailable" in source ? source.unavailable : null;
				monitorsFor = type;
				resolvedFor = wanted;
				monitorsQuery.set(source && "fetch" in source ? source : null);
			},
			(error: unknown) => {
				if (cancelled) return;
				monitorsUnavailable = null;
				monitorsFor = type;
				resolvedFor = wanted;
				// The scope couldn't be resolved: keyed by widget (never by the places), and Retry
				// resolves it again before fetching.
				let failedOnce = false;
				monitorsQuery.set({
					key: `map-monitors:unresolved:${widget.id}`,
					cadence: "raw",
					fetch: async (signal) => {
						// The first fetch reports the failure that got us here; later ones try again.
						if (!failedOnce) {
							failedOnce = true;
							throw error;
						}
						const source = await resolve(signal);
						if (!source || "unavailable" in source) {
							monitorsUnavailable = source?.unavailable ?? null;
							return [];
						}
						return source.fetch(signal);
					}
				});
			}
		);
		return () => {
			cancelled = true;
			abort.abort();
		};
	});

	/**
	 * Whether the query is for the places and pollutant wanted now. After a change, until the new
	 * scope resolves, the old readings are neither drawn nor counted.
	 */
	const monitorsCurrent = $derived(resolvedFor === wantedKey);
	const monitorsState = $derived(monitorsQuery.state);
	const monitorsData = $derived(monitorsState.data);
	/** The monitors as map-sdk data; before they load, with no features but the scale. */
	const monitorsDrawn = $derived.by(() => {
		const type = monitorsCurrent ? (monitorsFor ?? entryType) : entryType;
		if (!type) return null;
		return monitorsEntry.toDataSources(monitorsData ?? [], {
			messages: mapMessages,
			entryType: type
		}).monitors;
	});
	/** One source for the monitors plugin, reading the query's current state. */
	const monitorsSource: DataSource<MonitorFeatureProperties> = {
		get status(): DataStatus {
			return monitorsCurrent ? dataStatus(monitorsState) : { state: "loading" };
		},
		get features() {
			return !monitorsCurrent || monitorsData === undefined
				? null
				: (monitorsDrawn?.features ?? null);
		},
		get scale() {
			return monitorsDrawn?.scale ?? null;
		}
	};
	/** Loading the monitors for the first time (the skeleton shows over the map). */
	const monitorsLoading = $derived(
		loads && !monitorsUnavailable && monitorsData === undefined && monitorsState.status !== "error"
	);
	/** A refresh failed: the earlier readings stay drawn, with a note and Retry. */
	const monitorsRefreshFailed = $derived(
		monitorsCurrent && monitorsState.status === "error" && monitorsData !== undefined
	);

	// Smoke and fire: today's, over the whole map, when on.
	const smokeAndFire = $derived(hasSmokeAndFire(widget.data));
	const hmsQuery = new NowQuery<HmsData>(nowClient);
	onDestroy(() => hmsQuery.destroy());

	$effect(() => {
		if (!loads || !smokeAndFire) {
			hmsQuery.set(null);
			return;
		}
		const input = untrack(() => ({
			data: $state.snapshot(widget.data),
			entryType: entryType ?? ""
		}));
		let cancelled = false;
		void hmsEntry.source(input).then((source) => {
			if (!cancelled) hmsQuery.set(source && "fetch" in source ? source : null);
		});
		return () => {
			cancelled = true;
		};
	});

	const hmsState = $derived(hmsQuery.state);
	/** Smoke and fire as map-sdk data; before they load, with no features but the scales. */
	const hmsDrawn = $derived(
		hmsEntry.toDataSources(hmsState.data ?? { smoke: [], fires: [] }, {
			messages: mapMessages,
			entryType: entryType ?? ""
		})
	);
	/** One source per smoke and fire plugin source, reading the query's current state. */
	function hmsSource<P extends FireFeatureProperties>(
		key: "smoke" | "fireGroups" | "fireHotspots"
	): DataSource<P> {
		return {
			get status() {
				return dataStatus(hmsState);
			},
			get features() {
				return hmsState.data === undefined
					? null
					: (hmsDrawn[key].features as DataSource<P>["features"]);
			},
			get scale() {
				return hmsDrawn[key].scale;
			}
		};
	}
	const smokeSource = hmsSource("smoke");
	const fireSource = hmsSource("fireGroups");
	const hotspotsSource = hmsSource("fireHotspots");
	const smokeLabel = $derived(datasetLabel(HMS_SMOKE));
	const fireLabel = $derived(datasetLabel(HMS_FIRE));
	const hmsFailed = $derived(hmsState.status === "error");

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

	/** A person's mark or unmark on the map, saved (a starter's edit goes to its copy). */
	function saveMarks(selection: SpatialSelection | null): void {
		const session = app.current.session;
		if (!session || session.readOnly) return;
		const current = session.doc.body.widgets.find((w) => w.id === widget.id);
		if (!current) return;
		const change = marksChange(current, selection?.kind === "monitors" ? selection.ids : []);
		if (change) session.apply(change);
	}

	// The plugins, added and removed as the layers change: smoke and fire under the monitors.
	$effect(() => {
		const current = map;
		const label = entryLabel;
		const selectionMode = markable ? "multiple" : "none";
		if (!current || !label || !loads) return;
		untrack(() =>
			current.addPlugin(
				monitorsPlugin({ source: monitorsSource, layerLabel: label, selectedStyle: "ring" }),
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
		const same =
			(shown?.ids.length ?? 0) === (selection?.ids.length ?? 0) &&
			(selection?.ids ?? []).every((id, i) => shown?.ids[i] === id);
		if (!same) current.setSelection("monitors", selection);
	});

	/** Under the monitors when they're on the map, else on top. */
	function underMonitors(current: MapContext): { before?: string } {
		return untrack(() => current.plugins.some((p) => p.id === "monitors"))
			? { before: "monitors" }
			: {};
	}

	$effect(() => {
		const current = map;
		const label = smokeLabel;
		if (!current || !label || !loads || !smokeAndFire) return;
		const plugin = hmsSmokePlugin({ source: smokeSource, layerLabel: label });
		untrack(() => current.addPlugin(plugin, underMonitors(current)));
		return () => current.removePlugin(plugin.id);
	});

	$effect(() => {
		const current = map;
		const label = fireLabel;
		if (!current || !label || !loads || !smokeAndFire) return;
		const plugin = hmsFirePlugin({
			source: fireSource,
			hotspots: hotspotsSource,
			layerLabel: label
		});
		untrack(() => current.addPlugin(plugin, underMonitors(current)));
		return () => current.removePlugin(plugin.id);
	});

	const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

	// The camera: fitted to the places on each change and on each (re-)attach, never saved.
	let body = $state<HTMLDivElement>();
	const positions = $derived(
		frame.frame?.focus === "monitor"
			? monitorPositions(monitorsSource.features, frame.frame.monitors)
			: new Map<string, [number, number]>()
	);
	const target = $derived(frame.frame ? fitTarget(frame.frame, frame.shapes, positions) : null);
	/**
	 * What was last fitted, and in which size (fullscreen or not), while attached. Reset on detach,
	 * so re-attaching refits; a style reload (ready false while still attached) keeps it, so the
	 * person's pan survives a basemap or theme change.
	 */
	let fitted: string | null = null;

	$effect(() => {
		const current = map;
		const t = target;
		const big = fullscreen;
		if (!current?.attached) {
			fitted = null;
			return;
		}
		if (!current.ready) return;
		// A null target leaves the camera where it is (the Valley's view on opening).
		if (!t) return;
		// Entering or leaving fullscreen refits too: the same map, in another size.
		const key = JSON.stringify([t, big]);
		if (key === fitted) return;
		fitted = key;
		const el = body;
		void (el ? ancestorAnimationsSettled(el) : Promise.resolve()).then(async () => {
			// MapLibre takes its container's new size in a ResizeObserver, which runs after the
			// next frame's animation callbacks: fit after that, at the size the map now has.
			await nextFrame();
			await nextFrame();
			if (fitted !== key || !current.ready) return;
			if ("bbox" in t) {
				const [west, south, east, north] = t.bbox;
				current.fitBounds({ west, south, east, north }, { padding: FIT_PADDING });
			} else {
				current.easeTo({ center: t.center, minZoom: t.minZoom });
			}
		});
	});

	const onScreen = new OnScreen(() => body, { activity: app.platform.activity });
	onDestroy(() => onScreen.destroy());
	// Live data polls only while the map is worth drawing (on screen, the page visible).
	$effect(() => {
		const on = onScreen.active;
		monitorsQuery.setPolling(on);
		hmsQuery.setPolling(on);
	});

	// The title: the one place's label (from the "now" lookup), or how many places.
	const titleQuery = new LiveQuery(getQueryClient(), null);
	titleQuery.setPolling(false);
	onDestroy(() => titleQuery.destroy());
	const count = $derived(layer?.selection?.ids.length ?? (layer?.place ? 1 : 0));
	$effect(() => {
		titleQuery.set(!idle && supported && count === 1 ? nowInput(layer) : null);
	});
	$effect(() => {
		const label = entryLabel;
		if (!label || idle) return;
		if (count > 1) {
			const places = m.get_data_places_count({ count: formatNumber(count), countValue: count });
			setGeneratedTitle(widget.id, m.label_join({ first: label, second: places }));
			return;
		}
		const s = titleQuery.state;
		const place = s.status === "ready" ? s.data.places[0] : undefined;
		if (place) {
			setGeneratedTitle(
				widget.id,
				m.label_join({ first: label, second: placeLabel(place, viewer) })
			);
		}
	});
	const title = $derived(widget.title ?? generatedTitle(widget.id));

	/** The marked monitors not drawn now; none until the monitors for now have loaded. */
	const hidden = $derived.by(() => {
		const features = monitorsSource.features;
		return features ? hiddenMarks(marks, monitorIds(features)) : [];
	});
	const hiddenCount = $derived({ count: formatNumber(hidden.length), countValue: hidden.length });
	/** The map's accessible name, which also says how many marks aren't shown. */
	const mapLabel = $derived(
		!title
			? undefined
			: hidden.length
				? m.map_label_marks_hidden({ title, ...hiddenCount })
				: m.map_label({ title })
	);

	/** A monitor place the loaded readings don't list (retired, say): the map still draws. */
	const unlisted = $derived.by(() => {
		const place = layer?.place;
		if (!monitorsCurrent || monitorsState.status !== "ready" || place?.kind !== "monitor") {
			return false;
		}
		return !monitorsState.data.some((reading) => reading.id === place.id);
	});
	/** Why the places can't all be shown, over a map that still draws. */
	const note = $derived.by<QueryState | null>(() => {
		const s = frame.state;
		if (typeof s === "object" && "unavailable" in s) {
			return { status: "unavailable", reason: s.unavailable };
		}
		if (monitorsCurrent && monitorsUnavailable)
			return { status: "unavailable", reason: monitorsUnavailable };
		return unlisted ? { status: "unavailable", reason: "monitor-unlisted" } : null;
	});
	/** The places are scoped and loaded, but no monitor there reports the pollutant showing. */
	const noMonitors = $derived(
		!note &&
			monitorsCurrent &&
			monitorsState.status === "ready" &&
			(monitorsDrawn?.features?.features.length ?? 0) === 0
	);

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
		if (monitorsState.status === "error" && monitorsData === undefined) {
			return { status: "error", error: monitorsState.error };
		}
		return null;
	});

	function retry(): void {
		if (pollutants === "unavailable") loadPollutants();
		else if (mapError) retryMap();
		else if (typeof frame.state === "object" && "error" in frame.state) frame.retry();
		else if (monitorsState.status === "error") monitorsQuery.retry();
	}

	let width = $state(0);
	const narrow = $derived(width > 0 && width < NARROW_PX);
	let legendOpen = $state(false);
</script>

{#snippet nothing()}{/snippet}

{#snippet cardActions(ctx: CardContext)}
	{#if ctx.selectable}
		<Button size="sm" variant="outline" onclick={() => ctx.toggle()}>
			{ctx.selected ? m.map_mark_remove() : m.map_mark_select()}
		</Button>
	{/if}
{/snippet}

{#snippet overlays()}
	{#if map}
		<div
			class="pointer-events-none absolute bottom-2 left-2 flex max-w-[calc(100%-1rem)] flex-col items-start gap-1"
		>
			{#if narrow}
				<Button
					size="sm"
					variant="outline"
					class="pointer-events-auto"
					aria-expanded={legendOpen}
					onclick={() => (legendOpen = !legendOpen)}
				>
					{m.map_legend_toggle()}
				</Button>
			{/if}
			{#if !narrow || legendOpen}
				<div
					class="bg-card text-card-foreground border-border shadow-card pointer-events-auto max-w-72 rounded-(--radius-control) border p-2 text-xs"
				>
					<Legend {map} framed={false} />
				</div>
			{/if}
		</div>
	{/if}
{/snippet}

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
					featureList={{ reveal: "focus" }}
					selectionBar={false}
					tooltip="pointer"
					card={{ actions: cardActions }}
					{overlays}
				/>
			</svelte:boundary>
			<p
				class={["text-muted-foreground text-xs", hidden.length && "px-2 pt-1"]}
				role="status"
				data-map-marks-hidden
			>
				{hidden.length ? m.map_marks_hidden(hiddenCount) : ""}
			</p>
		</div>
		{#if !map.ready || monitorsLoading}
			<div class="bg-card absolute inset-0 p-2">
				<WidgetSkeleton />
			</div>
		{/if}
		{#if note || noMonitors || monitorsRefreshFailed || hmsFailed}
			<!-- A compact banner over the map's top: the map stays usable, but for its buttons. -->
			<div
				class="pointer-events-none absolute inset-x-0 top-0 flex flex-col gap-1 p-2"
				data-map-note
			>
				{#if note}
					<div
						class="bg-card text-card-foreground border-border shadow-card mx-auto max-w-96 rounded-(--radius-control) border px-3 py-2 [&_button]:pointer-events-auto"
					>
						<WidgetState
							state={note}
							{widget}
							onretry={retry}
							onchoose={() => openPlacePicker({ widgetId: widget.id })}
							children={nothing}
						/>
					</div>
				{:else if noMonitors}
					<p
						class="bg-card text-muted-foreground border-border shadow-card mx-auto max-w-96 rounded-(--radius-control) border px-3 py-2 text-center text-sm"
						role="status"
					>
						{m.map_no_monitors_here()}
					</p>
				{/if}
				{#if monitorsRefreshFailed}
					<div
						class="bg-card text-card-foreground border-border shadow-card mx-auto flex max-w-96 items-center gap-2 rounded-(--radius-control) border px-3 py-2 text-sm"
						role="status"
						data-map-refresh-note
					>
						<p class="text-muted-foreground">{m.map_refresh_failed()}</p>
						<Button
							size="sm"
							variant="outline"
							class="pointer-events-auto"
							onclick={() => monitorsQuery.retry()}
						>
							{m.widget_state_retry()}
						</Button>
					</div>
				{/if}
				{#if hmsFailed}
					<div
						class="bg-card text-card-foreground border-border shadow-card mx-auto flex max-w-96 items-center gap-2 rounded-(--radius-control) border px-3 py-2 text-sm"
						role="status"
						data-map-hms-note
					>
						<p class="text-muted-foreground">{m.map_smoke_fire_failed()}</p>
						<Button
							size="sm"
							variant="outline"
							class="pointer-events-auto"
							onclick={() => hmsQuery.retry()}
						>
							{m.widget_state_retry()}
						</Button>
					</div>
				{/if}
			</div>
		{/if}
	{/if}
</div>
