import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@sjvair/sdk", async (importOriginal) => ({
	...(await importOriginal<typeof import("@sjvair/sdk")>()),
	getActivePesticideNotices: vi.fn(),
	getPesticidesMeta: vi.fn(),
	getChemicalDetails: vi.fn(),
	getCommodityDetails: vi.fn(),
	getProductDetails: vi.fn()
}));

import {
	getActivePesticideNotices,
	getChemicalDetails,
	getCommodityDetails,
	getPesticidesMeta
} from "@sjvair/sdk";
import { resetPesticideMeta } from "$lib/data/pesticide-meta";
import type { PesticideFilters, WidgetDataConfig } from "$lib/data/schema";
import type { NowSource } from "$lib/data/now/client";
import { addDays, pacificDay, todayPacific } from "$lib/format";
import { NOTICES_SCALE, noticesEntry, noticesPolls, type NoticesData } from "./notices";

type Src = NowSource<NoticesData>;

const META = {
	categories: [{ key: "carcinogen", label: "Carcinogen", description: "", in_use: true }],
	iarc_groups: [{ key: "1", label: "Group 1", description: "" }],
	methods: [{ key: "A", label: "Aerial" }],
	narrows: [{ key: "concern", label: "Chemicals of concern", description: "" }],
	placeholder_chemicals: [],
	notice_filters: [
		"chemical_id",
		"product_id",
		"category",
		"iarc_group",
		"narrow",
		"aerial_ground"
	],
	/** The server's one-level category scale for the notice marker (its value isn't its key). */
	scales: {
		"spray-notice": {
			id: "spray-notice",
			label: "Spray Notices",
			kind: "category",
			levels: [{ key: "notice", label: "Spray notice", color: "#e64980", value: "notice-level" }]
		}
	}
};

function notFound(): Error {
	return new Error("Not found", { cause: { result: { status: 404 } } });
}

const data = (filters?: PesticideFilters): WidgetDataConfig => ({
	layers: [
		{ dataset: "air-quality", entryType: "pm25" },
		{ dataset: "pesticide-notices", ...(filters && { filters }) }
	]
});

const notice = (id: string, section: string | null, scheduled: string, past?: boolean) => ({
	type: "Feature",
	id,
	geometry: { type: "Point", coordinates: [-119.5, 36.5] },
	properties: {
		id,
		scheduled_application: scheduled,
		scheduled_end: scheduled,
		county: "Fresno",
		application_method: "Ground",
		aerial_ground: "G",
		treated_amount: 10,
		treated_units: "A",
		section: section && `Section ${section}`,
		section_id: section,
		products: [{ id: "p1", name: "Product" }],
		chemicals: [{ id: "c1", name: "CHEM", display_name: "Chem", is_of_concern: true }],
		...(past !== undefined && { past })
	}
});

const messages = ((key: string) => key) as never;

async function sourceOf(at: "now" | { day: string }, filters?: PesticideFilters): Promise<Src> {
	const source = await noticesEntry.source({ data: data(filters), entryType: "pm25", at });
	if (!source || !("fetch" in source)) throw new Error("no source");
	return source;
}

beforeEach(() => {
	vi.resetAllMocks();
	resetPesticideMeta();
	vi.mocked(getPesticidesMeta).mockResolvedValue(META as never);
	vi.mocked(getActivePesticideNotices).mockResolvedValue({
		type: "FeatureCollection",
		as_of: "",
		features: []
	} as never);
});

