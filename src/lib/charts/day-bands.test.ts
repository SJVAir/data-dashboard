import { expect, test } from "vitest";
import type { Level } from "$lib/data/metadata";
import type { SeriesPoint } from "$lib/data/types";
import { pacificDay } from "$lib/format";
import { dayRuns, overlayLevelAt } from "./day-bands";

const level = (key: string): Level => ({
	key,
	label: key,
	color: "#ffff00",
	opacity: null,
	tier: null,
	guidance: "",
	description: "",
	min: 0,
	max: null
});
const LEVELS = [level("discouraged"), level("registered")];

const day = (date: string, key: string): SeriesPoint => ({
	t: pacificDay(date).getTime(),
	mean: NaN,
	min: NaN,
	max: NaN,
	count: 1,
	partial: false,
	level: key
});

test("consecutive Pacific days at one level form a run, across a DST change", () => {
	const points = [
		day("2026-10-31", "discouraged"),
		day("2026-11-01", "discouraged"), // 25 hours long
		day("2026-11-02", "registered"),
		day("2026-11-04", "registered"),
		day("2026-11-05", "unknown")
	];
	const runs = dayRuns({ levels: LEVELS, points });
	expect(runs.map((r) => [r.level.key, r.days, r.start, r.end])).toEqual([
		["discouraged", 2, points[0].t, points[2].t],
		["registered", 1, points[2].t, pacificDay("2026-11-03").getTime()],
		["registered", 1, points[3].t, points[4].t]
	]);
	expect(overlayLevelAt({ levels: LEVELS, points }, points[1].t + 24.5 * 3_600_000)?.key).toBe(
		"discouraged"
	);
	expect(overlayLevelAt({ levels: LEVELS, points }, pacificDay("2026-11-03").getTime())).toBe(
		undefined
	);
});
