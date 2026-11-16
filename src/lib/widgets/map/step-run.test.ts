import { describe, expect, it } from "vitest";
import { StepRun } from "./step-run";

describe("StepRun", () => {
	it("starts a run, continues it within the window, and starts again after it", () => {
		let t = 0;
		const run = new StepRun(1000, () => t);
		expect(run.next().amend).toBe(false);
		t = 900;
		expect(run.next().amend).toBe(true);
		t = 1800;
		expect(run.next().amend).toBe(true);
		t = 2900;
		expect(run.next().amend).toBe(false);
	});

	it("continues a step exactly at the window and starts again just past it", () => {
		let t = 0;
		const run = new StepRun(1000, () => t);
		run.next();
		t = 1000;
		expect(run.next().amend).toBe(true);
		t = 2001;
		expect(run.next().amend).toBe(false);
	});

	it("end() closes the run", () => {
		let t = 0;
		const run = new StepRun(1000, () => t);
		run.next();
		t = 10;
		run.end();
		expect(run.next().amend).toBe(false);
	});
});
