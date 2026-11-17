import { getPesticideSectionDetails, type PesticideSectionDetail } from "@sjvair/sdk";
import { untilAborted } from "$lib/data/metadata";

/** Each section's details per year: shared while in flight, kept once answered, dropped on failure. */
const details = new Map<string, Promise<PesticideSectionDetail>>();

/** Forgets every remembered detail (for tests). */
export function resetSectionDetails(): void {
	details.clear();
}

/**
 * A section's details for `year` (its months and top chemicals), for the section card. Callers at
 * once share one request; a caller's `signal` stops only its own wait, so the shared request
 * carries none. A failed request is dropped, so the next call asks again.
 */
export function sectionDetail(
	id: string,
	year: number,
	signal?: AbortSignal
): Promise<PesticideSectionDetail> {
	const key = `${id}|${year}`;
	let request = details.get(key);
	if (!request) {
		const made = getPesticideSectionDetails(id, { year });
		made.catch(() => {
			if (details.get(key) === made) details.delete(key);
		});
		details.set(key, made);
		request = made;
	}
	return untilAborted(request, signal);
}
