import { getMonitorAlertCurrent, type MonitorAlertCurrent } from "@sjvair/sdk";
import { levelFor, type Level } from "../metadata";
import type { PlaceInfo } from "../types";
import type { NowSource } from "./client";
import { trend, type CurrentReading } from "./current";

/** One entry type's server-evaluated alert result for a monitor. */
export type AlertCurrent = MonitorAlertCurrent;

/** A monitor's current alert results, keyed by entry type; a missing key is "not evaluated". */
export type AlertRecord = Record<string, AlertCurrent | undefined>;

/** How the server evaluates an entry type on a monitor type, from the meta. */
export type AlertConfig = {
	windowMinutes: number;
	/** How often the monitor reports; `null` when the meta has none. */
	expectedIntervalMinutes: number | null;
};

/** A request that takes longer than this fails, so a tile never waits on a hung connection. */
export const ALERT_TIMEOUT_MS = 20_000;

/**
 * A monitor's current alert values, as a now source (polled every 3 minutes). A request that
 * takes over `timeoutMs` is aborted and fails; the tile then reads the hourly average and the
 * poller's backoff retries.
 */
export function alertSource(
	monitorId: string,
	opts: { timeoutMs?: number } = {}
): NowSource<AlertRecord> {
	const timeoutMs = opts.timeoutMs ?? ALERT_TIMEOUT_MS;
	return {
		key: `alert:${monitorId}`,
		cadence: "raw",
		fetch: (signal) =>
			new Promise<AlertRecord>((resolve, reject) => {
				const request = new AbortController();
				const timer = setTimeout(() => {
					reject(new Error("The alert request timed out"));
					request.abort();
				}, timeoutMs);
				const stop = () => {
					clearTimeout(timer);
					request.abort();
					reject(new DOMException("The operation was aborted.", "AbortError"));
				};
				signal.addEventListener("abort", stop, { once: true });
				getMonitorAlertCurrent(monitorId, { signal: request.signal })
					.then(resolve, reject)
					.finally(() => {
						clearTimeout(timer);
						signal.removeEventListener("abort", stop);
					});
			})
	};
}

/**
 * The reading an alert result gives. A status other than "ok" is the matching empty reading. The
 * trend shows only against a previous result that was "ok" and was of an earlier reading than
 * this one (a cache row from before the server kept the timestamp, or the same reading, has none).
 */
export function alertReading(
	entry: AlertCurrent,
	levels: Level[],
	config: AlertConfig,
	place: PlaceInfo,
	precision: number | null
): CurrentReading {
	switch (entry.status) {
		case "pending":
			return { status: "pending", place };
		case "insufficient":
			return { status: "insufficient", place };
		case "no_data":
			return { status: "no-recent", place };
	}
	const at = entry.latest_timestamp ? Date.parse(entry.latest_timestamp) : NaN;
	if (entry.value === null || Number.isNaN(at)) return { status: "no-data", place };
	const evaluated = entry.evaluated_at ? Date.parse(entry.evaluated_at) : NaN;
	const previous = entry.previous;
	const comparable =
		previous !== null &&
		previous !== undefined &&
		previous.status === "ok" &&
		previous.value !== null &&
		typeof previous.latest_timestamp === "string" &&
		previous.latest_timestamp !== entry.latest_timestamp;
	const interval = config.expectedIntervalMinutes;
	return {
		status: "ok",
		value: entry.value,
		level: levels.find((l) => l.key === entry.level) ?? levelFor(levels, entry.value),
		at,
		watchAt: Number.isNaN(evaluated) ? at : evaluated,
		trend: comparable ? trend(entry.value, previous.value, precision) : null,
		source: interval !== null && interval >= config.windowMinutes ? "alert-latest" : "alert",
		windowMinutes: config.windowMinutes,
		place
	};
}
