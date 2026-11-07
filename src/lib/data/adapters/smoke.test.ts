import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@sjvair/sdk", () => ({
	getSmokeForPlace: vi.fn()
}));

import { getSmokeForPlace } from "@sjvair/sdk";
import { resolveRange } from "$lib/format/range";
import { mapScaleLevels } from "../metadata";
import type { DateRangeSpec } from "../schema";
import { fixtureMetadata } from "../testing/fixtures";
import type { Target } from "../types";
import type { AdapterContext, AdapterRequest, RegionResolver } from "./registry";
import { smokeAdapter } from "./smoke";

const NOW = new Date("2026-11-05T19:00:00Z");

const SMOKE_LEVELS = mapScaleLevels(
	["light", "medium", "heavy"].map((key, i) => ({
		key,
		label: key[0].toUpperCase() + key.slice(1),
		color: "#888888",
		tier: i + 1,
		min: null,
		max: null,
		value: key,
		opacity: 0.2 + i / 10,
		description: "",
		guidance: ""
	}))
);

const regions: RegionResolver = {
	resolve: async (type, code) => {
		if (type === "county" && code === "06019") return { id: "sq1", name: "Fresno County" };
		if (type === "county" && code === "06029") return { id: "sq2", name: "Kern County" };
		return null;
	}
};

const ctx: AdapterContext = {
	metadata: fixtureMetadata({
		datasetLevels: async (dataset, entryType) =>
			dataset === "hms-smoke" && entryType === "smoke-density" ? SMOKE_LEVELS : []
	}),
	regions,
	locations: { resolve: async () => null },
	points: { keys: async () => [] }
};

function request(
	target: Target,
	spec: DateRangeSpec = { kind: "custom", start: "2026-11-02", end: "2026-11-05" }
): AdapterRequest {
	return {
		entryType: "smoke-density",
		target,
		resolution: "day",
		downsampleFromRaw: false,
		range: resolveRange(spec, NOW),
		offered: ["day"],
		worstHour: false,
		now: NOW
	};
}

function day(date: string, density: string | null) {
	return { date, density, coverage: { light: 0, medium: 0, heavy: 0 } };
}

function response(days: ReturnType<typeof day>[]) {
	return { place: { region: { type: "county", external_id: "06019", name: "Fresno" } }, days };
}

/** Every date from `gte` to `lte` inclusive (UTC arithmetic on date keys; no zone involved). */
function datesBetween(gte: string, lte: string): string[] {
	const out: string[] = [];
	for (let t = Date.parse(gte); t <= Date.parse(lte); t += 86_400_000) {
		out.push(new Date(t).toISOString().slice(0, 10));
	}
	return out;
}

const county: Target = { kind: "regions", keys: ["county:06019"] };

let signal: AbortSignal;

beforeEach(() => {
	vi.resetAllMocks();
	signal = new AbortController().signal;
});

