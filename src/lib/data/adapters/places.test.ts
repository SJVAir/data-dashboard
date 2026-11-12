import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@sjvair/sdk", () => ({ getLocationsByCode: vi.fn(), lookupRegionPlace: vi.fn() }));

import { getLocationsByCode, lookupRegionPlace } from "@sjvair/sdk";
import { createWebLocationResolver, createWebPointResolver } from "./places";

type Ref = { type: string; external_id: string; name: string } | null;

/** A location as `getLocationsByCode` returns it; only the fields the resolver reads matter. */
function location(
	code: string,
	regions: { zipcode?: Ref; city?: Ref; county?: Ref },
	opts: {
		aliases?: string[];
		retired?: {
			since: string;
			replaced_by: { source: string; external_id: string } | null;
		} | null;
	} = {}
) {
	return {
		id: `loc-${code}`,
		source: "cde-public",
		external_id: code,
		aliases: opts.aliases ?? [],
		type: "public_school",
		name: `School ${code}`,
		address: "",
		city_name: "",
		zip: "",
		point: { lat: 0, lng: 0 },
		regions: {
			county: regions.county ?? null,
			city: regions.city ?? null,
			zipcode: regions.zipcode ?? null,
			school_district: null
		},
		retired: opts.retired ?? null
	};
}

const ref = (type: string, code: string): Ref => ({ type, external_id: code, name: code });

const SCHOOLS: Record<string, ReturnType<typeof location>> = {
	"1": location("1", {
		county: ref("county", "06019"),
		city: ref("city", "0627000"),
		zipcode: ref("zipcode", "93702")
	}),
	"2": location("2", { county: ref("county", "06019") }, { aliases: ["2b"] }),
	"3": location(
		"3",
		{ zipcode: ref("zipcode", "93721"), county: ref("county", "06019") },
		{
			retired: {
				since: "2026-06-30",
				replaced_by: { source: "cde-public", external_id: "1" }
			}
		}
	)
};

beforeEach(() => {
	vi.resetAllMocks();
	vi.mocked(getLocationsByCode).mockImplementation(
		async (_source, codes) =>
			Object.values(SCHOOLS).filter(
				(s) => codes.includes(s.external_id) || s.aliases.some((a) => codes.includes(a))
			) as never
	);
});

describe("createWebLocationResolver", () => {
	it("maps a location's ZIP, city and county to keys in that order", async () => {
		expect(await createWebLocationResolver().resolve("cde-public", "1")).toEqual({
			name: "School 1",
			keys: ["zipcode:93702", "city:0627000", "county:06019"],
			details: { type: "public_school", city: "", zip: "", address: "" },
			point: { lat: 0, lon: 0 }
		});
		expect(getLocationsByCode).toHaveBeenCalledExactlyOnceWith("cde-public", ["1"]);
	});

	it("leaves out the regions a location lacks", async () => {
		expect(await createWebLocationResolver().resolve("cde-public", "2")).toEqual({
			name: "School 2",
			keys: ["county:06019"],
			details: { type: "public_school", city: "", zip: "", address: "" },
			point: { lat: 0, lon: 0 }
		});
	});

	it("resolvedLocation carries the point", async () => {
		vi.mocked(getLocationsByCode).mockResolvedValueOnce([
			{ ...SCHOOLS["1"], point: { lat: 36.7, lng: -119.8 } }
		] as never);
		const found = await createWebLocationResolver().resolve("cde-public", "1");
		expect(found?.point).toEqual({ lat: 36.7, lon: -119.8 });
	});

	it("matches a code that is one of the location's aliases", async () => {
		expect(await createWebLocationResolver().resolve("cde-public", "2b")).toMatchObject({
			name: "School 2"
		});
	});

	it("keeps a retired location's retirement", async () => {
		expect(await createWebLocationResolver().resolve("cde-public", "3")).toEqual({
			name: "School 3",
			keys: ["zipcode:93721", "county:06019"],
			details: { type: "public_school", city: "", zip: "", address: "" },
			point: { lat: 0, lon: 0 },
			retired: { since: "2026-06-30", replacedBy: { source: "cde-public", code: "1" } }
		});
	});

	it("resolves a code the server doesn't know to null", async () => {
		expect(await createWebLocationResolver().resolve("cde-public", "999")).toBeNull();
	});

	it("resolves an unknown source to null without a request", async () => {
		expect(await createWebLocationResolver().resolve("schools", "1")).toBeNull();
		expect(getLocationsByCode).not.toHaveBeenCalled();
	});

	it("batches codes asked for in the same tick, one request per source", async () => {
		const resolver = createWebLocationResolver();
		const found = await Promise.all([
			resolver.resolve("cde-public", "1"),
			resolver.resolve("cde-public", "2"),
			resolver.resolve("cdss-ccl", "1")
		]);
		expect(found.map((f) => f?.name)).toEqual(["School 1", "School 2", "School 1"]);
		expect(getLocationsByCode).toHaveBeenCalledTimes(2);
		expect(getLocationsByCode).toHaveBeenCalledWith("cde-public", ["1", "2"]);
		expect(getLocationsByCode).toHaveBeenCalledWith("cdss-ccl", ["1"]);
	});

	it("sends at most 100 codes per request", async () => {
		const resolver = createWebLocationResolver();
		await Promise.all(
			Array.from({ length: 150 }, (_, i) => resolver.resolve("cde-public", `${i}`))
		);
		const sizes = vi.mocked(getLocationsByCode).mock.calls.map(([, codes]) => codes.length);
		expect(sizes).toEqual([100, 50]);
	});

	it("caches each code, including an unknown one", async () => {
		const resolver = createWebLocationResolver();
		await resolver.resolve("cde-public", "1");
		await resolver.resolve("cde-public", "999");
		await resolver.resolve("cde-public", "1");
		await resolver.resolve("cde-public", "999");
		expect(getLocationsByCode).toHaveBeenCalledTimes(2);
	});

	it("retries a failed lookup on the next call", async () => {
		const resolver = createWebLocationResolver();
		vi.mocked(getLocationsByCode).mockRejectedValueOnce(new Error("offline"));
		await expect(resolver.resolve("cde-public", "1")).rejects.toThrow("offline");
		expect(await resolver.resolve("cde-public", "1")).toMatchObject({ name: "School 1" });
	});

	it("rejects only the caller whose signal aborts", async () => {
		const resolver = createWebLocationResolver();
		const controller = new AbortController();
		const aborted = resolver.resolve("cde-public", "1", controller.signal);
		const other = resolver.resolve("cde-public", "1");
		controller.abort();
		await expect(aborted).rejects.toMatchObject({ name: "AbortError" });
		expect(await other).toMatchObject({ name: "School 1" });
	});
});

