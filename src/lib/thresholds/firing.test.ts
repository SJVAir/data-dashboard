import { describe, expect, it } from "vitest";
import type { Level } from "$lib/data/metadata";
import { REARM_MS, decide } from "./firing";

const levels: Level[] = ["good", "moderate", "unhealthy_sensitive", "unhealthy"].map((key, i) => ({
	key,
	label: key,
	color: null,
	opacity: null,
	tier: i,
	guidance: "",
	description: "",
	min: i * 10,
	max: i === 3 ? null : i * 10 + 10
}));
const usg = levels[2];
const T = 1_000_000_000;
const read = (level: string, at = T) => ({ level, at });

describe("decide", () => {
	it("first reading only sets the starting point", () => {
		const a = decide(undefined, read("unhealthy"), usg, levels);
		expect(a.fire).toBe(false);
		expect(a.told.level).toBe("unhealthy");
		const b = decide(undefined, read("moderate"), usg, levels);
		expect(b.fire).toBe(false);
		expect(b.told.level).toBeNull();
	});
	it("fires once on reaching the threshold", () => {
		const a = decide({ level: null, at: T - 1000 }, read("unhealthy_sensitive"), usg, levels);
		expect(a.fire).toBe(true);
		const b = decide(a.told, read("unhealthy_sensitive", T + 1000), usg, levels);
		expect(b.fire).toBe(false);
	});
	it("fires again only when worse", () => {
		const r = decide(
			{ level: "unhealthy_sensitive", at: T - 1000 },
			read("unhealthy"),
			usg,
			levels
		);
		expect(r.fire).toBe(true);
		expect(r.told.level).toBe("unhealthy");
	});
	it("never on improvement", () => {
		const told = { level: "unhealthy", at: T - 1000 };
		const r = decide(told, read("unhealthy_sensitive"), usg, levels);
		expect(r.fire).toBe(false);
		expect(r.told).toEqual(told);
	});
	it("re-arms on a below value at least 2 h after the last toast", () => {
		const told = { level: "unhealthy_sensitive", at: T };
		const r = decide(told, read("moderate", T + REARM_MS), usg, levels);
		expect(r.told).toEqual({ level: null, at: T + REARM_MS });
		const soon = decide(told, read("moderate", T + REARM_MS - 60_000), usg, levels);
		expect(soon.told).toEqual(told);
	});
	it("a reopened tab already at the level shows no toast", () => {
		const told = { level: "unhealthy_sensitive", at: T - 24 * 3600_000 };
		const r = decide(told, read("unhealthy_sensitive"), usg, levels);
		expect(r.fire).toBe(false);
	});
	it("ignores a level key the scale lacks", () => {
		const told = { level: null, at: T - 1000 };
		const r = decide(told, read("mystery"), usg, levels);
		expect(r).toEqual({ fire: false, told });
	});
});