describe("noticesEntry", () => {
	it("loads nothing without the notices layer", async () => {
		const source = await noticesEntry.source({
			data: { layers: [{ dataset: "air-quality", entryType: "pm25" }] },
			entryType: "pm25",
			at: "now"
		});
		expect(source).toBeNull();
	});

	it("groups by section", async () => {
		vi.mocked(getActivePesticideNotices).mockResolvedValue({
			type: "FeatureCollection",
			as_of: "",
			features: [
				notice("n1", "s1", "2026-11-16T09:00:00-08:00"),
				notice("n2", "s2", "2026-11-15T09:00:00-08:00"),
				notice("n3", "s1", "2026-11-14T09:00:00-08:00")
			]
		} as never);
		const source = await sourceOf({ day: "2026-11-16" });
		const value = await source.fetch(new AbortController().signal);
		const out = noticesEntry.toDataSources(value, { messages, entryType: "pm25" });
		expect(Object.keys(out)).toEqual(["notices"]);
		// One stable ScaleRef: map-sdk matches a resolved scale to its source's by identity.
		expect(out.notices.scale).toBe(NOTICES_SCALE);
		expect(NOTICES_SCALE).toEqual({ dataset: "pesticide-notices", entryType: "spray-notice" });
		const features = out.notices.features!.features;
		expect(features).toHaveLength(2);
		const s1 = features.find((f) => f.properties.refKey === "feature:s1")!;
		const s2 = features.find((f) => f.properties.refKey === "feature:s2")!;
		expect(s1.properties.count).toBe(2);
		expect(s2.properties.count).toBe(1);
		// The value matches the scale's one level (its `value` from the meta, not its key).
		expect(s1.properties.value).toBe("notice-level");
		expect(s2.properties.value).toBe("notice-level");
		expect(s1.properties.notices.map((n) => n.id)).toEqual(["n3", "n1"]);
		expect(s1.properties.name).toBe("2 spray notices, Section s1, Fresno");
		expect(s2.properties.name).toBe("1 spray notice, Section s2, Fresno");
		expect(s1.geometry).toEqual({ type: "Point", coordinates: [-119.5, 36.5] });
		expect(s1.properties.notices[0]).toEqual({
			id: "n3",
			scheduled: "2026-11-14T09:00:00-08:00",
			scheduledEnd: "2026-11-14T09:00:00-08:00",
			method: "Ground",
			methodKey: "G",
			amount: 10,
			units: "A",
			county: "Fresno",
			section: "Section s1",
			sectionId: "s1",
			coordinates: [-119.5, 36.5],
			products: [{ id: "p1", name: "Product" }],
			chemicals: [{ id: "c1", name: "Chem", ofConcern: true }]
		});
	});

	it("carries past on a day, and leaves out notices with no location", async () => {
		const placeless = { ...notice("n9", "s9", "2026-11-14T09:00:00-08:00", true), geometry: null };
		vi.mocked(getActivePesticideNotices).mockResolvedValue({
			type: "FeatureCollection",
			as_of: "",
			features: [notice("n1", "s1", "2026-11-14T09:00:00-08:00", true), placeless]
		} as never);
		const value = await (await sourceOf({ day: "2026-11-16" })).fetch(new AbortController().signal);
		expect(value.notices.map((n) => [n.id, n.past])).toEqual([["n1", true]]);
	});

	it("without the meta's spray-notice scale a marker has no value (drawn neutral)", async () => {
		vi.mocked(getPesticidesMeta).mockResolvedValue({ ...META, scales: {} } as never);
		vi.mocked(getActivePesticideNotices).mockResolvedValue({
			type: "FeatureCollection",
			as_of: "",
			features: [notice("n1", "s1", "2026-11-14T09:00:00-08:00")]
		} as never);
		const value = await (await sourceOf("now")).fetch(new AbortController().signal);
		const out = noticesEntry.toDataSources(value, { messages, entryType: "pm25" });
		expect(out.notices.features!.features[0].properties.value).toBeNull();
		expect(out.notices.scale).toBe(NOTICES_SCALE);
	});

	it("a notice with no section is a marker of its own", async () => {
		vi.mocked(getActivePesticideNotices).mockResolvedValue({
			type: "FeatureCollection",
			as_of: "",
			features: [
				notice("n1", null, "2026-11-14T09:00:00-08:00"),
				notice("n2", null, "2026-11-15T09:00:00-08:00")
			]
		} as never);
		const value = await (await sourceOf("now")).fetch(new AbortController().signal);
		const out = noticesEntry.toDataSources(value, { messages, entryType: "pm25" });
		const features = out.notices.features!.features;
		expect(features.map((f) => f.properties.refKey)).toEqual(["feature:n1", "feature:n2"]);
		expect(features[0].properties.name).toBe("1 spray notice, Fresno");
	});

	it("a marker is named by whichever of section and county the server gives", async () => {
		const withCounty = (n: ReturnType<typeof notice>, county: string | null) => ({
			...n,
			properties: { ...n.properties, county }
		});
		vi.mocked(getActivePesticideNotices).mockResolvedValue({
			type: "FeatureCollection",
			as_of: "",
			features: [
				withCounty(notice("n1", "s1", "2026-11-14T09:00:00-08:00"), null),
				withCounty(notice("n2", "s1", "2026-11-15T09:00:00-08:00"), null),
				withCounty(notice("n3", null, "2026-11-15T09:00:00-08:00"), null),
				notice("n4", "s4", "2026-11-15T09:00:00-08:00")
			]
		} as never);
		const value = await (await sourceOf("now")).fetch(new AbortController().signal);
		const out = noticesEntry.toDataSources(value, { messages, entryType: "pm25" });
		expect(out.notices.features!.features.map((f) => f.properties.name)).toEqual([
			"2 spray notices, Section s1",
			"1 spray notice",
			"1 spray notice, Section s4, Fresno"
		]);
	});

	it("notices key includes filters", async () => {
		const plain = await sourceOf({ day: "2026-11-10" });
		const chem = await sourceOf({ day: "2026-11-10" }, { category: ["carcinogen"] });
		expect(plain.key).toBe("map-notices:2026-11-10|{}");
		expect(chem.key).not.toBe(plain.key);
		expect(chem.key).toMatch(/^map-notices:2026-11-10\|/);
		expect(chem.cadence).toBe("hour");
		// The same filters in another order are the same source.
		const a = await sourceOf({ day: "2026-11-10" }, { iarcGroup: "1", narrow: "concern" });
		const b = await sourceOf({ day: "2026-11-10" }, { narrow: "concern", iarcGroup: "1" });
		expect(a.key).toBe(b.key);
	});

	it("now is keyed by today's Pacific date", async () => {
		const source = await sourceOf("now");
		expect(source.key).toBe(`map-notices:${todayPacific()}|{}`);
	});

	it("now asks without a date, a day asks with it", async () => {
		const controller = new AbortController();
		await (await sourceOf("now")).fetch(controller.signal);
		expect(vi.mocked(getActivePesticideNotices).mock.calls[0][0]).toEqual({
			signal: controller.signal
		});
		await (await sourceOf({ day: "2026-11-10" })).fetch(controller.signal);
		expect(vi.mocked(getActivePesticideNotices).mock.calls[1][0]).toEqual({
			date: "2026-11-10",
			signal: controller.signal
		});
	});

	it("sends the filters notices take, and never the commodity", async () => {
		vi.mocked(getChemicalDetails).mockResolvedValue({ display_name: "Chem" } as never);
		vi.mocked(getCommodityDetails).mockResolvedValue({ display_name: "Grapes" } as never);
		const controller = new AbortController();
		const source = await sourceOf(
			{ day: "2026-11-10" },
			{ chemical: "c1", commodity: "k1", method: "A" }
		);
		await source.fetch(controller.signal);
		expect(vi.mocked(getActivePesticideNotices).mock.calls[0][0]).toEqual({
			date: "2026-11-10",
			chemical_id: "c1",
			aerial_ground: "A",
			signal: controller.signal
		});
	});

	it("filter-gone", async () => {
		vi.mocked(getChemicalDetails).mockRejectedValue(notFound());
		const source = await noticesEntry.source({
			data: data({ chemical: "gone" }),
			entryType: "pm25",
			at: "now"
		});
		expect(source).toEqual({ unavailable: "filter-gone" });
	});

	it("a code the meta no longer lists is filter-gone", async () => {
		const source = await noticesEntry.source({
			data: data({ category: ["retired"] }),
			entryType: "pm25",
			at: "now"
		});
		expect(source).toEqual({ unavailable: "filter-gone" });
	});

	it("a failed filter lookup still gives a source (the fetch shows the error)", async () => {
		vi.mocked(getChemicalDetails).mockRejectedValue(new Error("offline"));
		const source = await noticesEntry.source({
			data: data({ chemical: "c1" }),
			entryType: "pm25",
			at: "now"
		});
		expect(source && "fetch" in source).toBe(true);
	});
});

