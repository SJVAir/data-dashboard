import type { PesticideFilters } from "$lib/data/schema";

/**
 * A key for the saved filters that is the same whatever order they were saved in (a category
 * list is a set). Only ids and codes, never coordinates.
 */
export function filtersKey(filters: PesticideFilters): string {
	const entries = Object.entries(filters)
		.filter(([, value]) => value !== undefined)
		.map(([key, value]) => [key, Array.isArray(value) ? [...value].sort() : value] as const)
		.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
	return JSON.stringify(Object.fromEntries(entries));
}
