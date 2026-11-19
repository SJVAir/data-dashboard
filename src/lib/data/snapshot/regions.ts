import {
	getRegionSummariesBulkDaily,
	getRegionSummariesBulkDailyOpen,
	getRegionSummariesBulkMonthly,
	getRegionSummariesBulkYearly,
	type RegionSummaryBulkType,
	type RegionWithSummaries
} from "@sjvair/sdk";
import { dayState } from "../day-state";
import type { Figure, Level } from "../metadata";
import type { NowSource } from "../now/client";
import { atKey } from "./at";
import { periodEnd, periodFigure, periodHolds, type PeriodAt } from "./period";
import { numberOf, rowDate } from "./rows";
import type { Snapshot, SnapshotFigure } from "./types";

const BULK_TYPES: Record<RegionSummaryBulkType, true> = {
	county: true,
	city: true,
	zipcode: true,
	tract: true,
	cdp: true,
	congressional_district: true,
	state_assembly: true,
	state_senate: true,
	school_district: true,
	air_district: true,
	urban_area: true,
	protected: true,
	ab617: true,
	mtrs: true,
	custom: true
};

/** Whether `type` is a region type the bulk summaries take (not `land_use`, not unknown). */
export function isRegionSummaryBulkType(type: string): type is RegionSummaryBulkType {
	return Object.hasOwn(BULK_TYPES, type);
}

/** The region types a fill can draw: those the bulk summaries take, in their order. */
export function fillableTypes<T extends { type: string }>(types: readonly T[]): T[] {
	return types.filter((t) => isRegionSummaryBulkType(t.type));
}

type Args = {
	entryType: string;
	regionType: string;
	day: string;
	figure: Figure | null;
	levels: Level[];
	today: () => string;
	/** The server's region id (sqid) to the external id; from the type's GeoJSON features. */
	codes: (sqid: string) => string | undefined;
};

/**
 * The figure of `day` for every region of `regionType`, keyed `type:code`. A region with no row
 * that day, or no external id, is left out.
 */
function snapshotOf(regions: RegionWithSummaries[], args: Args): Snapshot {
	const { regionType, day, figure, levels, codes } = args;
	const today = args.today();
	const figures = new Map<string, SnapshotFigure>();
	let final = true;
	for (const region of regions) {
		const code = codes(region.id);
		if (code === undefined) continue;
		const found = region.summaries.find((r) => rowDate(r) === day);
		if (!found) continue;
		const row = {
			figure: figure ? numberOf((found as Record<string, unknown>)[figure.field]) : null,
			final: found.is_final
		};
		const state = dayState({ date: day, today, row, figure, levels });
		if (state.kind === "pending" || state.kind === "today") final = false;
		figures.set(`${regionType}:${code}`, {
			value: state.value,
			level: state.level,
			kind: state.kind
		});
	}
	return { figures, final, unrated: figure === null };
}

/**
 * One day's figure for every region of a type, from one bulk daily request scoped by `type`.
 * Polled hourly until every figure is final.
 */
export function regionDaySource(
	args: Args
): NowSource<Snapshot> & { poll: (s: Snapshot | undefined) => boolean } {
	const { entryType, regionType, day } = args;
	return {
		key: `snapshot:regions:${entryType}:${regionType}:${day}`,
		cadence: "hour",
		poll: (s) => !s?.final,
		async fetch(signal) {
			if (!isRegionSummaryBulkType(regionType)) return snapshotOf([], args);
			const regions = await getRegionSummariesBulkDaily(
				{ entryType, start: day, end: day, type: regionType },
				{ signal }
			);
			return snapshotOf(regions, args);
		}
	};
}

/**
 * Today so far for every region of a type, from the open-day rows (which may also hold
 * yesterday's until the nightly rollup settles; only today's row is read). Polled hourly.
 */
export function regionTodaySource(
	args: Omit<Args, "day">
): NowSource<Snapshot> & { poll: () => true } {
	const { entryType, regionType } = args;
	return {
		key: `snapshot:regions:${entryType}:${regionType}:today:${args.today()}`,
		cadence: "hour",
		poll: () => true,
		async fetch(signal) {
			const day = args.today();
			if (!isRegionSummaryBulkType(regionType)) return snapshotOf([], { ...args, day });
			const regions = await getRegionSummariesBulkDailyOpen(
				{ entryType, type: regionType },
				{ signal }
			);
			return snapshotOf(regions, { ...args, day });
		}
	};
}

/**
 * One month's or year's figure for every region of a type, keyed `type:code`, from one bulk
 * monthly or yearly request scoped by `type`: the average of the daily figures, coloured by the
 * daily levels. Polled hourly until every row is final; the current period is never final.
 */
export function regionPeriodSource(
	args: Omit<Args, "day"> & { at: PeriodAt }
): NowSource<Snapshot> & { poll: (s: Snapshot | undefined) => boolean } {
	const { entryType, regionType, at, figure, levels, codes } = args;
	return {
		key: `snapshot:regions:${entryType}:${regionType}:${atKey(at)}`,
		cadence: "hour",
		poll: (s) => !s?.final,
		async fetch(signal) {
			const figures = new Map<string, SnapshotFigure>();
			let final = !periodHolds(at, args.today());
			if (!isRegionSummaryBulkType(regionType)) {
				return { figures, final, unrated: figure === null };
			}
			const bulk =
				at.resolution === "year" ? getRegionSummariesBulkYearly : getRegionSummariesBulkMonthly;
			const regions = await bulk(
				{ entryType, start: at.start, end: periodEnd(at), type: regionType },
				{ signal }
			);
			for (const region of regions) {
				const code = codes(region.id);
				if (code === undefined) continue;
				const found = region.summaries.find((r) => rowDate(r) === at.start);
				if (!found) continue;
				if (!found.is_final) final = false;
				const row = found as unknown as Record<string, unknown> & { is_final: boolean };
				figures.set(`${regionType}:${code}`, periodFigure({ row, figure, levels }));
			}
			return { figures, final, unrated: figure === null };
		}
	};
}
