import { onDestroy, untrack } from "svelte";
import { getMetadata, getQueryClient } from "$lib/data";
import { LiveQuery } from "$lib/data/live-query.svelte";
import { getNowClient } from "$lib/data/now";
import { alertReading, alertSource, type AlertConfig, type AlertRecord } from "$lib/data/now/alert";
import { hourlyReading, type CurrentReading } from "$lib/data/now/current";
import { NowQuery } from "$lib/data/now/now-query.svelte";
import type { CatalogEntry, Level } from "$lib/data/metadata";
import type { QueryState, UnavailableReason } from "$lib/data/types";
import type { WidgetInstance } from "$lib/documents/schema";
import { entryMeta, mainLayer, nowInput } from "./input";

type Levels = Level[] | { error: unknown } | undefined;

/** A monitor the server evaluates alerts for: what its alert value needs. */
type AlertMode = { monitorId: string; entryType: string; config: AlertConfig; name: string };

/**
 * The current reading of a widget's first layer's place, with its levels. Used by the two "now"
 * tiles and the threshold watcher. Call during component initialization (it registers effects and
 * cleanup). Polling follows `!widget().minimized` unless `opts.polling` says otherwise.
 *
 * A monitor whose type the server evaluates alerts for reads the server's alert value (a 60-minute
 * average, or the latest reading of an hourly feed); every other place, and a monitor whose
 * alert result has no entry for the pollutant, reads the latest complete hour. The hourly
 * query always runs: it supplies the place, the unavailable states and the fallback.
 */
export class CurrentConditions {
	#levels = $state.raw<Levels>();
	#levelsTry = $state(0);
	readonly #query: LiveQuery;
	readonly #alertQuery: NowQuery<AlertRecord>;

	readonly levels: Level[];
	/** The catalog entry (and dataset) the widget reads, once the catalog has loaded. */
	readonly meta: ReturnType<typeof entryMeta>;
	/** The query's state, held as loading until the levels are in, or an error if they failed. */
	readonly shown: QueryState;
	readonly state: "loading" | "ready" | "error" | { unavailable: UnavailableReason };
	readonly reading: CurrentReading | undefined;

