import type { CurrentReading } from "$lib/data/now/current";
import { m } from "$lib/paraglide/messages.js";

/** How a reading was averaged, for the source line. */
export function averageLabel(r: Extract<CurrentReading, { status: "ok" }>): string {
	if (r.source === "alert") return m.current_minute_average({ minutes: r.windowMinutes ?? 0 });
	if (r.source === "alert-latest") return m.current_latest_reading();
	return m.current_hourly_average();
}

/** The source line: how the value was averaged and how long ago it was updated. */
export function updatedText(average: string, minutes: number): string {
	if (minutes < 1) return m.current_source_updated_just_now({ average });
	return m.current_source_updated_minutes({ average, minutes: String(minutes) });
}

/** What a reading that isn't "ok" says. `noData` is what no reading at all says. */
export function emptyText(r: CurrentReading | undefined, noData: string): string {
	switch (r?.status) {
		case "pending":
			return m.current_not_available_yet();
		case "insufficient":
			return m.current_not_enough_readings();
		case "no-recent":
			return m.current_no_recent_data();
		default:
			return noData;
	}
}
