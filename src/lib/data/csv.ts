import { TZDate } from "@date-fns/tz";
import { toast } from "svelte-sonner";
import { SvelteMap } from "svelte/reactivity";
import { formatList, TIME_ZONE } from "$lib/format";
import { nextPeriodStart, resolveRange } from "$lib/format/range";
import type { WidgetInstance } from "$lib/documents/schema";
import type { CatalogEntry, Level } from "./metadata";
import type { WidgetDataConfig } from "./schema";
import { m } from "$lib/paraglide/messages.js";
import type { FileAccess } from "$lib/platform/types";
import { dataFileName } from "$lib/sharing/file-names";
import { report } from "$lib/safety/report";
import type { PlaceViewer } from "$lib/widgets/shared/viewer";
import { placeLabel } from "$lib/widgets/title";
import { chartInput, entryMeta } from "$lib/widgets/shared/input";
import { overlayInput, overlayLayers } from "$lib/widgets/shared/overlays";
import { getMetadata, getQueryClient } from "./index";
import { LIMITS } from "./schema";
import type { Subscription } from "./query/client";
import {
	byPlaceOrder,
	type PlaceInfo,
	type QueryData,
	type QueryInput,
	type QueryState
} from "./types";

export const CSV_COLUMNS = [
	"period_start",
	"period_end",
	"place_kind",
	"place_id",
	"place_name",
	"entry_type",
	"entry_type_label",
	"unit",
	"mean",
	"min",
	"max",
	"worst_hour_mean",
	"worst_hour_start",
	"count",
	"resolution",
	"partial",
	"computed_from_raw",
	"level_key",
	"level_label"
] as const;

/** What the entry type contributes to every row. */
type EntryInfo = { entryType: string; entryLabel: string; unit: string };