describe("smokeAdapter", () => {
	it("offers only days, and overlays on anything", () => {
		expect(smokeAdapter.id).toBe("hms-smoke");
		expect(smokeAdapter.offered(["day", "month"], county)).toEqual(["day"]);
		expect(smokeAdapter.overlays?.({} as never)).toBe(true);
	});

	it("densities become day levels", async () => {
		vi.mocked(getSmokeForPlace).mockResolvedValue(
			response([
				day("2026-11-02", "light"),
				day("2026-11-03", "heavy"),
				day("2026-11-04", "medium")
			]) as never
		);
		const data = await smokeAdapter.fetch(request(county), ctx, signal);
		const points = data.series[0].points;
		expect(points.map((p) => p.level)).toEqual(["light", "heavy", "medium"]);
		expect(points.every((p) => Number.isNaN(p.mean) && Number.isNaN(p.min))).toBe(true);
		expect(points.every((p) => p.count === 1 && !p.partial)).toBe(true);
		// Pacific midnight of 2026-11-02 (PST).
		expect(points[0].t).toBe(Date.parse("2026-11-02T08:00:00Z"));
		expect(data.series[0].place).toBe("region:county:06019");
		expect(data.resolution).toBe("day");
		expect(vi.mocked(getSmokeForPlace).mock.calls[0][2]).toEqual({ signal });
	});

	it("null density makes no point", async () => {
		vi.mocked(getSmokeForPlace).mockResolvedValue(
			response([
				day("2026-11-02", null),
				day("2026-11-03", "light"),
				day("2026-11-04", null)
			]) as never
		);
		const data = await smokeAdapter.fetch(request(county), ctx, signal);
		expect(data.series[0].points.map((p) => p.level)).toEqual(["light"]);
	});

	it("a density the scale doesn't list is left out", async () => {
		vi.mocked(getSmokeForPlace).mockResolvedValue(
			response([day("2026-11-02", "extreme"), day("2026-11-03", "light")]) as never
		);
		const data = await smokeAdapter.fetch(request(county), ctx, signal);
		expect(data.series[0].points.map((p) => p.level)).toEqual(["light"]);
	});

	it("two-year range splits without gaps", async () => {
		vi.mocked(getSmokeForPlace).mockImplementation((async (_p: unknown, dates: never) => {
			const { gte, lte } = dates as { gte: string; lte: string };
			return response(datesBetween(gte, lte).map((d) => day(d, "light")));
		}) as never);
		const spec: DateRangeSpec = { kind: "custom", start: "2024-01-01", end: "2025-12-31" };
		const data = await smokeAdapter.fetch(request(county, spec), ctx, signal);
		const asks = vi.mocked(getSmokeForPlace).mock.calls.map((c) => c[1] as never) as {
			gte: string;
			lte: string;
		}[];
		expect(asks.length).toBeGreaterThan(1);
		let total = 0;
		for (const [i, ask] of asks.entries()) {
			const days = datesBetween(ask.gte, ask.lte).length;
			expect(days).toBeLessThanOrEqual(366);
			total += days;
			if (i > 0) {
				// Contiguous: this request starts the day after the last one ended.
				const prev = Date.parse(asks[i - 1].lte);
				expect(Date.parse(ask.gte)).toBe(prev + 86_400_000);
			}
		}
		expect(asks[0].gte).toBe("2024-01-01");
		expect(asks[asks.length - 1].lte).toBe("2025-12-31");
		expect(total).toBe(731);
		const points = data.series[0].points;
		expect(points).toHaveLength(731);
		expect(new Set(points.map((p) => p.t)).size).toBe(731);
	});

	it("several places, one request each", async () => {
		vi.mocked(getSmokeForPlace).mockResolvedValue(response([day("2026-11-02", "light")]) as never);
		const target: Target = { kind: "regions", keys: ["county:06019", "county:06029"] };
		const data = await smokeAdapter.fetch(request(target), ctx, signal);
		const calls = vi.mocked(getSmokeForPlace).mock.calls;
		expect(calls).toHaveLength(2);
		expect(calls.map((c) => c[0])).toEqual([
			{ region: { type: "county", external_id: "06019" } },
			{ region: { type: "county", external_id: "06029" } }
		]);
		expect(data.series.map((s) => s.place)).toEqual(["region:county:06019", "region:county:06029"]);
	});

	it("a fallback target asks its first region and names the place", async () => {
		vi.mocked(getSmokeForPlace).mockResolvedValue(response([day("2026-11-02", "light")]) as never);
		const target: Target = {
			kind: "fallback",
			via: { kind: "point" },
			keys: ["county:06019", "county:06029"]
		};
		const data = await smokeAdapter.fetch(request(target), ctx, signal);
		expect(vi.mocked(getSmokeForPlace)).toHaveBeenCalledTimes(1);
		expect(data.places[0]).toMatchObject({ name: "Fresno County", via: { kind: "point" } });
	});

	it("a 404 gives an empty series, not an error", async () => {
		vi.mocked(getSmokeForPlace).mockRejectedValue(
			new Error("failed", { cause: { result: { status: 404 } } })
		);
		const data = await smokeAdapter.fetch(request(county), ctx, signal);
		expect(data.series).toEqual([{ place: "region:county:06019", points: [] }]);
	});

	it("other failures reject", async () => {
		vi.mocked(getSmokeForPlace).mockRejectedValue(
			new Error("failed", { cause: { result: { status: 500 } } })
		);
		await expect(smokeAdapter.fetch(request(county), ctx, signal)).rejects.toThrow("failed");
	});

	it("doesn't support the whole layer", async () => {
		const result = await smokeAdapter.target(
			{ dataset: "hms-smoke", entryType: "smoke-density", place: { kind: "all" } } as never,
			ctx
		);
		expect(result).toEqual({ unavailable: "place-unsupported" });
	});
});
