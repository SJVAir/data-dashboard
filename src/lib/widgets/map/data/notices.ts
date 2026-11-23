import { getActivePesticideNotices, type ActivePesticideNoticeFeature } from "@sjvair/sdk";
import {
	encodeRef,
	type DataSource,
	type DataStatus,
	type MapFeatureProperties,
	type ScaleRef
} from "@sjvair/map-sdk/data";
import type { Feature, FeatureCollection, Point } from "geojson";
import { noticeFiltersSkipped, toNoticeParams } from "$lib/data/adapters/pesticides";
import type { NowState } from "$lib/data/now/client";
import type { UnavailableReason } from "$lib/data/types";
import { codesKnown, FilterGone, filterLabels, pesticideMeta } from "$lib/data/pesticide-meta";
import type { PesticideFilters, WidgetDataConfig } from "$lib/data/schema";
import { isPeriodAt, type SnapshotAt } from "$lib/data/snapshot";
import { addDays, formatNumber, pacificDay, todayPacific } from "$lib/format";
import { m } from "$lib/paraglide/messages.js";
import { PESTICIDE_NOTICES } from "../options";
import { filtersKey } from "./filters-key";
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
	/**
	 * The method as the `aerial_ground` filter codes it (`G`, `A`, `F`, `O` or `none`): the card
	 * labels it from the pesticides meta's `methods`.
	 */
	methodKey: string;
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

/**
 * The loaded notices, with the value every marker carries: the pesticides meta's spray-notice
 * level's `value` (null when the meta has no such scale, so the markers draw neutral).
 */
export type NoticesData = { notices: NoticeItem[]; value: string | null };

/** Before the notices load: none, and no value. */
export const NO_NOTICES: NoticesData = { notices: [], value: null };

/**
 * The notices' scale: the server's one-level `spray-notice` scale (from the pesticides meta).
 * One constant, as map-sdk matches a resolved scale to its source's by identity.
 */
