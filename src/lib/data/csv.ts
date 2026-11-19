import { TZDate } from "@date-fns/tz";
import { toast } from "svelte-sonner";
import { SvelteMap } from "svelte/reactivity";
import { formatList, TIME_ZONE } from "$lib/format";
import { nextPeriodStart, resolveRange } from "$lib/format/range";
import type { WidgetInstance } from "$lib/documents/schema";
import type { Level as DatasetLevel } from "./dataset-rules";
import { layerKind } from "./layer-kind";
import type { CatalogEntry, Figure, Level } from "./metadata";
import type { Resolution, WidgetDataConfig } from "./schema";
import { m } from "$lib/paraglide/messages.js";
import type { FileAccess } from "$lib/platform/types";
import { dataFileName } from "$lib/sharing/file-names";
import { report } from "$lib/safety/report";
import type { PlaceViewer } from "$lib/widgets/shared/viewer";
import { placeLabel } from "$lib/widgets/title";
import { calendarInput } from "$lib/calendars/input";
import { isCalendarType } from "$lib/calendars/types";
import { entryMeta, widgetInputs, widgetPlaceKind } from "$lib/widgets/shared/input";
import { overlayLayers } from "$lib/widgets/shared/overlays";
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
	"aggregate",
	"figure",
	"figure_label",
	"rated"
] as const;

/**
 * What the entry type contributes to every row. `aggregate` is the catalog's: `sum` says each
 * value is its period's total, `mean` its average, and empty that values never roll up.
 * `figureLabel` is the server's name for the figure the rows were read with
 * (`daily_statistic_label` or `period_statistic_label`), when they were read with one.
 */
type EntryInfo = {
	entryType: string;
	entryLabel: string;
	unit: string;
	aggregate?: "sum" | "mean" | null;
	figureLabel?: string | null;
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

/**
 * The `rated` cell: whether a row's figure was counted, left out (too little data), or is still
 * changing, as the calendar CSV has always written it; empty for a row read without a figure.
 */
function rated(p: SeriesPoint): string {
	if (p.figure === undefined) return "";
	if (p.final === false) return m.csv_rated_not_final();
	return p.figure === null ? m.csv_rated_not_enough() : m.csv_rated_yes();
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
				meta.aggregate ?? "",
				typeof p.figure === "number" ? plain(p.figure) : "",
				p.figure === undefined ? "" : (meta.figureLabel ?? ""),
				rated(p)
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
 * carry the main place's columns. A number overlay coarser than the main (a month's pesticide
 * use under daily data) keeps its own `period_start`/`period_end` and `resolution`, so it reads as
 * the whole period's value. A weather overlay's rows carry the station (`source_id`,
 * `source_name`) and a pesticide overlay's the active filters (`filters`, joined with "; ").
 * `aggregate` says whether a value is a total or an average. Each row then describes its own
 * figure (the value the widget shows; `mean` stays the period's plain mean): `figure` (empty when
 * null), `figure_label` (the server's name for it) and `rated`, all empty on a row read without
 * one (the plain mean). New columns go last, so no earlier column moves.
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
 * One overlay's data (`input`: its query, `null` when it doesn't offer the dataset's
 * resolution), or `null` when it couldn't be loaded (an error, unavailable, or no query). A ready
 * overlay with no points is not a failure: it just adds no rows.
 */
async function loadOverlay(
	input: QueryInput | null,
	layer: WidgetDataConfig["layers"][number],
	catalog: CatalogEntry[]
): Promise<OverlayCsv | null> {
	try {
		const info = entryMeta(catalog, layer);
		if (!info || !input) return null;
		// A pollutant overlay is read with its own figure, as the main is (`figureOf`).
		const figure =
			layerKind(layer, catalog) === "pollutant"
				? await figureOf(info.entryType.id, input.resolution)
				: null;
		const state = await firstSettled(figure ? { ...input, figure: figure.field } : input);
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
				aggregate: info.entryType.aggregate,
				figureLabel: figure?.label ?? null
			}
		};
	} catch (error) {
		report(error);
		return null;
	}
}

/** An entry type's figure at `resolution`; `null` (plain rows) when it has none. Rejects on failure. */
function figureOf(entryType: string, resolution: Resolution): Promise<Figure | null> {
	return getMetadata().figure(entryType, resolution as DatasetLevel);
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
	const chart = widgetInputs(
		{ type: type ?? "", data: config },
		catalog,
		widgetPlaceKind(config, catalog),
		LIMITS.SELECTION_MAX
	);
	const { layer } = chart;
	let input = chart.main;
	// The figure the widget shows (a calendar's is always the day's); an entry type with none
	// gives plain rows (their figure cells empty). A failed lookup fails the download, as the
	// widget shows an error: never rows that silently lack their figure.
	const need = calendar
		? layer?.entryType
			? { entryType: layer.entryType, resolution: "day" as const }
			: null
		: chart.figureFor;
	const figure = need ? await figureOf(need.entryType, need.resolution) : null;
	if (calendar) {
		// A calendar's own query: one row per day.
		input = calendarInput(config, catalog, type);
	}
	if (input && figure) input = { ...input, figure: figure.field };
	const info = entryMeta(catalog, layer);
	if (!input || !info) throw new Error("There is no data to download");
	const state = await firstSettled(input);
	if (state.status === "error") throw state.error;
	if (state.status !== "ready") throw new Error(`The data is unavailable (${state.status})`);
	const meta: EntryInfo = {
		entryType: info.entryType.id,
		entryLabel: info.entryType.label,
		unit: info.entryType.units,
		aggregate: info.entryType.aggregate,
		figureLabel: figure?.label ?? null
	};
	const { data } = state;
	const layers = overlayLayers(config, catalog);
	const loaded = await Promise.all(
		layers.map((l, i) => loadOverlay(chart.overlays[i] ?? null, l, catalog))
	);
	const overlays = loaded.filter((o): o is OverlayCsv => o !== null);
	const skipped = layers.flatMap((l, i) =>
		loaded[i] ? [] : [entryMeta(catalog, l)?.entryType.label ?? l.entryType ?? l.dataset]
	);
	const range = resolveRange(input.dateRange, new Date(data.fetchedAt), input.resolution);
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