describe("noticesPolls", () => {
	const NOW = Date.parse("2026-11-16T19:10:00Z");
	const today = todayPacific(new Date(NOW));

	it("polls on now", () => {
		expect(noticesPolls("now", NOW)).toBe(true);
	});

	it("polls a day the server may still rewrite (four days back)", () => {
		expect(noticesPolls({ day: addDays(today, -4) }, NOW)).toBe(true);
		expect(noticesPolls({ day: today }, NOW)).toBe(true);
	});

	it("a settled day never polls", () => {
		expect(noticesPolls({ day: addDays(today, -5) }, NOW)).toBe(false);
		expect(noticesPolls({ day: addDays(today, -30) }, NOW)).toBe(false);
	});

	it("a day is settled at Pacific midnight starting its fifth day after", () => {
		const day = "2026-11-10";
		const settle = pacificDay("2026-11-15").getTime();
		expect(noticesPolls({ day }, settle - 1)).toBe(true);
		expect(noticesPolls({ day }, settle)).toBe(false);
	});

	it("settles at Pacific midnight across the change from daylight time", () => {
		// 2026-11-04 00:00 PST (after DST ended on 2026-11-01) is 08:00 UTC, not 07:00.
		const day = "2026-10-30";
		expect(noticesPolls({ day }, Date.parse("2026-11-04T07:30:00Z"))).toBe(true);
		expect(noticesPolls({ day }, Date.parse("2026-11-04T07:59:59.999Z"))).toBe(true);
		expect(noticesPolls({ day }, Date.parse("2026-11-04T08:00:00Z"))).toBe(false);
	});
});
