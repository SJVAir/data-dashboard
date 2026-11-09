import { TZDate } from "@date-fns/tz";
import { toast } from "svelte-sonner";
import { SvelteMap } from "svelte/reactivity";
import { formatList, TIME_ZONE } from "$lib/format";
import { nextPeriodStart, resolveRange } from "$lib/format/range";
import type { WidgetInstance } from "$lib/documents/schema";
import type { CatalogEntry, Level } from "./metadata";
import type { Resolution, WidgetDataConfig } from "./schema";
import { m } from "$lib/paraglide/messages.js";
import type { FileAccess } from "$lib/platform/types";
import { dataFileName } from "$lib/sharing/file-names";
import { report } from "$lib/safety/report";
import type { PlaceViewer } from "$lib/widgets/shared/viewer";
import { placeLabel } from "$lib/widgets/title";
import { calendarInput } from "$lib/calendars/input";
import { figureName } from "$lib/calendars/figure";
import { isCalendarType } from "$lib/calendars/types";
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
	type QueryState,
	type SeriesPoint
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
	"level_label",
	"source_id",
	"source_name",
	"filters",
	"aggregate"
] as const;

/**
 * What the entry type contributes to every row. `aggregate` is the catalog's: `sum` says each
 * value is its period's total, `mean` its average, and empty that values never roll up.
 */
type EntryInfo = {
	entryType: string;
	entryLabel: string;
	unit: string;
	aggregate?: "sum" | "mean" | null;
};

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

/** The "Rated" cell: whether a day's figure was counted, left out, or is still changing. */
function rated(p: SeriesPoint): string {
	if (p.final === false) return m.csv_rated_so_far();
	return p.figure === null || p.figure === undefined ? m.csv_rated_not_enough() : m.csv_rated_yes();
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
	viewer: PlaceViewer,
	withFigure = false
): string[] {
	const order = new Map(data.places.map((p, i) => [p.place, i]));
	const own = new Map(data.places.map((p) => [p.place, p]));
	const series = [...data.series].sort(byPlaceOrder(order));
	const lines: string[] = [];
	for (const s of series) {
		const info = placeAt(s, order.get(s.place) ?? -1);
		const { kind, id } = placeParts(info?.place ?? s.place);
		const name = info ? placeLabel(info, viewer) : "";
		// The series' own place: a weather layer's station and a pesticide layer's filters belong
		// to it, not to the main place it is reported as.
		const source = own.get(s.place)?.source;
		const filters = own.get(s.place)?.filters?.join("; ") ?? "";
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
				p.level ? (levels.find((l) => l.key === p.level)?.label ?? "") : "",
				source?.id ?? "",
				source?.name ?? "",
				filters,
				meta.aggregate ?? ""
			];
			if (withFigure) {
				row.push(typeof p.figure === "number" ? plain(p.figure) : "", rated(p));
			}
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
 * carry the main place's columns. A number overlay coarser than the main (a month's pesticide
 * use under daily data) keeps its own `period_start`/`period_end` and `resolution`, so it reads as
 * the whole period's value. A weather overlay's rows carry the station (`source_id`,
 * `source_name`) and a pesticide overlay's the active filters (`filters`, joined with "; ").
 * A calendar passes `figureLabel` and gets two more columns, the day's figure and "Rated".
 * `aggregate` (last of the common columns, so no earlier column moves) says whether a value is a total or an average.
 */
export function toCsv(
	data: QueryData,
	meta: EntryInfo,
	viewer: PlaceViewer = "owner",
	overlays: OverlayCsv[] = [],
	figureLabel?: string
): string {
	const own = new Map(data.places.map((p) => [p.place, p]));
	const withFigure = figureLabel !== undefined;
	const header = withFigure
		? [...CSV_COLUMNS, cell(figureLabel), m.csv_rated()].join(",")
		: CSV_COLUMNS.join(",");
	const lines: string[] = [
		header,
		...dataRows(data, meta, [], (s) => own.get(s.place), viewer, withFigure)
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
	catalog: CatalogEntry[],
	mainResolution: Resolution
): Promise<OverlayCsv | null> {
	try {
		const info = entryMeta(catalog, layer);
		if (!info) return null;
		const state = await firstSettled(overlayInput(main, layer, mainResolution, catalog));
		if (state.status === "error") throw state.error;
		if (state.status !== "ready") return null;
		const levels = await getMetadata().datasetLevels(layer.dataset, info.entryType.id);
		return {
			data: state.data,
			levels,
			meta: {
				entryType: info.entryType.id,
				entryLabel: info.entryType.label,
				unit: info.entryType.units,
				aggregate: info.entryType.aggregate
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
 * unavailable overlay is left out (named in `skipped`); the main rows still export. Throws if
 * there is nothing to download or the main data can't be loaded.
 */
export async function downloadDataCsv(
	config: WidgetDataConfig,
	save: FileAccess["save"],
	viewer: PlaceViewer = "owner",
	type?: string
): Promise<CsvResult> {
	const catalog = await getMetadata().catalog();
	if (catalog === "unavailable") throw new Error("The catalog is unavailable");
	const calendar = type !== undefined && isCalendarType(type);
	const chart = chartInput(config, catalog, LIMITS.SELECTION_MAX);
	const { layer } = chart;
	let { input } = chart;
	let figureLabel: string | undefined;
	if (calendar) {
		// A calendar's own query: one row per day, with the figure the server names.
		const own = calendarInput(config, catalog, type);
		const figure = layer?.entryType ? await getMetadata().dailyFigure(layer.entryType) : null;
		input = own ? (figure ? { ...own, dailyFigure: figure.field } : own) : null;
		figureLabel = figureName(figure);
	}
	const info = entryMeta(catalog, layer);
	if (!input || !info) throw new Error("There is no data to download");
	const state = await firstSettled(input);
	if (state.status === "error") throw state.error;
	if (state.status !== "ready") throw new Error(`The data is unavailable (${state.status})`);
	const meta: EntryInfo = {
		entryType: info.entryType.id,
		entryLabel: info.entryType.label,
		unit: info.entryType.units,
		aggregate: info.entryType.aggregate
	};
	const { data } = state;
	const layers = overlayLayers(config, catalog);
	const loaded = await Promise.all(
		layers.map((l) => loadOverlay(input, l, catalog, data.resolution))
	);
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
		toCsv(data, meta, viewer, overlays, figureLabel),
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
	return downloadDataCsv(widget.data, save, viewer, widget.type);
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
	viewer: PlaceViewer = "owner",
	type?: string
): Promise<void> {
	const running = pending.get(key);
	if (running) return running;
	const job = downloadDataCsv(data, save, viewer, type);
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
	return saveDataCsv(widget.id, widget.data, save, viewer, widget.type);
}
