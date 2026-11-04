import { TZDate } from "@date-fns/tz";
import { toast } from "svelte-sonner";
import { SvelteMap } from "svelte/reactivity";
import { TIME_ZONE } from "$lib/format";
import { nextPeriodStart, resolveRange } from "$lib/format/range";
import type { WidgetInstance } from "$lib/documents/schema";
import { m } from "$lib/paraglide/messages.js";
import type { FileAccess } from "$lib/platform/types";
import { dataFileName } from "$lib/sharing/file-names";
import { report } from "$lib/safety/report";
import { chartInput, entryMeta } from "$lib/widgets/shared/input";
import { getMetadata, getQueryClient } from "./index";
import { LIMITS } from "./schema";
import type { Subscription } from "./query/client";
import { byPlaceOrder, type QueryData, type QueryInput, type QueryState } from "./types";

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
	"computed_from_raw"
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
 * The data as CSV (RFC 4180, CRLF line ends, no comment lines): one row per place and period,
 * places in request order, oldest first. Numbers are plain (`.` decimal, no grouping) and a
 * missing value is empty. A raw reading's period ends where it starts.
 */
export function toCsv(data: QueryData, meta: EntryInfo): string {
	const names = new Map(data.places.map((p) => [p.place, p.name]));
	const order = new Map(data.places.map((p, i) => [p.place, i]));
	const series = [...data.series].sort(byPlaceOrder(order));
	const lines: string[] = [CSV_COLUMNS.join(",")];
	for (const s of series) {
		const { kind, id } = placeParts(s.place);
		for (const p of [...s.points].sort((a, b) => a.t - b.t)) {
			const end =
				data.resolution === "raw" ? p.t : nextPeriodStart(new Date(p.t), data.resolution).getTime();
			const row = [
				pacificIso(p.t),
				pacificIso(end),
				kind,
				id,
				names.get(s.place) ?? "",
				meta.entryType,
				meta.entryLabel,
				meta.unit,
				plain(p.mean),
				plain(p.min),
				plain(p.max),
				p.worstHour ? plain(p.worstHour.value) : "",
				p.worstHour ? pacificIso(p.worstHour.t) : "",
				String(p.count),
				data.resolution,
				String(p.partial),
				String(data.fromRaw)
			];
			lines.push(row.map(cell).join(","));
		}
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
 * Runs the widget's query once (no polling), with every place of its selection (not only the
 * ones it has room to show), then saves it as CSV through the platform. The file name's dates
 * are the range as of when the data was fetched. Throws if there is nothing to download or the
 * data can't be loaded.
 */
export async function downloadWidgetCsv(
	widget: WidgetInstance,
	save: FileAccess["save"]
): Promise<void> {
	const catalog = await getMetadata().catalog();
	if (catalog === "unavailable") throw new Error("The catalog is unavailable");
	const { layer, input } = chartInput(widget.data, catalog, LIMITS.SELECTION_MAX);
	const info = entryMeta(catalog, layer);
	if (!input || !info) throw new Error("The widget has no data to download");
	const state = await firstSettled(input);
	if (state.status === "error") throw state.error;
	if (state.status !== "ready") throw new Error(`The data is unavailable (${state.status})`);
	const meta: EntryInfo = {
		entryType: info.entryType.id,
		entryLabel: info.entryType.label,
		unit: info.entryType.units
	};
	const { data } = state;
	const range = resolveRange(input.dateRange, new Date(data.fetchedAt));
	const placeLabel =
		data.places.length === 1
			? data.places[0].name
			: m.file_places({ count: String(data.places.length) });
	save(
		dataFileName({
			entryLabel: meta.entryLabel,
			placeLabel,
			firstDate: range.firstDate,
			lastDate: range.lastDate
		}),
		toCsv(data, meta),
		"text/csv"
	);
}

/** Downloads in progress, by widget id. */
const pending = new SvelteMap<string, Promise<void>>();

/** Whether the widget's CSV is being prepared (reactive). */
export function csvPending(widgetId: string): boolean {
	return pending.has(widgetId);
}

/**
 * `downloadWidgetCsv` for the UI: a toast says the data is being prepared, and a failure is
 * reported and shown as a toast. While one is in progress for the widget, another call returns
 * that one, so a double click saves once.
 */
export function saveWidgetCsv(widget: WidgetInstance, save: FileAccess["save"]): Promise<void> {
	const running = pending.get(widget.id);
	if (running) return running;
	const job = downloadWidgetCsv(widget, save);
	toast.promise(job, {
		loading: m.widget_download_csv_pending(),
		error: (error: unknown) => {
			report(error);
			return m.widget_download_csv_failed();
		}
	});
	const done = job
		.catch(() => {})
		.finally(() => {
			if (pending.get(widget.id) === done) pending.delete(widget.id);
		});
	pending.set(widget.id, done);
	return done;
}