	constructor(widget: () => WidgetInstance, opts?: { polling?: () => boolean }) {
		const metadata = getMetadata();
		// A local, not a class field: the compiler reads a field untracked in the constructor's
		// `const … = $derived(…)`, so the layer and `meta` would never see the catalog arrive.
		let catalog = $state.raw<CatalogEntry[] | undefined>();
		void metadata.catalog().then((c) => {
			if (c !== "unavailable") catalog = c;
		});

		const layer = $derived(mainLayer(widget().data, catalog));
		const input = $derived(nowInput(layer));
		const meta = $derived(entryMeta(catalog, layer));
		const entryTypeId = $derived(layer?.entryType);

		const query = new LiveQuery(
			getQueryClient(),
			untrack(() => input)
		);
		this.#query = query;
		$effect(() => query.set(input));
		const polling = () => (opts?.polling ? opts.polling() : !widget().minimized);
		$effect(() => query.setPolling(polling()));
		onDestroy(() => query.destroy());

		// `undefined` while the monitor's type and alert config are being looked up; `null` when
		// the place is not a monitor the server evaluates for this pollutant.
		let alertMode = $state.raw<AlertMode | null | undefined>();
		const monitorId = $derived(layer?.place?.kind === "monitor" ? layer.place.id : undefined);
		$effect(() => {
			const id = monitorId;
			const entryType = entryTypeId;
			if (!id || !entryType) {
				alertMode = null;
				return;
			}
			alertMode = undefined;
			const abort = new AbortController();
			const { signal } = abort;
			void (async () => {
				const type = await metadata.monitorType(id, signal);
				const config = type ? await metadata.alertConfig(type, entryType, signal) : null;
				if (!config) return null;
				const name = (await metadata.monitors(signal)).find((mon) => mon.id === id)?.name ?? id;
				return { monitorId: id, entryType, config, name };
			})().then(
				(mode) => {
					if (!signal.aborted) alertMode = mode;
				},
				// A lookup that fails reads the hourly average, as for a monitor with no config.
				() => {
					if (!signal.aborted) alertMode = null;
				}
			);
			return () => abort.abort();
		});
		const alertQuery = new NowQuery<AlertRecord>(getNowClient());
		this.#alertQuery = alertQuery;
		$effect(() => alertQuery.set(alertMode ? alertSource(alertMode.monitorId) : null));
		$effect(() => alertQuery.setPolling(polling()));
		onDestroy(() => alertQuery.destroy());
		// The alert result, when it is the answer: a stale one stays while a refetch runs or fails.
		const alertRecord = $derived(alertMode ? alertQuery.state.data : undefined);
		/** The alert value is still on its way, so the tile is held as loading. */
		const alertPending = $derived.by(() => {
			if (alertMode === undefined) return true;
			if (alertMode === null || alertRecord) return false;
			const status = alertQuery.state.status;
			return status === "idle" || status === "loading";
		});

		/**
		 * The alert entry the tile reads, when it is the answer: a monitor the server evaluates, whose
		 * alert result has an entry for the pollutant, with the levels in and a place that is not
		 * unavailable. `reading`, `shown` and `state` all follow it, so the tile shows (and the
		 * watcher fires on) one value, whatever state the hourly query is in.
		 */
		const alertUsable = $derived.by(() => {
			const mode = alertMode;
			const entry = mode ? alertRecord?.[mode.entryType] : undefined;
			if (!mode || !entry || !Array.isArray(this.#levels)) return undefined;
			if (query.state.status === "unavailable" || query.state.status === "idle") return undefined;
			return { mode, entry, levels: this.#levels };
		});

		$effect(() => {
			const id = entryTypeId;
			void this.#levelsTry;
			if (!id) return;
			const abort = new AbortController();
			this.#levels = undefined;
			metadata.levels(id, abort.signal).then(
				(l) => (this.#levels = l),
				(error: unknown) => {
					if (!abort.signal.aborted) this.#levels = { error };
				}
			);
			return () => abort.abort();
		});

		this.levels = $derived(Array.isArray(this.#levels) ? this.#levels : []);

		this.meta = $derived(meta);
		this.shown = $derived.by((): QueryState => {
			const s = query.state;
			const usable = alertUsable;
			if (usable) {
				if (s.status === "ready") return s;
				return {
					status: "ready",
					data: (s.status === "loading" || s.status === "error" ? s.data : undefined) ?? {
						series: [],
						places: [{ place: `monitor:${usable.mode.monitorId}`, name: usable.mode.name }],
						resolution: "hour",
						fromRaw: false,
						processor: null,
						fetchedAt: 0
					}
				};
			}
			if (s.status === "ready" && alertPending) return { status: "loading", data: s.data };
			if (s.status !== "ready" && s.status !== "error") return s;
			const levels = this.#levels;
			if (levels === undefined) return { status: "loading", data: s.data };
			if (!Array.isArray(levels) && s.status === "ready") {
				return { status: "error", error: levels.error, data: s.data };
			}
			return s;
		});
		this.state = $derived.by(() => {
			const s = query.state;
			if (s.status === "unavailable") return { unavailable: s.reason };
			if (alertUsable) return "ready";
			if (s.status === "error") return "error";
			if (this.#levels && !Array.isArray(this.#levels)) return "error";
			if (s.status === "ready" && Array.isArray(this.#levels) && !alertPending) return "ready";
			return "loading";
		});

		this.reading = $derived.by(() => {
			const s = query.state;
			const levels = this.#levels;
			const precision = meta?.entryType.precision ?? null;
			const usable = alertUsable;
			if (usable) {
				const place = (s.status === "unavailable" || s.status === "idle" ? undefined : s.data)
					?.places[0] ?? { place: `monitor:${usable.mode.monitorId}`, name: usable.mode.name };
				return alertReading(usable.entry, usable.levels, usable.mode.config, place, precision);
			}
			if (alertPending) return undefined;
			if (s.status !== "ready" || !Array.isArray(levels)) return undefined;
			// A plain Date: the reading re-derives on each poll, which is when staleness can change.
			// eslint-disable-next-line svelte/prefer-svelte-reactivity
			return hourlyReading(s.data, levels, new Date(), precision);
		});
	}

	retry = (): void => {
		if (this.#levels && !Array.isArray(this.#levels)) this.#levelsTry++;
		this.#query.retry();
		this.#alertQuery.retry();
	};
}
