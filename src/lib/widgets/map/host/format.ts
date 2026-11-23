import { createDefaultFormat, type FormatProvider } from "@sjvair/map-sdk/data";
import { formatDateTime, formatNumber, needsZoneLabel, TIME_ZONE } from "$lib/format";
import { m } from "$lib/paraglide/messages.js";

const toDate = (value: Date | string) => (typeof value === "string" ? new Date(value) : value);

/**
 * map-sdk's `format` provider over the dashboard's `format` module, so the map's numbers and
 * dates read like the rest of the dashboard (Pacific time, "PT" only off-Pacific). map-sdk adds
 * the zone itself (`zoneLabel`), so `dateTime` leaves it off. The dashboard has no relative-time
 * helper, so that one stays map-sdk's.
 */
export const mapFormat: FormatProvider = {
	number: (value, options) => formatNumber(value, options),
	dateTime: (value) => formatDateTime(toDate(value), { deviceZone: TIME_ZONE }),
	zoneLabel: () => (needsZoneLabel() ? m.time_zone_label() : null),
	relativeTime: createDefaultFormat().relativeTime
};
