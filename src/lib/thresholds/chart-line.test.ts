import { expect, test } from "vitest";
import { chartThreshold, thresholdLine } from "$lib/charts/threshold-line";
import { chartType } from "$lib/widgets/chart";
import { PM25_LEVELS } from "$lib/widgets/shared/test-harness/fake-data";
import { watchesThresholds } from "./watched";

const USG = PM25_LEVELS[2];

test("the line sits at the level's lower bound with its name and color", () => {
	expect(thresholdLine(USG)).toEqual({
		value: 35.5,
		color: "#ff7e00",
		label: "Unhealthy for Sensitive Groups"
	});
});

test("a saved key draws; Off draws nothing; a missing key draws nothing and is flagged", () => {
	expect(chartThreshold([{ level: "unhealthy_sensitive" }], PM25_LEVELS)).toEqual({
		line: thresholdLine(USG),
		missing: false
	});
	expect(chartThreshold(undefined, PM25_LEVELS)).toEqual({ line: null, missing: false });
	expect(chartThreshold([{ level: "gone" }], PM25_LEVELS)).toEqual({ line: null, missing: true });
	expect(chartThreshold([{ level: "gone" }], [])).toEqual({ line: null, missing: false });
});

test("a Chart with a saved threshold is not watched", () => {
	expect(chartType.thresholds).toBe(true);
	expect(
		watchesThresholds({
			id: "c",
			type: "chart",
			title: null,
			rect: { x: 0, y: 0, w: 3, h: 6 },
			data: { layers: [] },
			thresholds: [{ level: "unhealthy_sensitive" }]
		})
	).toBe(false);
});
