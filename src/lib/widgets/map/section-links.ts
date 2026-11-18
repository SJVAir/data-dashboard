import type { PesticidesMeta } from "@sjvair/sdk";
import {
	pesticideLinkUrl,
	type PesticideLinkKey,
	type PesticideLinkValues
} from "@sjvair/sdk/pesticides";
import { toUseParams } from "$lib/data/adapters/pesticides";
import type { PesticideFilters } from "$lib/data/schema";
import { daysInMonth } from "$lib/format/calendar";
import { webHref } from "./notice-links";
import { periodKey, type UsePeriod } from "./use-period";

/** The year and month of the day the notices layer shows, when it shows a past day. */
export type NoticesDay = { year: number; month: number };

type LinkMeta = Pick<PesticidesMeta, "links" | "link_params">;

/** The links a section's card offers; a link the meta doesn't carry is null. */
export type SectionLinks = { page: string | null; records: string | null; notices: string | null };

/** One link, filled by the SDK; null when the meta lacks it (or is an older server's). */
function fill(
	meta: LinkMeta | undefined,
	key: PesticideLinkKey,
	id: string,
	values: PesticideLinkValues
): string | null {
	if (!meta?.links?.[key] || !meta.link_params?.[key]) return null;
	return webHref(pesticideLinkUrl(meta, key, id, values)) ?? null;
}

/** The period's link values: its year, and a month period's first and last Pacific day. */
function periodValues(period: UsePeriod): PesticideLinkValues {
	if (period.month === null) return { year: period.year };
	const first = `${periodKey(period)}-01`;
	const last = `${periodKey(period)}-${String(daysInMonth(first)).padStart(2, "0")}`;
	return { year: period.year, month_start: first, month_end: last };
}

/** The period's and the Map's filters' link values. */
function linkValues(period: UsePeriod, filters: PesticideFilters): PesticideLinkValues {
	const use = toUseParams(filters);
	return {
		...periodValues(period),
		chemical_id: use.chemical_id,
		product_id: use.product_id,
		commodity_id: use.commodity_id,
		aerial_ground: use.aerial_ground,
		narrow: use.narrow
	};
}

/**
 * A section card's explorer links, from the pesticides meta's templates: the period and the
 * Map's filters carry over. Notices link to the past-day page when the notices layer shows a
 * past day, else to the current one.
 */
export function sectionLinks(
	meta: LinkMeta | undefined,
	id: string,
	period: UsePeriod,
	filters: PesticideFilters,
	noticesDay: NoticesDay | null
): SectionLinks {
	const values: PesticideLinkValues = {
		...linkValues(period, filters),
		...(noticesDay && { notices_year: noticesDay.year, notices_month: noticesDay.month })
	};
	return {
		page: fill(meta, "section_page", id, values),
		records: fill(meta, "section_records", id, values),
		notices: fill(meta, noticesDay ? "section_notices_past" : "section_notices", id, values)
	};
}

/**
 * A chemical's page, for the period and the Map's filters (the template's `link_params` choose
 * which apply). Not the Map's chemical filter: the page is for this chemical.
 */
export function chemicalLink(
	meta: LinkMeta | undefined,
	id: string,
	period: UsePeriod,
	filters: PesticideFilters
): string | null {
	return fill(meta, "chemical_page", id, {
		...linkValues(period, filters),
		chemical_id: undefined
	});
}
