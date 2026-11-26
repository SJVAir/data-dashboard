import {
	getMonitorSummariesBulkDaily,
	getMonitorSummariesBulkMonthly,
	getMonitorSummariesBulkYearly,
	type MonitorWithSummaries
} from "@sjvair/sdk";
import { atKey } from "./at";
import { dayState } from "../day-state";
import type { Figure, Level } from "../metadata";
import type { NowSource } from "../now/client";
import { periodEnd, periodFigure, periodHolds, type PeriodAt } from "./period";
import { numberOf, rowDate } from "./rows";
import type { MonitorScope, Snapshot, SnapshotFigure } from "./types";

/** One bulk request a scope makes: its scoping fields, and the monitor ids it keeps (null: all). */
type ScopeRequest = { scoping: { region?: string[]; type?: string[] }; wanted: Set<string> | null };

/**
 * The bulk requests for a scope: one for regions or monitors; a monitor set's types inside its
 * regions (through the SDK's `type` filter), and one more request kept to its searched monitors
 * when it has any.
 */
function scopeRequests(scope: MonitorScope): ScopeRequest[] {
	switch (scope.kind) {
		case "regions":
			return [{ scoping: { region: scope.ids }, wanted: null }];
		case "monitors":
			return [{ scoping: {}, wanted: new Set(scope.ids) }];
		case "monitor-set": {
			const typed: ScopeRequest = {
				scoping: { region: scope.regionIds, type: scope.types },
				wanted: null
			};
			return scope.ids.length > 0 ? [typed, { scoping: {}, wanted: new Set(scope.ids) }] : [typed];
		}
	}
}

/** Every request's monitors, each monitor once (the first request that returns it wins). */
async function scopeMonitors(
	scope: MonitorScope,
	fetch: (scoping: ScopeRequest["scoping"]) => Promise<MonitorWithSummaries[]>
): Promise<MonitorWithSummaries[]> {
	const requests = scopeRequests(scope);
	const results = await Promise.all(requests.map((r) => fetch(r.scoping)));
	const seen = new Set<string>();
	const monitors: MonitorWithSummaries[] = [];
	results.forEach((list, i) => {
		const { wanted } = requests[i];
		for (const monitor of list) {
			if ((wanted && !wanted.has(monitor.id)) || seen.has(monitor.id)) continue;
			seen.add(monitor.id);
			monitors.push(monitor);
		}
	});
	return monitors;
}

/**
 * One day's figure for each monitor, from one daily bulk request (two for a monitor set with
 * searched monitors). A monitor with no row that day
 * is absent from `figures`. Polled hourly until every figure is final.
 */
export function monitorDaySource(args: {
	entryType: string;
	day: string;
	scope: MonitorScope;
	scopeKey: string;
	figure: Figure | null;
	levels: Level[];
	today: () => string;
}): NowSource<Snapshot> & { poll: (s: Snapshot | undefined) => boolean } {
	const { entryType, day, scope, scopeKey, figure, levels } = args;
	return {
		key: `snapshot:monitors:${entryType}:${scopeKey}:${day}`,
		cadence: "hour",
		poll: (s) => !s?.final,
		async fetch(signal) {
			const monitors = await scopeMonitors(scope, (scoping) =>
				getMonitorSummariesBulkDaily(
					{
						entryType: entryType as Parameters<typeof getMonitorSummariesBulkDaily>[0]["entryType"],
						start: day,
						end: day,
						...scoping
					},
					{ signal }
				)
			);
			const today = args.today();
			const figures = new Map<string, SnapshotFigure>();
			let final = true;
			for (const monitor of monitors) {
				const found = monitor.summaries.find((r) => rowDate(r) === day);
				if (!found) continue;
				const row = {
					figure: figure ? numberOf((found as Record<string, unknown>)[figure.field]) : null,
					final: found.is_final
				};
				const state = dayState({ date: day, today, row, figure, levels });
				if (state.kind === "pending" || state.kind === "today") final = false;
				figures.set(monitor.id, { value: state.value, level: state.level, kind: state.kind });
			}
			return { figures, final, unrated: figure === null };
		}
	};
}

/**
 * One month's or year's figure for each monitor, from one bulk monthly or yearly request (two for
 * a monitor set with searched monitors): the
 * average of the daily figures (`figure`, the scale's `period_statistic`), coloured by the daily
 * levels. A monitor with no row for the period is absent from `figures`. Polled hourly until every
 * row is final; the current period (written nightly through yesterday, with no row before its
 * first night) is never final.
 */
export function monitorPeriodSource(args: {
	entryType: string;
	at: PeriodAt;
	scope: MonitorScope;
	scopeKey: string;
	figure: Figure | null;
	levels: Level[];
	today: () => string;
}): NowSource<Snapshot> & { poll: (s: Snapshot | undefined) => boolean } {
	const { entryType, at, scope, scopeKey, figure, levels } = args;
	return {
		key: `snapshot:monitors:${entryType}:${scopeKey}:${atKey(at)}`,
		cadence: "hour",
		poll: (s) => !s?.final,
		async fetch(signal) {
			const bulk =
				at.resolution === "year" ? getMonitorSummariesBulkYearly : getMonitorSummariesBulkMonthly;
			const monitors = await scopeMonitors(scope, (scoping) =>
				bulk(
					{
						entryType: entryType as Parameters<typeof bulk>[0]["entryType"],
						start: at.start,
						end: periodEnd(at),
						...scoping
					},
					{ signal }
				)
			);
			const figures = new Map<string, SnapshotFigure>();
			let final = !periodHolds(at, args.today());
			for (const monitor of monitors) {
				const found = monitor.summaries.find((r) => rowDate(r) === at.start);
				if (!found) continue;
				if (!found.is_final) final = false;
				const row = found as unknown as Record<string, unknown> & { is_final: boolean };
				figures.set(monitor.id, periodFigure({ row, figure, levels }));
			}
			return { figures, final, unrated: figure === null };
		}
	};
}
