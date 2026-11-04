import { TZDate } from "@date-fns/tz";
import { format } from "date-fns";
import { toast } from "svelte-sonner";
import { TIME_ZONE } from "$lib/format";
import { nextPeriodStart, resolveRange } from "$lib/format/range";
import type { WidgetInstance } from "$lib/documents/schema";
import { m } from "$lib/paraglide/messages.js";
import type { FileAccess } from "$lib/platform/types";
import { dataFileName } from "$lib/sharing/file-names";
import { report } from "$lib/safety/report";
import { chartInput, entryMeta } from "$lib/widgets/shared/input";
import { getWidgetType } from "$lib/widgets/registry";
import { getMetadata, getQueryClient } from "./index";
import type { Subscription } from "./query/client";
import type { QueryData, QueryInput, QueryState } from "./types";

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
	return format(new TZDate(t, TIME_ZONE), "yyyy-MM-dd'T'HH:mm:ssXXX");
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
	const series = [...data.series].sort(
		(a, b) => (order.get(a.place) ?? Infinity) - (order.get(b.place) ?? Infinity)
	);
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
				String(p.mean),
				String(p.min),
				String(p.max),
				p.worstHour ? String(p.worstHour.value) : "",
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
 * Runs the widget's own query once (no polling), then saves exactly what it shows as CSV through
 * the platform. Throws if there is nothing to download or the data can't be loaded.
 */
export async function downloadWidgetCsv(
	widget: WidgetInstance,
	save: FileAccess["save"]
): Promise<void> {
	const catalog = await getMetadata().catalog();
	if (catalog === "unavailable") throw new Error("The catalog is unavailable");
	const maxPlaces = getWidgetType(widget.type)?.accepts?.maxPlaces ?? 10;
	const { layer, input } = chartInput(widget.data, catalog, maxPlaces);
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
	const range = resolveRange(input.dateRange, new Date());
	const placeLabel =
		data.places.length === 1
			? data.places[0].name
			: `${data.places.length} ${m.file_places_stem()}`;
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

/** `downloadWidgetCsv` for the UI: a failure is reported and shown as a toast. */
export async function saveWidgetCsv(
	widget: WidgetInstance,
	save: FileAccess["save"]
): Promise<void> {
	try {
		await downloadWidgetCsv(widget, save);
	} catch (error) {
		report(error);
		toast.error(m.widget_download_csv_failed());
	}
}
