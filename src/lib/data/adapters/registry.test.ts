import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@sjvair/sdk", () => ({ getRegionsByCode: vi.fn() }));

import { getRegionsByCode } from "@sjvair/sdk";
import { createWebRegionResolver } from "./registry";

/** A region as `getRegionsByCode` returns it; only `id` and `external_id` matter here. */
function region(id: string, code: string, retired: { since: string } | null = null) {
	return {
		id,
		name: `Region ${code}`,
		slug: `region-${code}`,
		type: "county",
		external_id: code,
		retired: retired && { ...retired, replaced_by: null },
		boundary: null
	};
}

const COUNTIES: Record<string, ReturnType<typeof region>> = {
	"06019": region("r6phe", "06019"),
	"06039": region("r2mad", "06039"),
	"06099": region("rOld1", "06099", { since: "2026-01-01T00:00:00Z" })
};

beforeEach(() => {
	vi.resetAllMocks();
	vi.mocked(getRegionsByCode).mockImplementation(
		async (_type, codes) => codes.flatMap((c) => (COUNTIES[c] ? [COUNTIES[c]] : [])) as never
	);
});

describe("createWebRegionResolver", () => {
	it("resolves a code to the region's sqid", async () => {
		expect(await createWebRegionResolver().resolve("county", "06019")).toBe("r6phe");
		expect(getRegionsByCode).toHaveBeenCalledExactlyOnceWith("county", ["06019"]);
	});

	it("leaves a code the server doesn't know unresolved", async () => {
		expect(await createWebRegionResolver().resolve("county", "99999")).toBeNull();
	});

	it("still resolves a retired region", async () => {
		expect(await createWebRegionResolver().resolve("county", "06099")).toBe("rOld1");
	});

	it("reports land-use regions as unsupported without a request", async () => {
		expect(await createWebRegionResolver().resolve("land_use", "x")).toBe("unsupported");
		expect(getRegionsByCode).not.toHaveBeenCalled();
	});

	it("reports a region type the SDK doesn't know as unsupported without a request", async () => {
		expect(await createWebRegionResolver().resolve("watershed", "18030009")).toBe("unsupported");
		expect(getRegionsByCode).not.toHaveBeenCalled();
	});

	it("caches each code for the resolver's lifetime", async () => {
		const resolver = createWebRegionResolver();
		await resolver.resolve("county", "06019");
		await resolver.resolve("county", "99999");
		expect(await resolver.resolve("county", "06019")).toBe("r6phe");
		expect(await resolver.resolve("county", "99999")).toBeNull();
		expect(getRegionsByCode).toHaveBeenCalledTimes(2);
	});

	it("batches codes asked for together, one request per type", async () => {
		const resolver = createWebRegionResolver();
		const ids = await Promise.all([
			resolver.resolve("county", "06019"),
			resolver.resolve("county", "06039"),
			resolver.resolve("county", "06019"),
			resolver.resolve("city", "0627000")
		]);
		expect(ids).toEqual(["r6phe", "r2mad", "r6phe", null]);
		expect(getRegionsByCode).toHaveBeenCalledTimes(2);
		expect(getRegionsByCode).toHaveBeenCalledWith("county", ["06019", "06039"]);
		expect(getRegionsByCode).toHaveBeenCalledWith("city", ["0627000"]);
	});

	it("splits a batch into requests of at most 100 codes", async () => {
		const resolver = createWebRegionResolver();
		const codes = Array.from({ length: 150 }, (_, i) => String(i).padStart(5, "0"));
		await Promise.all(codes.map((c) => resolver.resolve("tract", c)));
		const sizes = vi.mocked(getRegionsByCode).mock.calls.map(([, c]) => c.length);
		expect(sizes).toEqual([100, 50]);
	});

	it("propagates errors and retries on the next call", async () => {
		vi.mocked(getRegionsByCode).mockRejectedValueOnce(new Error("boom"));
		const resolver = createWebRegionResolver();
		await expect(resolver.resolve("county", "06019")).rejects.toThrow("boom");
		expect(await resolver.resolve("county", "06019")).toBe("r6phe");
		expect(getRegionsByCode).toHaveBeenCalledTimes(2);
	});

	it("rejects only an aborted caller", async () => {
		const resolver = createWebRegionResolver();
		const ctrl = new AbortController();
		const aborted = resolver.resolve("county", "06019", ctrl.signal);
		const other = resolver.resolve("county", "06019");
		ctrl.abort();
		await expect(aborted).rejects.toMatchObject({ name: "AbortError" });
		expect(await other).toBe("r6phe");
		expect(getRegionsByCode).toHaveBeenCalledTimes(1);
	});
});
