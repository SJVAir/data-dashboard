import { getMonitorsList, getMonitorsMeta } from "@sjvair/sdk";
import type { Resolution } from "./schema";

export type Retirement = { since: string; replacedBy?: string };

export type EntryTypeMeta = {
	id: string;
	label: string;
	units: string;
	kind: "pollutant" | "meteorological" | "other";
	resolutions: Resolution[];
	available?: boolean;
	retired?: Retirement;
};

/** The ARCHITECTURE.md catalog entry; the descriptive fields are optional here. */
export type CatalogEntry = {
	id: string;
	label: string;
	description?: string;
	source?: string;
	license?: string;
	entryTypes: EntryTypeMeta[];
	geographies: string[];
	metaUrl?: string;
	retired?: Retirement;
};

export type Level = { name: string; label: string; color: string; range: [number, number] };

export type MonitorSummary = { id: string; name: string; type: string };

export interface MetadataSource {
	catalog(signal?: AbortSignal): Promise<CatalogEntry[] | "unavailable">;
	/** Ordered by range start; `[]` if none. */
	levels(entryType: string, signal?: AbortSignal): Promise<Level[]>;
	/** The meta's `default_calibration`; `""` and unknown map to `null`. */
	defaultProcessor(
		monitorType: string,
		entryType: string,
		signal?: AbortSignal
	): Promise<string | null>;
	monitorType(monitorId: string, signal?: AbortSignal): Promise<string | null>;
	monitors(signal?: AbortSignal): Promise<MonitorSummary[]>;
}

function abortError(): Error {
	return new DOMException("The operation was aborted.", "AbortError");
}

/** Resolve with `promise`, or reject early if `signal` aborts (without touching `promise`). */
function untilAborted<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
	if (!signal) return promise;
	if (signal.aborted) return Promise.reject(abortError());
	return new Promise<T>((resolve, reject) => {
		const onAbort = () => reject(abortError());
		signal.addEventListener("abort", onAbort, { once: true });
		promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
	});
}

/**
 * Fetch once, share the result, and forget failures so the next call retries. The shared fetch
 * carries no caller signal, so one caller's abort cannot reject it for the others.
 */
function memoize<T>(fetch: () => Promise<T>): (signal?: AbortSignal) => Promise<T> {
	let cached: Promise<T> | undefined;
	return (signal) => {
		if (!cached) {
			const p = fetch();
			cached = p;
			p.catch(() => {
				if (cached === p) cached = undefined;
			});
		}
		return untilAborted(cached, signal);
	};
}

export function createWebMetadata(): MetadataSource {
	const meta = memoize(() => getMonitorsMeta());
	const list = memoize(() => getMonitorsList());
	return {
		catalog: async () => "unavailable",
		async levels(entryType, signal) {
			const entry = (await meta(signal)).entries[entryType];
			const levels = entry?.levels;
			if (!levels) return [];
			return Object.values(levels)
				.map((l) => ({
					name: l.name,
					label: l.label,
					color: l.color,
					range: [l.range[0], l.range[1]] as [number, number]
				}))
				.sort((a, b) => a.range[0] - b.range[0]);
		},
		async defaultProcessor(monitorType, entryType, signal) {
			const monitor = (await meta(signal)).monitors[monitorType];
			const entries = monitor?.entries as
				Record<string, { default_calibration?: string | null } | undefined> | undefined;
			return entries?.[entryType]?.default_calibration || null;
		},
		async monitorType(monitorId, signal) {
			return (await list(signal)).find((m) => m.id === monitorId)?.type ?? null;
		},
		async monitors(signal) {
			return (await list(signal)).map((m) => ({ id: m.id, name: m.name, type: m.type }));
		}
	};
}

export function withCatalog(base: MetadataSource, catalog: CatalogEntry[]): MetadataSource {
	return { ...base, catalog: async () => catalog };
}