export const NOTICES_SCALE: ScaleRef = { dataset: PESTICIDE_NOTICES, entryType: "spray-notice" };

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
 * Whether a saved chemical or product the server no longer has, or a code its meta no longer
 * lists, makes the notices unavailable (as the chart adapter checks). Only the filters the
 * notices take count (the meta's `notice_filters`): a gone commodity, which they never take,
 * doesn't. Any other failure is left to the fetch, which shows it with Retry.
 */
async function filtersGone(filters: PesticideFilters): Promise<boolean> {
	if (Object.keys(filters).length === 0) return false;
	try {
		const skipped = new Set<string>(noticeFiltersSkipped(filters, await noticeFilterNames()));
		const applied: PesticideFilters = Object.fromEntries(
			Object.entries(filters).filter(([key]) => !skipped.has(key))
		);
		if (Object.keys(applied).length === 0) return false;
		const [, known] = await Promise.all([filterLabels(applied), codesKnown(applied)]);
		return !known;
	} catch (error) {
		return error instanceof FilterGone;
	}
}

/** The filter params the notice endpoints take (the server's meta lists them). */
export async function noticeFilterNames(signal?: AbortSignal): Promise<string[]> {
	return (await pesticideMeta(signal)).notice_filters;
}

/**
 * The value a notice marker carries so map-sdk's category match finds the scale's level: the
 * level's own `value` (the match reads it, not the key). The scale has one level; null without it.
 */
function levelValue(meta: Awaited<ReturnType<typeof pesticideMeta>>): string | null {
	const level = meta.scales[NOTICES_SCALE.entryType]?.levels.find(
		(l) => l.value !== null && l.value !== undefined
	);
	return level ? String(level.value) : null;
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
		methodKey: p.aerial_ground,
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
 * A marker's name: how many notices, then the section and county (the notices of one section
 * share both); a variant for each the server leaves out.
 */
function markerName(
	counted: { count: string; countValue: number },
	{ section, county }: NoticeItem
): string {
	if (section !== null && county !== null)
		return m.map_notices_name({ ...counted, section, county });
	if (section !== null) return m.map_notices_name_section({ ...counted, section });
	if (county !== null) return m.map_notices_name_county({ ...counted, county });
	return m.map_notices_name_no_place(counted);
}

/**
 * The spray notices active on the day showing (on now, those active now), narrowed by the
 * layer's pesticide filters: drawn everywhere, never limited by the places. With a `date` the
 * server gives those scheduled from Pacific 00:00 four days before the day to the day's end.
 */
export const noticesEntry: MapDataEntry<NoticesData, NoticeFeatureProperties> = {
	id: "notices",
	async source({ data, at }) {
		const layer = noticesLayer(data);
		// Spray notices are daily: a month or year stop has none.
		if (!layer || isPeriodAt(at)) return null;
		const filters = layer.filters ?? {};
		if (await filtersGone(filters)) return { unavailable: "filter-gone" };
		// Now has a prefix of its own: it's asked for with no date, so after Pacific midnight
		// yesterday's day stop (asked for with its date) must never take over now's entry.
		const day = at === "now" ? `now:${todayPacific()}` : at.day;
		return {
			// Date and filters only: the request's area never reaches a key.
			key: `map-notices:${day}|${filtersKey(filters)}`,
			cadence: "hour",
			fetch: async (signal) => {
				const meta = await pesticideMeta(signal);
				const params = toNoticeParams(filters, meta.notice_filters);
				const collection =
					at === "now"
						? await getActivePesticideNotices({ ...params, signal })
						: await getActivePesticideNotices({ ...params, date: at.day, signal });
				const notices = collection.features
					.map((feature) => toItem(feature))
					.filter((item): item is NoticeItem => item !== null);
				return { notices, value: levelValue(meta) };
			}
		};
	},
	toDataSources({ notices, value }) {
		// One marker per section; a notice with no section is a marker of its own, keyed apart
		// from the section ids so the two never merge.
		const groups = new Map<string, NoticeItem[]>();
		for (const notice of notices) {
			const key = notice.sectionId ?? `notice:${notice.id}`;
			const group = groups.get(key);
			if (group) group.push(notice);
			else groups.set(key, [notice]);
		}
		const features: Feature<Point, NoticeFeatureProperties>[] = [];
		for (const [id, group] of groups) {
			const sorted = group.toSorted((a, b) => Date.parse(a.scheduled) - Date.parse(b.scheduled));
			const count = sorted.length;
			const counted = { count: formatNumber(count), countValue: count };
			features.push({
				type: "Feature",
				geometry: { type: "Point", coordinates: sorted[0].coordinates },
				properties: {
					refKey: encodeRef({ kind: "feature", id }),
					name: markerName(counted, sorted[0]),
					value,
					count,
					notices: sorted
				}
			});
		}
		const collection: FeatureCollection<Point, NoticeFeatureProperties> = {
			type: "FeatureCollection",
			features
		};
		return { notices: { status: { state: "ready" }, features: collection, scale: NOTICES_SCALE } };
	}
};

/**
 * Whether the notices poll (hourly): always on now; on a day until it settles. The server
 * rewrites notices up to four days back on its daily import, so a day D settles at Pacific
 * 00:00 of D+5 and never polls after.
 */
export function noticesPolls(at: SnapshotAt, nowMs: number = Date.now()): boolean {
	if (at === "now") return true;
	if (isPeriodAt(at)) return false;
	return nowMs < pacificDay(addDays(at.day, 5)).getTime();
}

/**
 * The notices' source for the map, reading the loaded state as it is. A saved filter gone makes
 * it unavailable (map-sdk's legend says so), never an empty layer.
 */
export function noticesSourceOf(d: {
	readonly noticesState: NowState<NoticesData>;
	readonly noticesDrawn: DataSource<NoticeFeatureProperties>;
	readonly noticesUnavailable: UnavailableReason | undefined;
}): DataSource<NoticeFeatureProperties> {
	return {
		get status(): DataStatus {
			const reason = d.noticesUnavailable;
			if (!reason) return dataStatus(d.noticesState);
			// The legend's status row says why (the map's banner too, with Edit data).
			return reason === "filter-gone"
				? { state: "unavailable", reason, message: m.map_notices_filter_gone() }
				: { state: "unavailable", reason };
		},
		get features() {
			return d.noticesState.data === undefined ? null : d.noticesDrawn.features;
		},
		get scale() {
			return NOTICES_SCALE;
		}
	};
}
