import { expect, test } from "vitest";
import type { Level } from "$lib/data/metadata";
import { markKey, setMark, thresholdMarks, widgetMark } from "./marks.svelte";

const level: Level = {
	key: "moderate",
	label: "Moderate",
	color: "#ffff00",
	opacity: 1,
	tier: 1,
	guidance: "",
	description: "",
	min: 9,
	max: 35
};

test("setMark stores a widget's mark and null clears it", () => {
	setMark("w1", { level, at: 5, pulse: 1 });
	expect(thresholdMarks.w1).toEqual({ level, at: 5, pulse: 1 });
	setMark("w1", { level, at: 6, pulse: 2 });
	expect(thresholdMarks.w1.pulse).toBe(2);
	setMark("w1", null);
	expect("w1" in thresholdMarks).toBe(false);
});

test("markKey is the widget id, with the pollutant's entry type when given", () => {
	expect(markKey("w1", "o3")).toBe("w1:o3");
	expect(markKey("w1")).toBe("w1");
});

test("widgetMark is the first marked key's mark, in the order given", () => {
	const usg: Level = { ...level, key: "unhealthy_sensitive", tier: 2 };
	const keys = [markKey("w1", "pm25"), markKey("w1", "o3"), markKey("w1", "no2")];
	expect(widgetMark("w1", keys)).toBeUndefined();
	setMark(markKey("w1", "no2"), { level: usg, at: 1, pulse: 0 });
	expect(widgetMark("w1", keys)?.level.key).toBe("unhealthy_sensitive");
	setMark(markKey("w1", "o3"), { level, at: 2, pulse: 0 });
	expect(widgetMark("w1", keys)?.level.key).toBe("moderate");
	expect(widgetMark("w1", [...keys].reverse())?.level.key).toBe("unhealthy_sensitive");
	// Another widget's marks aren't its.
	expect(widgetMark("w2", [markKey("w2", "pm25")])).toBeUndefined();
	// With no keys, the widget's own id.
	setMark("w3", { level, at: 3, pulse: 0 });
	expect(widgetMark("w3", [])?.level.key).toBe("moderate");
	for (const k of [...keys, "w3"]) setMark(k, null);
});
