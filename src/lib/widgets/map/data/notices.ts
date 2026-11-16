import { getActivePesticideNotices, type ActivePesticideNoticeFeature } from "@sjvair/sdk";
import { encodeRef, type DataSource, type MapFeatureProperties } from "@sjvair/map-sdk/data";
import type { Feature, FeatureCollection, Point } from "geojson";
import { toNoticeParams } from "$lib/data/adapters/pesticides";
import type { NowState } from "$lib/data/now/client";
import { codesKnown, FilterGone, filterLabels, pesticideMeta } from "$lib/data/pesticide-meta";
import type { PesticideFilters, WidgetDataConfig } from "$lib/data/schema";
import type { SnapshotAt } from "$lib/data/snapshot";
import { addDays, formatNumber, pacificDay, todayPacific } from "$lib/format";
import { m } from "$lib/paraglide/messages.js";
import { PESTICIDE_NOTICES } from "../options";
import { dataStatus } from "./status";
import type { MapDataEntry } from "./types";

/** One spray notice (a SprayDays notice of intent), as the map's cards show it. */
export type NoticeItem = {
	id: string;
	/** When the application is scheduled (ISO 8601, with its offset). */
	scheduled: string;
	/** When the notice's window ends (four days after `scheduled`). */
	scheduledEnd: string;
	/** SprayDays' wording for the method, e.g. "Ground"; may be empty. */
	method: string;
	amount: number | null;
	/** The units of `amount`; may be empty. */
	units: string;
	county: string | null;
	/** The MTRS section's name. */
	section: string | null;
	/** The MTRS section's id (for its details); notices in one section share one marker. */
	sectionId: string | null;
	/** The section's centre, where the notice is drawn (SprayDays gives the square mile). */
	coordinates: [number, number];
	products: { id: string; name: string }[];
	chemicals: { id: string; name: string; ofConcern: boolean }[];
	/** Whether the window had ended by the day showing; absent on now. */
	past?: boolean;
};

/** One marker: the notices of one section, sorted by when they're scheduled. */
export type NoticeFeatureProperties = MapFeatureProperties & {
	count: number;
	notices: NoticeItem[];
};

/** The spray notices layer of `data`, if it has one. */
function noticesLayer(data: WidgetDataConfig) {
	return data.layers.find((l) => l.dataset === PESTICIDE_NOTICES);
}

/**
 * A key for the saved filters that is the same whatever order they were saved in (a category
 * list is a set). Only ids and codes, never coordinates.
 */
function filtersKey(filters: PesticideFilters): string {
	const entries = Object.entries(filters)
		.filter(([, value]) => value !== undefined)
		.map(([key, value]) => [key, Array.isArray(value) ? [...value].sort() : value] as const)
		.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
	return JSON.stringify(Object.fromEntries(entries));
}

/**
 * Whether a saved chemical or product the server no longer has, or a code its meta no longer
 * lists, makes the notices unavailable (as the chart adapter checks). Any other failure is left
 * to the fetch, which shows it with Retry.
 */
async function filtersGone(filters: PesticideFilters): Promise<boolean> {
	if (Object.keys(filters).length === 0) return false;
	try {
		const [, known] = await Promise.all([filterLabels(filters), codesKnown(filters)]);
		return !known;
	} catch (error) {
		return error instanceof FilterGone;
	}
}

/** The filter params the notice endpoints take (the server's meta lists them). */
export async function noticeFilterNames(signal?: AbortSignal): Promise<string[]> {
	return (await pesticideMeta(signal)).notice_filters;
}

