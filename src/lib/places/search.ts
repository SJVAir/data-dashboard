import { searchLocations, searchRegionPlaces } from "@sjvair/sdk";
import type { PlaceDirectory } from "./directory";
import type { LocationOption, MonitorOption, PlaceOption, RegionOption } from "./types";

export type SearchGroup<T extends PlaceOption> =
	{ status: "ready"; options: T[]; more: boolean } | { status: "error"; error: unknown };
export type SearchResult = {
	query: string;
	locations: SearchGroup<LocationOption>;
	regions: SearchGroup<RegionOption>;
	monitors: SearchGroup<MonitorOption>;
};

export const MIN_QUERY = 2;
export const MONITOR_RESULTS = 10;

function abortError() {
	return new DOMException("The operation was aborted.", "AbortError");
}

function settle<T extends PlaceOption>(
	result: PromiseSettledResult<{ options: T[]; more: boolean }>
): SearchGroup<T> {
	return result.status === "fulfilled"
		? { status: "ready", ...result.value }
		: { status: "error", error: result.reason };
}

/** Monitors matching `q`: name-start, then other word-start, then substring matches; active before not reporting; then name. */
export function matchMonitors(
	monitors: MonitorOption[],
	q: string
): { options: MonitorOption[]; more: boolean } {
	const needle = q.trim().toLowerCase();
	const ranked: { monitor: MonitorOption; rank: number }[] = [];
	for (const monitor of monitors) {
		const name = monitor.name.toLowerCase();
		let at = name.indexOf(needle);
		if (at < 0) continue;
		// 0: the name starts with it; 1: another word starts with it; 2: a substring.
		let rank = at === 0 ? 0 : 2;
		while (rank === 2 && at >= 0) {
			if (/[^\p{L}\p{N}]/u.test(name[at - 1])) rank = 1;
			at = name.indexOf(needle, at + 1);
		}
		ranked.push({ monitor, rank });
	}
	ranked.sort(
		(a, b) =>
			a.rank - b.rank ||
			Number(b.monitor.active) - Number(a.monitor.active) ||
			a.monitor.name.localeCompare(b.monitor.name)
	);
	return {
		options: ranked.slice(0, MONITOR_RESULTS).map((r) => r.monitor),
		more: ranked.length > MONITOR_RESULTS
	};
}

export async function searchPlaces(
	query: string,
	ctx: { directory: PlaceDirectory; entryType: string; activeOnly: boolean },
	signal: AbortSignal
): Promise<SearchResult> {
	if (signal.aborted) throw abortError();
	const q = query.trim();
	if (q.length < MIN_QUERY) {
		return {
			query: q,
			locations: { status: "ready", options: [], more: false },
			regions: { status: "ready", options: [], more: false },
			monitors: { status: "ready", options: [], more: false }
		};
	}

	const { directory } = ctx;
	const [locations, regions, monitors] = await Promise.allSettled([
		(async () => {
			const [found, types] = await Promise.all([
				searchLocations({ q, signal }),
				directory.locationTypes(signal)
			]);
			const labels = new Map(types.map((t) => [t.type, t.label]));
			return {
				options: found.results
					.filter((l) => !l.retired && labels.has(l.type))
					.map((l): LocationOption => ({
						kind: "location",
						source: l.source,
						code: l.external_id,
						name: l.name,
						typeLabel: labels.get(l.type)!,
						city: l.city_name,
						zip: l.zip,
						address: l.address
					})),
				more: found.more
			};
		})(),
		(async () => {
			const [rows, labels] = await Promise.all([
				searchRegionPlaces(q, undefined, { signal }),
				directory.regionTypeLabels(signal)
			]);
			return {
				options: rows
					.filter((r) => !r.retired && r.external_id !== null && labels.has(r.type))
					.map((r): RegionOption => ({
						kind: "region",
						type: r.type,
						code: r.external_id as string,
						name: r.name,
						typeLabel: labels.get(r.type)!,
						county: r.county?.name ?? null
					})),
				more: false
			};
		})(),
		directory
			.monitors(ctx.entryType, { activeOnly: ctx.activeOnly }, signal)
			.then((all) => matchMonitors(all, q))
	]);

	if (signal.aborted) throw abortError();
	return {
		query: q,
		locations: settle(locations),
		regions: settle(regions),
		monitors: settle(monitors)
	};
}
