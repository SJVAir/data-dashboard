import type { MonitorData, MonitorLatestType } from "@sjvair/sdk";
import { XMap } from "@tstk/builtin-extensions";

export type SupportedPollutant = "pm25" | "o3";

export function buildMonitorsLatest(
	monitors: Array<MonitorData>,
	averages: Map<string, number>,
	pollutant: SupportedPollutant,
	timestamp: string
): XMap<string, MonitorLatestType<SupportedPollutant>> {
	const latest = new XMap<string, MonitorLatestType<SupportedPollutant>>();

	for (const monitor of monitors) {
		const average = averages.get(monitor.id);
		if (average === undefined) continue;

		latest.set(monitor.id, {
			...monitor,
			latest: {
				sensor: "",
				timestamp,
				stage: "average",
				processor: "range-average",
				entry_type: pollutant,
				value: average.toString()
			}
		});
	}

	return latest;
}
