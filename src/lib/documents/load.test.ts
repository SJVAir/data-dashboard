import { describe, expect, it } from "vitest";
import { z } from "zod";
import { loadDashboard, type Migration } from "./load";
import { CURRENT_SCHEMA_VERSION } from "./schema";

const valid = {
	kind: "dashboard",
	schemaVersion: CURRENT_SCHEMA_VERSION,
	id: "d1",
	name: null,
	version: 0,
	createdAt: "2026-10-20T00:00:00Z",
	updatedAt: "2026-10-20T00:00:00Z",
	body: { widgets: [] }
};

const V0Schema = z.object({ schemaVersion: z.literal(0), label: z.string() }).passthrough();

function v0Doc() {
	const { name, ...rest } = valid;
	void name;
	return { ...rest, schemaVersion: 0, label: "Old name" };
}

const renameChain: Migration[] = [
	{
		from: 0,
		to: 1,
		schema: V0Schema,
		migrate(raw) {
			const { label, ...rest } = raw as Record<string, unknown>;
			return { ...rest, schemaVersion: 1, name: label };
		}
	}
];

describe("loadDashboard", () => {
	it("current version loads ok, upgraded false", () => {
		const result = loadDashboard(valid);
		expect(result.status).toBe("ok");
		if (result.status === "ok") expect(result.upgraded).toBe(false);
	});

	it("newer schemaVersion loads read-only", () => {
		const raw = { ...valid, schemaVersion: 99 };
		const result = loadDashboard(raw);
		expect(result).toEqual({ status: "read-only", reason: "newer", raw });
	});

	it("invalid document loads read-only without throwing", () => {
		for (const raw of [{ kind: "dashboard" }, null, "x"]) {
			const result = loadDashboard(raw);
			expect(result).toEqual({ status: "read-only", reason: "invalid", raw });
		}
	});

	it("runs the chain step by step and validates the result", () => {
		const result = loadDashboard(v0Doc(), renameChain);
		expect(result.status).toBe("ok");
		if (result.status === "ok") {
			expect(result.upgraded).toBe(true);
			expect(result.doc.name).toBe("Old name");
			expect(result.doc.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
		}
	});

	it("a migration that produces an invalid document is read-only invalid", () => {
		const bad: Migration[] = [{ ...renameChain[0], migrate: () => ({ schemaVersion: 1 }) }];
		const raw = v0Doc();
		expect(loadDashboard(raw, bad)).toEqual({ status: "read-only", reason: "invalid", raw });
	});

	it("missing step is read-only invalid", () => {
		const raw = { ...valid, schemaVersion: -1 };
		expect(loadDashboard(raw, renameChain)).toEqual({
			status: "read-only",
			reason: "invalid",
			raw
		});
	});
});
