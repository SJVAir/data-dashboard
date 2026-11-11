import { expect, test } from "vitest";
import type { Level } from "$lib/data/metadata";
import { setMark, thresholdMarks } from "./marks.svelte";

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