/** A Pacific time with its offset: `2026-10-25T00:00:00-07:00`. */
function pacificIso(t: number): string {
	// Built from the fields rather than with date-fns' `format`, whose bundled warning text names
	// a host the build output check refuses.
	const d = new TZDate(t, TIME_ZONE);
	const pad = (n: number, width = 2) => String(n).padStart(width, "0");
	const date = `${pad(d.getFullYear(), 4)}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
	const time = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
	const offset = -d.getTimezoneOffset();
	const zone =
		offset === 0
			? "Z"
			: `${offset > 0 ? "+" : "-"}${pad(Math.floor(Math.abs(offset) / 60))}:${pad(Math.abs(offset) % 60)}`;
	return `${date}T${time}${zone}`;
}

/** A number as plain decimal text: `.` decimal, no grouping, never exponent notation. */
function plain(n: number): string {
	if (!Number.isFinite(n)) return "";
	return n.toLocaleString("en-US", { useGrouping: false, maximumFractionDigits: 20 });
}

function cell(value: string): string {
	return /[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

/** "monitor:<id>" or "region:<type>:<code>" as a kind and an id. */
function placeParts(key: string): { kind: string; id: string } {
	const i = key.indexOf(":");
	return { kind: key.slice(0, i), id: key.slice(i + 1) };
}

/** An overlay's data, its entry type, and the labels of its scale levels. */
export type OverlayCsv = { data: QueryData; meta: EntryInfo; levels: Level[] };

/**
 * One data set's rows, places in request order, oldest first. `placeAt` names the place a series
 * is reported as (the series' own, unless the caller pairs it with a main place).
 */
function dataRows(
	data: QueryData,
	meta: EntryInfo,
	levels: Level[],
	placeAt: (series: QueryData["series"][number], index: number) => PlaceInfo | undefined,
	viewer: PlaceViewer
): string[] {
	const order = new Map(data.places.map((p, i) => [p.place, i]));
	const series = [...data.series].sort(byPlaceOrder(order));
	const lines: string[] = [];
	for (const s of series) {
		const info = placeAt(s, order.get(s.place) ?? -1);
		const { kind, id } = placeParts(info?.place ?? s.place);
		const name = info ? placeLabel(info, viewer) : "";
		for (const p of [...s.points].sort((a, b) => a.t - b.t)) {
			const end =
				data.resolution === "raw" ? p.t : nextPeriodStart(new Date(p.t), data.resolution).getTime();
			const row = [
				pacificIso(p.t),
				pacificIso(end),
				kind,
				id,
				name,
				meta.entryType,
				meta.entryLabel,
				meta.unit,
				plain(p.mean),
				plain(p.min),
				plain(p.max),
				p.worstHour ? plain(p.worstHour.value) : "",
				p.worstHour ? pacificIso(p.worstHour.t) : "",
				Number.isFinite(p.count) ? String(p.count) : "",
				data.resolution,
				String(p.partial),
				String(data.fromRaw),
				p.level ?? "",
				p.level ? (levels.find((l) => l.key === p.level)?.label ?? "") : ""
			];
			lines.push(row.map(cell).join(","));
		}
	}
	return lines;
}

/**
 * The data as CSV (RFC 4180, CRLF line ends, no comment lines): one row per place and period,
 * places in request order, oldest first. Numbers are plain (`.` decimal, no grouping) and a
 * missing value (or NaN) is empty. A raw reading's period ends where it starts. Each overlay's
 * rows follow the main rows, in the same long format with its own entry type; an overlay's
 * places pair with the main's by request index (a point's region can differ by dataset) and
 * carry the main place's columns.
 */
export function toCsv(
	data: QueryData,
	meta: EntryInfo,
	viewer: PlaceViewer = "owner",
	overlays: OverlayCsv[] = []
): string {
	const own = new Map(data.places.map((p) => [p.place, p]));
	const lines: string[] = [
		CSV_COLUMNS.join(","),
		...dataRows(data, meta, [], (s) => own.get(s.place), viewer)
	];
	for (const o of overlays) {
		lines.push(
			...dataRows(o.data, o.meta, o.levels, (s, i) => data.places[i] ?? o.data.places[i], viewer)
		);
	}
	return `${lines.join("\r\n")}\r\n`;
}

/** Subscribes once with polling off and resolves with the first settled state. */
function firstSettled(input: QueryInput): Promise<QueryState> {
	return new Promise<QueryState>((resolve) => {
		let done = false;
		const held: { sub?: Subscription } = {};
		const sub = getQueryClient().subscribe(input, (s) => {
			if (done || (s.status !== "ready" && s.status !== "error" && s.status !== "unavailable")) {
				return;
			}
			done = true;
			// A synchronous first delivery arrives before `sub` is assigned.
			queueMicrotask(() => held.sub?.unsubscribe());
			resolve(s);
		});
		held.sub = sub;
		sub.setPolling(false);
	});
}

/**
 * One overlay's data, or `null` when it couldn't be loaded (an error, or unavailable). A ready
 * overlay with no points is not a failure: it just adds no rows.
 */
async function loadOverlay(
	main: QueryInput,
	layer: WidgetDataConfig["layers"][number],
	catalog: CatalogEntry[]
): Promise<OverlayCsv | null> {
	try {
		const info = entryMeta(catalog, layer);
		if (!info) return null;
		const state = await firstSettled(overlayInput(main, layer));
		if (state.status === "error") throw state.error;
		if (state.status !== "ready") return null;
		const levels = await getMetadata().datasetLevels(layer.dataset, info.entryType.id);
		return {
			data: state.data,
			levels,
			meta: {
				entryType: info.entryType.id,
				entryLabel: info.entryType.label,
				unit: info.entryType.units
			}
		};
	} catch (error) {
		report(error);
		return null;
	}
}

/** What a download left out: the entry labels of overlays that couldn't be loaded. */
export type CsvResult = { skipped: string[] };

/**
 * Runs the data config's query once (no polling), with every place of its selection (not only
 * the ones it has room to show), plus each overlay's, then saves it as CSV through the
 * platform. The file name's dates are the range as of when the data was fetched. A failed or
 * unavailable overlay is left out (named in `skipped`); the main rows still export. Throws if there is nothing to download
 * or the main data can't be loaded.
 */
export async function downloadDataCsv(
	config: WidgetDataConfig,
	save: FileAccess["save"],
	viewer: PlaceViewer = "owner"
): Promise<CsvResult> {
	const catalog = await getMetadata().catalog();
	if (catalog === "unavailable") throw new Error("The catalog is unavailable");
	const { layer, input } = chartInput(config, catalog, LIMITS.SELECTION_MAX);
	const info = entryMeta(catalog, layer);
	if (!input || !info) throw new Error("There is no data to download");
	const state = await firstSettled(input);
	if (state.status === "error") throw state.error;
	if (state.status !== "ready") throw new Error(`The data is unavailable (${state.status})`);
	const meta: EntryInfo = {
		entryType: info.entryType.id,
		entryLabel: info.entryType.label,
		unit: info.entryType.units
	};
	const { data } = state;
	const layers = overlayLayers(config, catalog);
	const loaded = await Promise.all(layers.map((l) => loadOverlay(input, l, catalog)));
	const overlays = loaded.filter((o): o is OverlayCsv => o !== null);
	const skipped = layers.flatMap((l, i) =>
		loaded[i] ? [] : [entryMeta(catalog, l)?.entryType.label ?? l.entryType ?? l.dataset]
	);
	const range = resolveRange(input.dateRange, new Date(data.fetchedAt));
	const fileLabel =
		data.places.length === 1
			? placeLabel(data.places[0], viewer)
			: m.file_places({ count: String(data.places.length) });
	save(
		dataFileName({
			entryLabel: meta.entryLabel,
			placeLabel: fileLabel,
			firstDate: range.firstDate,
			lastDate: range.lastDate
		}),
		toCsv(data, meta, viewer, overlays),
		"text/csv"
	);
	return { skipped };
}

/** `downloadDataCsv` for a widget's data. */
export function downloadWidgetCsv(
	widget: WidgetInstance,
	save: FileAccess["save"],
	viewer: PlaceViewer = "owner"
): Promise<CsvResult> {
	return downloadDataCsv(widget.data, save, viewer);
}

/** Downloads in progress, by key (a widget id, or `"get-data"` for the draft). */
const pending = new SvelteMap<string, Promise<void>>();

/** Whether the key's CSV is being prepared (reactive). */
export function csvPending(key: string): boolean {
	return pending.has(key);
}

/**
 * `downloadDataCsv` for the UI: a toast says the data is being prepared, and a failure is
 * reported and shown as a toast. While one is in progress for the key, another call returns
 * that one, so a double click saves once.
 */
export function saveDataCsv(
	key: string,
	data: WidgetDataConfig,
	save: FileAccess["save"],
	viewer: PlaceViewer = "owner"
): Promise<void> {
	const running = pending.get(key);
	if (running) return running;
	const job = downloadDataCsv(data, save, viewer);
	toast.promise(job, {
		loading: m.widget_download_csv_pending(),
		error: (error: unknown) => {
			report(error);
			return m.widget_download_csv_failed();
		}
	});
	const done = job
		.then(({ skipped }) => {
			if (skipped.length) {
				toast.warning(m.download_csv_skipped({ layers: formatList(skipped) }));
			}
		})
		.catch(() => {})
		.finally(() => {
			if (pending.get(key) === done) pending.delete(key);
		});
	pending.set(key, done);
	return done;
}

/** `saveDataCsv` keyed by the widget's id. */
export function saveWidgetCsv(
	widget: WidgetInstance,
	save: FileAccess["save"],
	viewer: PlaceViewer = "owner"
): Promise<void> {
	return saveDataCsv(widget.id, widget.data, save, viewer);
}
