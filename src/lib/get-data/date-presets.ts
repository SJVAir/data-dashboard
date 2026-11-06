import type { DateRangeSpec } from "$lib/data/schema";
import { calendarSpanDays, resolveRange } from "$lib/format/range";
import { m } from "$lib/paraglide/messages.js";
import type { WidgetType } from "$lib/widgets/registry";

export type PresetGroup = "last" | "to-date" | "specific" | "custom";

export type Preset = {
	id: string;
	group: PresetGroup;
	label: () => string;
	/** Fixed spec; absent for the "specific…" and custom presets, which ask for dates first. */
	spec?: DateRangeSpec;
	needs?: "day" | "week" | "month" | "year" | "range";
};

type Trailing = Extract<DateRangeSpec, { kind: "trailing" }>;

function last(amount: number, unit: Trailing["unit"], label: () => string): Preset {
	return {
		id: `last-${amount}-${unit}`,
		group: "last",
		label,
		spec: { kind: "trailing", amount, unit }
	};
}

function toDate(unit: "week" | "month" | "year", label: () => string): Preset {
	return { id: `to-date-${unit}`, group: "to-date", label, spec: { kind: "to-date", unit } };
}

function specific(unit: "day" | "week" | "month" | "year", label: () => string): Preset {
	return { id: `set-${unit}`, group: "specific", label, needs: unit };
}

const LAST_3_DAYS = last(3, "day", () => m.getdata_preset_last_3_days());

const LAST: Preset[] = [
	last(24, "hour", () => m.getdata_preset_last_24_hours()),
	LAST_3_DAYS,
	last(7, "day", () => m.getdata_preset_last_7_days()),
	last(30, "day", () => m.getdata_preset_last_30_days()),
	last(90, "day", () => m.getdata_preset_last_90_days()),
	last(12, "month", () => m.getdata_preset_last_12_months())
];
const TO_DATE: Preset[] = [
	toDate("week", () => m.getdata_preset_this_week()),
	toDate("month", () => m.getdata_preset_this_month()),
	toDate("year", () => m.getdata_preset_this_year())
];
const SPECIFIC: Preset[] = [
	specific("day", () => m.getdata_preset_specific_day()),
	specific("week", () => m.getdata_preset_specific_week()),
	specific("month", () => m.getdata_preset_specific_month()),
	specific("year", () => m.getdata_preset_specific_year())
];
const CUSTOM: Preset = {
	id: "custom",
	group: "custom",
	label: () => m.getdata_preset_custom(),
	needs: "range"
};

const LISTED_TRAILING = new Set(LAST.map((p) => p.id));

/** The preset list for a widget type, grouped in display order, honoring its allowed methods. */
// `now` is part of the agreed signature; today's list doesn't depend on it.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function presetsFor(type: Pick<WidgetType, "dateMethods" | "span">, _now: Date): Preset[] {
	const methods = type.dateMethods;
	const allows = (kind: DateRangeSpec["kind"]) => !methods || methods.includes(kind);
	const out: Preset[] = [];
	if (allows("trailing")) {
		const short = (type.span?.maxDays ?? Infinity) <= 7;
		out.push(...LAST.filter((p) => p !== LAST_3_DAYS || short));
	}
	if (allows("to-date")) out.push(...TO_DATE);
	if (allows("set")) out.push(...SPECIFIC);
	if (allows("custom")) out.push(CUSTOM);
	return out;
}

/** The preset a saved spec shows as; a trailing length that isn't listed shows under Custom. */
export function presetIdFor(spec: DateRangeSpec): string {
	switch (spec.kind) {
		case "set":
			return `set-${spec.unit}`;
		case "to-date":
			return `to-date-${spec.unit}`;
		case "trailing": {
			const id = `last-${spec.amount}-${spec.unit}`;
			return LISTED_TRAILING.has(id) ? id : "custom";
		}
		case "custom":
			return "custom";
	}
}

/** Whether the type's span limits rule the range out, measured in Pacific calendar days. */
export function blockedBySpan(
	spec: DateRangeSpec,
	span: WidgetType["span"],
	now: Date
): "too-short" | "too-long" | null {
	if (!span) return null;
	const days = calendarSpanDays(spec, resolveRange(spec, now));
	if (span.minDays !== undefined && days < span.minDays) return "too-short";
	if (span.maxDays !== undefined && days > span.maxDays) return "too-long";
	return null;
}
