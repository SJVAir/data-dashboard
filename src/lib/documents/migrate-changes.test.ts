import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { report } from "$lib/safety/report";
import type { Migration } from "./load";
import { upgradeChanges } from "./migrate-changes";
import { CURRENT_SCHEMA_VERSION } from "./schema";

vi.mock("$lib/safety/report", () => ({ report: vi.fn() }));

const START = CURRENT_SCHEMA_VERSION - 2;
const any = z.unknown();

function rename(from: number, to: number, mark: string): Migration {
	return {
		from,
		to,
		schema: any,
		migrate: (raw) => raw,
		migrateChange(change) {
			const c = change as { to: string | null; trail?: string[] };
			if (c.to === "drop") return null;
			if (c.to === "break") return { op: "nope" };
			return { ...c, trail: [...(c.trail ?? []), mark] };
		}
	};
}

const chain = [
	rename(START, START + 1, "first"),
	rename(START + 1, CURRENT_SCHEMA_VERSION, "second")
];

function change(to: string) {
	return { op: "setField", target: { path: "name" }, from: null, to };
}

describe("upgradeChanges", () => {
	it("a throwing migration drops the change and reports once", () => {
		vi.mocked(report).mockClear();
		const failure = new Error("bug");
		const throwing = [
			{
				...chain[0],
				migrateChange() {
					throw failure;
				}
			}
		];
		const result = upgradeChanges([change("A")], START, throwing);
		expect(result).toEqual({ changes: [], dropped: 1 });
		expect(report).toHaveBeenCalledTimes(1);
		expect(report).toHaveBeenCalledWith(failure, {
			operation: "migrate",
			fromSchemaVersion: START
		});
	});

	it("passes changes through every step in order", () => {
		const input = [Object.freeze(change("A"))];
		const calls: string[] = [];
		const spy = chain.map((m) => ({
			...m,
			migrateChange(c: unknown) {
				calls.push(`${m.from}`);
				return m.migrateChange(c);
			}
		}));
		const result = upgradeChanges(input, START, spy);
		expect(calls).toEqual([`${START}`, `${START + 1}`]);
		expect(result.dropped).toBe(0);
		expect(result.changes).toHaveLength(1);
		expect(result.changes[0]).toMatchObject({ op: "setField", to: "A" });
	});

	it("drops a change a step returns null for, and counts it", () => {
		const result = upgradeChanges([change("A"), change("drop")], START, chain);
		expect(result.changes).toHaveLength(1);
		expect(result.dropped).toBe(1);
	});

	it("drops a result that fails ChangeSchema", () => {
		const result = upgradeChanges([change("break"), change("A")], START, chain);
		expect(result.changes).toHaveLength(1);
		expect(result.dropped).toBe(1);
	});

	it("does not mutate its inputs", () => {
		const input = [Object.freeze({ ...change("A"), target: Object.freeze({ path: "name" }) })];
		expect(() => upgradeChanges(input, START, chain)).not.toThrow();
	});

	it("returns the parsed changes unchanged at the current version", () => {
		const input = [change("A"), { op: "bogus" }];
		const result = upgradeChanges(input, CURRENT_SCHEMA_VERSION, chain);
		expect(result.changes).toEqual([change("A")]);
		expect(result.dropped).toBe(1);
	});

	it("drops every change when a step is missing", () => {
		const result = upgradeChanges([change("A")], START, []);
		expect(result).toEqual({ changes: [], dropped: 1 });
	});
});
