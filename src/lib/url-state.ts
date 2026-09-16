export interface DateRangeParam {
	start: string;
	end: string;
}

const DATE_RANGE_SEPARATOR = "..";

export function encodeDateRange(range: DateRangeParam): string {
	return `${range.start}${DATE_RANGE_SEPARATOR}${range.end}`;
}

export function decodeDateRange(value: string | null | undefined): DateRangeParam | null {
	if (!value) return null;
	const [start, end] = value.split(DATE_RANGE_SEPARATOR);
	if (!start || !end) return null;
	return { start, end };
}

export function encodeViews(views: Record<string, boolean>): string {
	return Object.entries(views)
		.filter(([, enabled]) => enabled)
		.map(([key]) => key)
		.join(",");
}

export function decodeViews<K extends string>(
	value: string | null | undefined,
	allKeys: readonly K[]
): Record<K, boolean> | null {
	if (value == null) return null;
	const enabled = new Set(value.split(",").filter(Boolean));
	return Object.fromEntries(allKeys.map((key) => [key, enabled.has(key)])) as Record<K, boolean>;
}

export type MonitorsPollutantParam = "pm25" | "o3";

export function encodePollutant(pollutant: MonitorsPollutantParam): string {
	return pollutant;
}

export function decodePollutant(
	value: string | number | boolean | null | undefined
): MonitorsPollutantParam | null {
	return value === "pm25" || value === "o3" ? value : null;
}

export function encodeCounty(regionId: string): string {
	return regionId;
}

export function decodeCounty(value: string | number | boolean | null | undefined): string | null {
	return typeof value === "string" && value.length > 0 ? value : null;
}

export function encodeYear(year: number): string {
	return String(year);
}

export function decodeYear(value: string | number | boolean | null | undefined): number | null {
	if (typeof value !== "string") return null;
	if (!/^\d{4}$/.test(value)) return null;
	const year = Number(value);
	return Number.isInteger(year) ? year : null;
}

export function encodeMonth(month: number): string {
	return String(month);
}

export function decodeMonth(value: string | number | boolean | null | undefined): number | null {
	if (typeof value !== "string") return null;
	const month = Number(value);
	return Number.isInteger(month) && month >= 1 && month <= 12 ? month : null;
}
