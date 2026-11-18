import {
	getPesticideSectionDetails,
	type PesticideSectionDetail,
	type PesticideSectionDetailFilters
} from "@sjvair/sdk";
import { toUseParams } from "$lib/data/adapters/pesticides";
import { untilAborted } from "$lib/data/metadata";
import type { PesticideFilters } from "$lib/data/schema";
import { filtersKey } from "./filters-key";

/** What a section's details are asked for: the Map's period and filters. */
export type SectionDetailQuery = {
	year: number;
	/** A month period's month (1-12); none for a year. */
	month?: number | null;
	filters: PesticideFilters;
};

/** How many answers are kept; the oldest is dropped past it. */
const KEPT = 50;

/** Each section's details per query: shared while in flight, kept once answered, dropped on failure. */
const details = new Map<string, Promise<PesticideSectionDetail>>();

/** Forgets every remembered detail (for tests). */
export function resetSectionDetails(): void {
	details.clear();
}

/** The request's params: the period and the filters, as the map's own requests send them. */
function paramsOf(query: SectionDetailQuery): PesticideSectionDetailFilters {
	return {
		year: query.year,
		...(query.month != null && { month: query.month }),
		...toUseParams(query.filters)
	};
}

/**
 * A section's details for the Map's period and filters (its months and top chemicals, filtered),
 * for the section card. Callers at once share one request; a caller's `signal` stops only its own
 * wait, so the shared request carries none. A failed request is dropped, so the next call asks
 * again. The last `KEPT` answers are kept.
 */
export function sectionDetail(
	id: string,
	query: SectionDetailQuery,
	signal?: AbortSignal
): Promise<PesticideSectionDetail> {
	const key = `${id}|${query.year}|${query.month ?? ""}|${filtersKey(query.filters)}`;
	let request = details.get(key);
	if (!request) {
		const made = getPesticideSectionDetails(id, paramsOf(query));
		made.catch(() => {
			if (details.get(key) === made) details.delete(key);
		});
		details.set(key, made);
		while (details.size > KEPT) details.delete(details.keys().next().value!);
		request = made;
	}
	return untilAborted(request, signal);
}