describe("createWebPointResolver", () => {
	const item = (type: string, code: string | null) => ({
		id: `sq-${code}`,
		name: `${code}`,
		slug: `${code}`,
		type,
		external_id: code,
		retired: null,
		boundary: null
	});

	beforeEach(() => {
		vi.mocked(lookupRegionPlace).mockResolvedValue([
			item("county", "06019"),
			item("zipcode", "93721"),
			item("city", "0627000")
		] as never);
	});

	it("looks up ZIP, city and county and orders the keys", async () => {
		expect(await createWebPointResolver().keys(36.7371, -119.7871)).toEqual([
			"zipcode:93721",
			"city:0627000",
			"county:06019"
		]);
		expect(lookupRegionPlace).toHaveBeenCalledExactlyOnceWith({
			lat: 36.737,
			lon: -119.787,
			type: ["zipcode", "city", "county"]
		});
	});

	it("leaves out types the point isn't in and regions without a code", async () => {
		vi.mocked(lookupRegionPlace).mockResolvedValue([
			item("county", "06019"),
			item("zipcode", null)
		] as never);
		expect(await createWebPointResolver().keys(36.7, -119.8)).toEqual(["county:06019"]);
	});

	it("returns no keys for a point outside every region", async () => {
		vi.mocked(lookupRegionPlace).mockResolvedValue([] as never);
		expect(await createWebPointResolver().keys(45, -100)).toEqual([]);
	});

	it("looks each rounded point up once", async () => {
		const resolver = createWebPointResolver();
		await resolver.keys(36.7371, -119.7871);
		await resolver.keys(36.7369, -119.7869);
		expect(lookupRegionPlace).toHaveBeenCalledTimes(1);
		await resolver.keys(36.738, -119.787);
		expect(lookupRegionPlace).toHaveBeenCalledTimes(2);
	});

	it("retries a failed lookup, and its error never names the point", async () => {
		const resolver = createWebPointResolver();
		vi.mocked(lookupRegionPlace).mockRejectedValueOnce(new Error("Request failed"));
		const error = await resolver.keys(36.7371, -119.7871).then(
			() => null,
			(e: unknown) => e as Error
		);
		expect(error).toBeInstanceOf(Error);
		expect(String(error?.message)).not.toMatch(/36\.7|119\.7/);
		expect(await resolver.keys(36.7371, -119.7871)).toHaveLength(3);
	});

	it("rejects only the caller whose signal aborts", async () => {
		const resolver = createWebPointResolver();
		const controller = new AbortController();
		const aborted = resolver.keys(36.7, -119.8, controller.signal);
		const other = resolver.keys(36.7, -119.8);
		controller.abort();
		await expect(aborted).rejects.toMatchObject({ name: "AbortError" });
		expect(await other).toHaveLength(3);
	});
});
