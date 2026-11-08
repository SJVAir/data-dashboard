import {
	getChemicalDetails,
	getCommodityDetails,
	getPesticidesMeta,
	getProductDetails,
	type PesticidesMeta
} from "@sjvair/sdk";
import { isNotFound } from "./adapters/targets";
import { untilAborted } from "./metadata";
import type { PesticideFilters } from "./schema";

/** A saved chemical, commodity or product id that the server no longer has. */
export class FilterGone extends Error {
	constructor(
		readonly kind: "chemical" | "commodity" | "product",
		readonly id: string
	) {
		super(`The saved ${kind} filter no longer exists`);
		this.name = "FilterGone";
	}
}

type Kind = "chemical" | "commodity" | "product";

const KINDS: Kind[] = ["chemical", "commodity", "product"];

const DETAILS: Record<Kind, (id: string) => Promise<{ display_name: string }>> = {
	chemical: (id) => getChemicalDetails(id),
	commodity: (id) => getCommodityDetails(id),
	product: (id) => getProductDetails(id)
};

let meta: Promise<PesticidesMeta> | undefined;
const names = new Map<string, Promise<string>>();

/** Forgets every remembered meta and name (for tests). */
export function resetPesticideMeta(): void {
	meta = undefined;
	names.clear();
}

/**
 * The server's pesticide meta (category, IARC group, method and narrow labels), fetched once for
 * the session; a failure is forgotten so the next call retries. The shared request carries no
 * caller's signal, so one caller's abort rejects only that caller.
 */
export function pesticideMeta(signal?: AbortSignal): Promise<PesticidesMeta> {
	if (!meta) {
		const request = getPesticidesMeta();
		meta = request;
		request.catch(() => {
			if (meta === request) meta = undefined;
		});
	}
	return untilAborted(meta, signal);
}

/**
 * The `display_name` of a saved id, remembered per id. A 404 is remembered too (a rejection with
 * `FilterGone`); any other failure is forgotten so the next call retries.
 */
function nameOf(kind: Kind, id: string, signal?: AbortSignal): Promise<string> {
	const key = `${kind}:${id}`;
	let found = names.get(key);
	if (!found) {
		const request = DETAILS[kind](id).then(
			(detail) => detail.display_name,
			(error: unknown) => {
				if (isNotFound(error)) throw new FilterGone(kind, id);
				throw error;
			}
		);
		found = request;
		names.set(key, request);
		request.catch((error: unknown) => {
			if (!(error instanceof FilterGone) && names.get(key) === request) names.delete(key);
		});
	}
	return untilAborted(found, signal);
}

/**
 * The `display_name` of each saved chemical, commodity and product filter. Rejects with
 * `FilterGone` when the server no longer has one.
 */
export async function filterLabels(
	filters: PesticideFilters,
	signal?: AbortSignal
): Promise<{ chemical?: string; commodity?: string; product?: string }> {
	const labels: { chemical?: string; commodity?: string; product?: string } = {};
	await Promise.all(
		KINDS.map(async (kind) => {
			const id = filters[kind];
			if (id !== undefined) labels[kind] = await nameOf(kind, id, signal);
		})
	);
	return labels;
}

/**
 * Whether every saved category, cancer group, method and narrowing code is still one the
 * server's meta lists. True when the filters have none (nothing is fetched).
 */
export async function codesKnown(
	filters: PesticideFilters,
	signal?: AbortSignal
): Promise<boolean> {
	if (!filters.category && !filters.iarcGroup && !filters.method && !filters.narrow) return true;
	const m = await pesticideMeta(signal);
	const has = (list: Array<{ key: string }>, key: string | undefined) =>
		key === undefined || list.some((item) => item.key === key);
	return (
		(filters.category ?? []).every((key) => has(m.categories, key)) &&
		has(m.iarc_groups, filters.iarcGroup) &&
		has(m.methods, filters.method) &&
		has(m.narrows, filters.narrow)
	);
}

/** A code's label from a meta list; the code itself when the list doesn't have it. */
function labelOf(list: Array<{ key: string; label: string }>, key: string): string {
	return list.find((item) => item.key === key)?.label ?? key;
}

/**
 * The human labels of the active filters, for the legend, the table header and the CSV: names
 * first, then categories, cancer group, method and narrowing, all from the server's meta.
 */
export async function filterSummary(
	filters: PesticideFilters | undefined,
	signal?: AbortSignal
): Promise<string[]> {
	if (!filters) return [];
	const named = await filterLabels(filters, signal);
	const labels = [named.chemical, named.commodity, named.product].filter(
		(name): name is string => name !== undefined
	);
	if (filters.category || filters.iarcGroup || filters.method || filters.narrow) {
		const m = await pesticideMeta(signal);
		for (const key of filters.category ?? []) labels.push(labelOf(m.categories, key));
		if (filters.iarcGroup) labels.push(labelOf(m.iarc_groups, filters.iarcGroup));
		if (filters.method) labels.push(labelOf(m.methods, filters.method));
		if (filters.narrow) labels.push(labelOf(m.narrows, filters.narrow));
	}
	return labels;
}
