import { describe, expect, it } from "vitest";
import { pacificDay, todayPacific } from "$lib/format";
import type { SeriesPoint } from "$lib/data/types";
import type { DailyFigure, Level } from "$lib/data/metadata";
import { dayStates, ratedForCount, thresholdCount, type DayState } from "./day-state";

const level = (key: string, min: number, max: number | null, tier: number): Level => ({
	key,
	label: key,
	color: null,
	opacity: null,
	tier,
	guidance: "",
	description: "",
	min,
	max
});
const levels = [
	level("good", 0, 9.1, 0),
	level("moderate", 9.1, 35.5, 1),
	level("usg", 35.5, null, 2)
];
const figure: DailyFigure = { field: "mean_24h", label: "24-hour average" };
const today = "2026-11-09";

const point = (date: string, fig: number | null, final?: boolean): SeriesPoint => ({
	t: pacificDay(date).getTime(),
	mean: 0,
	min: 0,
	max: 0,
	count: 24,
	partial: false,
	figure: fig,
	...(final === undefined ? {} : { final })
});

const run = (points: SeriesPoint[], dates: string[], fig: DailyFigure | null = figure, t = today) =>
	dayStates({ points, dates, today: t, figure: fig, levels });

describe("dayStates", () => {
	it("rates a final day with a figure", () => {
		const s = run([point("2026-11-06", 31.9, true)], ["2026-11-06"]).get("2026-11-06")!;
		expect(s).toMatchObject({ kind: "rated", value: 31.9 });
		expect(s.level?.key).toBe("moderate");
	});

	it("treats a final of undefined as final", () => {
		expect(run([point("2026-11-06", 12)], ["2026-11-06"]).get("2026-11-06")!.kind).toBe("rated");
	});

	it("uses half-open level bounds", () => {
		const m = run(
			[point("2026-11-01", 9.1), point("2026-11-02", 9.09)],
			["2026-11-01", "2026-11-02"]
		);
		expect(m.get("2026-11-01")!.level?.key).toBe("moderate");
		expect(m.get("2026-11-02")!.level?.key).toBe("good");
	});

	it("marks a null figure as thin", () => {
		expect(run([point("2026-11-06", null, true)], ["2026-11-06"]).get("2026-11-06")).toMatchObject({
			kind: "thin",
			value: null,
			level: null
		});
	});

	it("treats an undefined figure like null", () => {
		const p = point("2026-11-06", null, true);
		delete p.figure;
		expect(run([p], ["2026-11-06"]).get("2026-11-06")!.kind).toBe("thin");
	});

	it("marks a past date with no point as none", () => {
		expect(run([], ["2026-11-06"]).get("2026-11-06")).toMatchObject({ kind: "none", value: null });
	});

	it("marks today with its so-far figure", () => {
		const s = run([point(today, 19.9, false)], [today]).get(today)!;
		expect(s).toMatchObject({ kind: "today", value: 19.9 });
		expect(s.level?.key).toBe("moderate");
	});

	it("marks today with no point as today without a value", () => {
		expect(run([], [today]).get(today)).toMatchObject({ kind: "today", value: null, level: null });
	});

	it("marks an earlier non-final day as pending", () => {
		const s = run([point("2026-11-08", 19.5, false)], ["2026-11-08"]).get("2026-11-08")!;
		expect(s).toMatchObject({ kind: "pending", value: 19.5 });
		expect(s.level?.key).toBe("moderate");
	});

	it("marks later dates as future even with a point", () => {
		expect(run([point("2026-11-10", 50, true)], ["2026-11-10"]).get("2026-11-10")).toMatchObject({
			kind: "future",
			value: null
		});
	});

	it("marks every past day unrated when the scale has no daily statistic", () => {
		const m = run(
			[point("2026-11-06", 31.9, true), point(today, 5, false)],
			["2026-11-06", "2026-11-07", today, "2026-11-10"],
			null
		);
		expect(m.get("2026-11-06")).toMatchObject({ kind: "unrated", value: null, level: null });
		expect(m.get("2026-11-07")!.kind).toBe("unrated");
		expect(m.get(today)).toMatchObject({ kind: "today", value: null });
		expect(m.get("2026-11-10")!.kind).toBe("future");
	});

	it("reads today in Pacific time", () => {
		const t = todayPacific(new Date("2026-11-10T07:30:00Z"));
		expect(t).toBe("2026-11-09");
		const s = run([point("2026-11-09", 19.9, false)], ["2026-11-09"], figure, t).get("2026-11-09")!;
		expect(s.kind).toBe("today");
	});
});

const st = (kind: DayState["kind"], value: number | null, date = "2026-11-01"): DayState => ({
	date,
	kind,
	value,
	level:
		value === null
			? null
			: (levels.find((l) => value >= l.min && (l.max === null || value < l.max)) ?? null)
});

describe("thresholdCount", () => {
	it("counts rated days at or above a level", () => {
		const states = [
			st("rated", 20),
			st("rated", 5),
			st("thin", null),
			st("today", 20),
			st("none", null)
		];
		expect(thresholdCount(states, levels[1])).toEqual({ at: 2, rated: 3 });
	});
	it("ratedForCount covers rated and today with a value only", () => {
		expect(ratedForCount(st("today", null))).toBe(false);
		expect(ratedForCount(st("pending", 5))).toBe(false);
	});
});