function toItem(feature: ActivePesticideNoticeFeature): NoticeItem | null {
	// A notice with no location can't be drawn.
	if (!feature.geometry) return null;
	const p = feature.properties;
	const [lng, lat] = feature.geometry.coordinates;
	return {
		id: p.id,
		scheduled: p.scheduled_application,
		scheduledEnd: p.scheduled_end,
		method: p.application_method,
		amount: p.treated_amount,
		units: p.treated_units,
		county: p.county,
		section: p.section,
		sectionId: p.section_id,
		coordinates: [lng, lat],
		products: p.products.map((product) => ({ id: product.id, name: product.name })),
		chemicals: p.chemicals.map((chemical) => ({
			id: chemical.id,
			name: chemical.display_name,
			ofConcern: chemical.is_of_concern
		})),
		...(p.past !== undefined && { past: p.past })
	};
}

/**
 * The spray notices active on the day showing (on now, those active now), narrowed by the
 * layer's pesticide filters: drawn everywhere, never limited by the places. With a `date` the
 * server gives those scheduled from Pacific 00:00 four days before the day to the day's end.
 */
export const noticesEntry: MapDataEntry<NoticeItem[], NoticeFeatureProperties> = {
	id: "notices",
	async source({ data, at }) {
		const layer = noticesLayer(data);
		if (!layer) return null;
		const filters = layer.filters ?? {};
		if (await filtersGone(filters)) return { unavailable: "filter-gone" };
		const day = at === "now" ? todayPacific() : at.day;
		return {
			// Date and filters only: the request's area never reaches a key.
			key: `map-notices:${day}|${filtersKey(filters)}`,
			cadence: "hour",
			fetch: async (signal) => {
				const params = toNoticeParams(filters, await noticeFilterNames(signal));
				const collection =
					at === "now"
						? await getActivePesticideNotices({ ...params, signal })
						: await getActivePesticideNotices({ ...params, date: at.day, signal });
				return collection.features
					.map((feature) => toItem(feature))
					.filter((item): item is NoticeItem => item !== null);
			}
		};
	},
	toDataSources(notices) {
		// One marker per section; a notice with no section is a marker of its own.
		const groups = new Map<string, NoticeItem[]>();
		for (const notice of notices) {
			const key = notice.sectionId ?? notice.id;
			const group = groups.get(key);
			if (group) group.push(notice);
			else groups.set(key, [notice]);
		}
		const features: Feature<Point, NoticeFeatureProperties>[] = [];
		for (const [id, group] of groups) {
			const sorted = group.toSorted((a, b) => Date.parse(a.scheduled) - Date.parse(b.scheduled));
			const count = sorted.length;
			const section = sorted[0].section;
			const counted = { count: formatNumber(count), countValue: count };
			features.push({
				type: "Feature",
				geometry: { type: "Point", coordinates: sorted[0].coordinates },
				properties: {
					refKey: encodeRef({ kind: "feature", id }),
					name:
						section === null
							? m.map_notices_name_no_section(counted)
							: m.map_notices_name({ ...counted, section }),
					value: count,
					count,
					notices: sorted
				}
			});
		}
		const collection: FeatureCollection<Point, NoticeFeatureProperties> = {
			type: "FeatureCollection",
			features
		};
		return { notices: { status: { state: "ready" }, features: collection, scale: null } };
	}
};

/**
 * Whether the notices poll (hourly): always on now; on a day until it settles. The server
 * rewrites notices up to four days back on its daily import, so a day D settles at Pacific
 * 00:00 of D+5 and never polls after.
 */
export function noticesPolls(at: SnapshotAt, nowMs: number = Date.now()): boolean {
	if (at === "now") return true;
	return nowMs < pacificDay(addDays(at.day, 5)).getTime();
}

/** The notices' source for the map, reading the loaded state as it is. */
export function noticesSourceOf(d: {
	readonly noticesState: NowState<NoticeItem[]>;
	readonly noticesDrawn: DataSource<NoticeFeatureProperties>;
}): DataSource<NoticeFeatureProperties> {
	return {
		get status() {
			return dataStatus(d.noticesState);
		},
		get features() {
			return d.noticesState.data === undefined ? null : d.noticesDrawn.features;
		},
		get scale() {
			return null;
		}
	};
}
