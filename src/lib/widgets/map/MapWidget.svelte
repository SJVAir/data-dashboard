<script lang="ts">
	import { getContext, onDestroy, untrack } from "svelte";
	import {
		createMap,
		Legend,
		MapView,
		monitorsPlugin,
		pointsPlugin,
		shapesPlugin,
		type MapContext
	} from "@sjvair/map-sdk";
	import type { SpatialSelection } from "@sjvair/map-sdk/data";
	import type { MonitorsStore } from "@sjvair/map-sdk/stores";
	import { ancestorAnimationsSettled } from "$lib/charts/settled";
	import { openPlacePicker } from "$lib/components/dialogs/lazy.svelte";
	import { Button } from "$lib/components/ui/button";
	import { getMetadata, getQueryClient } from "$lib/data";
	import { LiveQuery } from "$lib/data/live-query.svelte";
	import type { CatalogEntry } from "$lib/data/metadata";
	import type { QueryState, UnavailableReason } from "$lib/data/types";
	import type { WidgetInstance } from "$lib/documents/schema";
	import { formatNumber } from "$lib/format";
	import { m } from "$lib/paraglide/messages.js";
	import { useApp } from "$lib/store/app.svelte";
	import { entryMeta, nowInput, placesLayer } from "../shared/input";
	import { PLACE_VIEWER_KEY, type PlaceViewer } from "../shared/viewer";
	import WidgetSkeleton from "../shared/WidgetSkeleton.svelte";
	import WidgetState from "../shared/WidgetState.svelte";
	import { placeLabel } from "../title";
	import { generatedTitle, setGeneratedTitle } from "../titles.svelte";
	import { MapFrame } from "./frame.svelte";
	import { fitTarget } from "./framing";
	import { mapConfig } from "./host/config";
	import { mapFormat } from "./host/format";
	import { mapMessages } from "./host/messages";
	import { acquireMonitors, sharedMetadata } from "./host/stores";
	import { OnScreen } from "./on-screen.svelte";
	import { pinLabel as showPinLabel } from "./pin-label.svelte";
	import { regionKey } from "./regions";
	import { featureSource, monitorPositions, pinFeatures, pinIcon, shapeFeatures } from "./sources";

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
	/** The pollutants the server puts on its map (`available_pollutants`); `[]` if unknown. */
	let pollutants = $state.raw<string[] | undefined>();
	metadata.mapPollutants().then(
		(p) => (pollutants = p),
		() => (pollutants = [])
	);

	const known = $derived(Array.isArray(catalog) ? catalog : undefined);
	const layer = $derived(placesLayer(widget.data, known));
	const entryType = $derived(layer?.entryType);
	const entryLabel = $derived(entryMeta(known, layer)?.entryType.label);
	const idle = $derived(
		!layer || (!layer.place && !layer.selection) || layer.place?.kind === "default-place"
	);
	/**
	 * Whether the map can show the layer's pollutant. One the server's map doesn't offer is never
	 * drawn: map-sdk's store would silently swap it for its default under this layer's title.
	 */
	const support = $derived.by<"loading" | "ok" | UnavailableReason>(() => {
		if (catalog === "unavailable") return "catalog-unavailable";
		if (catalog === undefined || pollutants === undefined) return "loading";
		if (!entryType || !entryLabel || !pollutants.includes(entryType)) return "unknown-entry-type";
		return "ok";
	});
	const supported = $derived(support === "ok");

	const frame = new MapFrame(() => layer);
	onDestroy(() => frame.destroy());

	// The map: made once per mount (again after "Retry" when making it failed).
	let map = $state.raw<MapContext | null>(null);
	let mapError = $state.raw<{ error: unknown } | null>(null);
	let mapTries = $state(0);

	const placesFeatures = $derived(shapeFeatures(frame.shapes));
	const placesSource = featureSource(() => placesFeatures);
	const pin = $derived(frame.frame?.pin ?? null);
	const pinLabel = $derived(
		pin?.kind === "location"
			? pin.name
			: viewer === "shared"
				? m.map_pin_shared_location()
				: m.map_pin_your_location()
	);
	const pinCollection = $derived(pinFeatures(pin, pinLabel));
	const pinSource = featureSource(() => pinCollection);
	// Its visible text label (the shape and this text mark it, not color alone).
	showPinLabel(
		() => map,
		() => (pin ? { lngLat: [pin.lon, pin.lat], text: pinLabel } : null)
	);

	$effect(() => {
		void mapTries;
		if (!config || !supported) return;
		const made = untrack(() => {
			try {
				const created = createMap({
					config,
					metadata: sharedMetadata(),
					messages: mapMessages,
					format: mapFormat
				});
				created.addPlugin(
					shapesPlugin({
						id: "places",
						source: placesSource,
						layerLabel: m.map_layer_places(),
						mode: "plain",
						listed: false,
						selectable: false,
						hoverable: false
					})
				);
				created.addPlugin(
					pointsPlugin({
						id: "pin",
						source: pinSource,
						layerLabel: m.map_layer_places(),
						selectable: false,
						icon: pinIcon
					})
				);
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

	const monitorSelection = $derived<SpatialSelection | null>(
		frame.frame?.monitors.length ? { kind: "monitors", ids: frame.frame.monitors } : null
	);
	const regionSelection = $derived<SpatialSelection | null>(
		frame.frame?.regions.length
			? { kind: "regions", ids: frame.frame.regions.map(regionKey) }
			: null
	);

	// The page's shared store for the pollutant, under the outlines and the pin.
	let store = $state.raw<MonitorsStore | null>(null);
	let storeState = $state.raw<"loading" | "ready" | { error: unknown }>("loading");
	let storeTries = $state(0);

	$effect(() => {
		const current = map;
		const type = entryType;
		const label = entryLabel;
		if (!current || !type || !label || !supported) return;
		const held = acquireMonitors(type, app.platform.activity);
		untrack(() =>
			current.addPlugin(
				monitorsPlugin({ source: held.store.dataSource, layerLabel: label, selectedStyle: "ring" }),
				{ before: "pin", selectionMode: "none", selection: monitorSelection }
			)
		);
		store = held.store;
		return () => {
			current.removePlugin("monitors");
			held.release();
			store = null;
		};
	});

	$effect(() => {
		const current = store;
		const type = entryType;
		void storeTries;
		if (!current || !type) return;
		let live = true;
		if (!current.initialized) storeState = "loading";
		// Joins the store's shared run. Polling starts when a run finishes, so a run that ends
		// while the page is hidden (a retry, say) pauses it again.
		current.init(type).then(
			() => {
				if (!live) return;
				storeState = "ready";
				if (!app.platform.activity.visible()) current.pauseAutoUpdate();
			},
			(error: unknown) => {
				if (live) storeState = { error };
			}
		);
		return () => {
			live = false;
		};
	});

	$effect(() => {
		const current = map;
		if (!current) return;
		current.setSelection("monitors", monitorSelection);
		current.setSelection("places", regionSelection);
	});

	const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

	// The camera: fitted to the places on each change and on each (re-)attach, never saved.
	let body = $state<HTMLDivElement>();
	const positions = $derived(
		store && frame.frame?.focus === "monitor"
			? monitorPositions(store.dataSource.features, frame.frame.monitors)
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

	/** A monitor place the loaded store doesn't list (retired, say): the map still draws. */
	const unlisted = $derived(
		storeState === "ready" &&
			!!store &&
			layer?.place?.kind === "monitor" &&
			!store.monitors.has(layer.place.id)
	);
	/** Why the places can't all be shown, over a map that still draws. */
	const note = $derived.by<QueryState | null>(() => {
		const s = frame.state;
		if (typeof s === "object" && "unavailable" in s) {
			return { status: "unavailable", reason: s.unavailable };
		}
		return unlisted ? { status: "unavailable", reason: "monitor-unlisted" } : null;
	});

	/** What the widget shows instead of the map, if anything. */
	const instead = $derived.by<QueryState | null>(() => {
		if (idle) return { status: "idle" };
		if (support === "loading") return { status: "loading" };
		if (support !== "ok") return { status: "unavailable", reason: support };
		if (mapError) return { status: "error", error: mapError.error };
		const s = frame.state;
		if (typeof s === "object" && "error" in s) return { status: "error", error: s.error };
		if (typeof storeState === "object") return { status: "error", error: storeState.error };
		return null;
	});

	function retry(): void {
		if (mapError) retryMap();
		else if (typeof frame.state === "object" && "error" in frame.state) frame.retry();
		else if (typeof storeState === "object") storeTries++;
	}

	let width = $state(0);
	const narrow = $derived(width > 0 && width < NARROW_PX);
	let legendOpen = $state(false);
</script>

{#snippet nothing()}{/snippet}

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
		<svelte:boundary onerror={(error) => (mapError = { error })}>
			<MapView
				{map}
				class="h-full w-full"
				active={onScreen.active}
				label={title ? m.map_label({ title }) : undefined}
				featureList={{ reveal: "focus" }}
				selectionBar={false}
				tooltip="pointer"
				{overlays}
			/>
		</svelte:boundary>
		{#if !map.ready}
			<div class="bg-card absolute inset-0 p-2">
				<WidgetSkeleton />
			</div>
		{/if}
		{#if note}
			<div class="pointer-events-none absolute inset-0 flex items-center justify-center p-4">
				<div
					class="bg-card text-card-foreground border-border shadow-card pointer-events-auto max-w-80 rounded-(--radius-control) border p-3"
				>
					<WidgetState
						state={note}
						{widget}
						onretry={retry}
						onchoose={() => openPlacePicker({ widgetId: widget.id })}
						children={nothing}
					/>
				</div>
			</div>
		{/if}
	{/if}
</div>
