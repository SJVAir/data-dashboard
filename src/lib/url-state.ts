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
): Record<K, boolean> {
	const enabled = new Set((value ?? "").split(",").filter(Boolean));
	return Object.fromEntries(allKeys.map((key) => [key, enabled.has(key)])) as Record<K, boolean>;
}
