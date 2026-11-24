import { flushSync } from "svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@sjvair/sdk", async (importOriginal) => ({
	...(await importOriginal<typeof import("@sjvair/sdk")>()),
	getPesticideTownships: vi.fn(),
	getPesticideSections: vi.fn(),
	getPesticidesMeta: vi.fn(),
	getChemicalDetails: vi.fn(),
	getCommodityDetails: vi.fn(),
	getProductDetails: vi.fn()
}));

import {
	getChemicalDetails,
	getPesticideSections,
	getPesticideTownships,
	getPesticidesMeta
} from "@sjvair/sdk";
import type { Bounds } from "@sjvair/map-sdk";
import { encodeRef, type DataSource, type ScaleRef } from "@sjvair/map-sdk/data";
import { resetPesticideMeta } from "$lib/data/pesticide-meta";
import { PESTICIDE_USE } from "../options";
import { resetUseCaches, useQueryKey, type UseProps, type UseQuery } from "./use";
import { UseBlock, type UseBlockInput } from "./use-block.svelte";
import { useScaleFor, useScaleRef } from "./use-scale";

const flush = () => vi.advanceTimersByTimeAsync(0);

const INFO = { label: "Pounds Applied", units: "lbs", precision: 0 };
const CLASS = { breaks: [10, 100], min: 1, colors: ["#111111", "#222222"] };
const CLASSES = { lbs_chemical: CLASS, acres_treated: CLASS, applications: CLASS };

/** A synthetic square at (x, y), `size` on a side. */
const square = (x: number, y: number, size = 1) => ({
	type: "Polygon" as const,
	coordinates: [
		[
			[x, y],
			[x + size, y],
			[x + size, y + size],
			[x, y + size],
			[x, y]
		]
	]
});

const totals = (n: number) => ({
	lbs_chemical: n,
	lbs_product: n,
	acres_treated: n,
	applications: n * 10
});

/** A row of synthetic townships, side by side: T-0 at x 0, T-1 at x 0.1 and so on. */
const IDS = ["T-0", "T-1", "T-2", "T-3", "T-4"];
function townships(geometry: boolean) {
	return {
		type: "FeatureCollection",
		year: 2023,
		classes: CLASSES,
		features: IDS.map((id, i) => ({
			type: "Feature",
			id,
			geometry: geometry ? square(i * 0.1, 0, 0.1) : null,
			properties: { id, name: id, sections: 36, ...totals(i + 1) }
		}))
	};
}

function sections(id = "s1") {
	return {
		type: "FeatureCollection",
		year: 2023,
		classes: CLASSES,
		features: [
			{
				type: "Feature",
				id,
				geometry: square(0.01, 0.01, 0.01),
				properties: { id, mtrs: "T-0-01", county: null, ...totals(5) }
			}
		]
	};
}

function badRequest(): Error {
	return new Error("Request failed", {
		cause: { result: { status: 400, body: { error: "bbox too large; zoom in" } } }
	});
}

const query = (period: UseQuery["period"] = { year: 2023, month: null }): UseQuery => ({
	figure: "pounds-applied",
	period,
	filters: {},
	info: INFO
});

const VIEW: Bounds = { west: 0, south: 0, east: 0.1, north: 0.1 };

function setup(first: Partial<UseBlockInput> = {}) {
	let input = $state.raw<UseBlockInput>({
		on: true,
		query: query(),
		bounds: VIEW,
		zoom: 9,
		sectionZoom: 11,
		lensCenter: null,
		...first
	});
	const block = new UseBlock(() => input);
	flushSync();
	return {
		block,
		input: () => input,
		set(next: Partial<UseBlockInput>) {
			input = { ...input, ...next };
			flushSync();
		}
	};
}

const townshipCalls = () => vi.mocked(getPesticideTownships).mock.calls.map((c) => c[0]);
const sectionCalls = () =>
	vi.mocked(getPesticideSections).mock.calls.map((c) => c[0] as { bbox: number[] });
const ref = (id: string) => encodeRef({ kind: "feature", id: `township:${id}` });

/** A use ref a source exposes is one whose scale was registered first. */
function expectRegistered(source: DataSource<UseProps>) {
	const scale = source.scale as ScaleRef | null;
	if (scale && "dataset" in scale && scale.dataset === PESTICIDE_USE) {
		expect(useScaleFor(scale)).toBeDefined();
	}
}

beforeEach(() => {
	vi.useFakeTimers();
	resetUseCaches();
	resetPesticideMeta();
	vi.mocked(getPesticidesMeta).mockReset();
	vi.mocked(getPesticidesMeta).mockResolvedValue({ years: [2023] } as never);
	vi.mocked(getPesticideTownships).mockReset();
	vi.mocked(getPesticideTownships).mockImplementation(
		async (params) => townships(params?.geometry !== false) as never
	);
	vi.mocked(getPesticideSections).mockReset();
	vi.mocked(getPesticideSections).mockImplementation(async () => sections() as never);
});
afterEach(() => vi.useRealTimers());

describe("UseBlock", () => {
	it("an unlisted period asks for nothing", async () => {
		const t = setup({
			query: query({ year: 2017, month: null }),
			zoom: 12,
			lensCenter: ref("T-0")
		});
		const before = structuredClone(t.input().query);
		await vi.advanceTimersByTimeAsync(1000);
		expect(getPesticideTownships).not.toHaveBeenCalled();
		expect(getPesticideSections).not.toHaveBeenCalled();
		expect(t.block.townshipsState).toBe("no-data");
		expect(t.input().query).toEqual(before);
		// The legend still has a scale to hang its note on: an empty one, registered.
		expect(t.block.townships.scale).not.toBeNull();
		expectRegistered(t.block.townships);
		t.block.destroy();
	});

	it("loads the valley's townships with their scale", async () => {
		const t = setup();
		expect(t.block.townshipsState).toBe("loading");
		await flush();
		expect(t.block.townshipsState).toBe("ready");
		expect(t.block.townships.status).toEqual({ state: "ready" });
		expect(t.block.townships.features?.features).toHaveLength(IDS.length);
		expectRegistered(t.block.townships);
		expect(townshipCalls()).toHaveLength(1);
		t.block.destroy();
	});

	it("sections load only at section zoom, padded, and not again inside the loaded bounds", async () => {
		const t = setup();
		await flush();
		await vi.advanceTimersByTimeAsync(1000);
		expect(getPesticideSections).not.toHaveBeenCalled();

		t.set({ zoom: 11 });
		await vi.advanceTimersByTimeAsync(299);
		expect(getPesticideSections).not.toHaveBeenCalled();
		await vi.advanceTimersByTimeAsync(1);
		expect(sectionCalls()).toHaveLength(1);
		// Padded by half the view on every side.
		const [w, s, e, n] = sectionCalls()[0].bbox as number[];
		expect([w, s, e, n].map((x) => Math.round(x * 1000) / 1000)).toEqual([
			-0.05, -0.05, 0.15, 0.15
		]);
		await flush();
		expect(t.block.sections.features?.features).toHaveLength(1);
		expectRegistered(t.block.sections);
		expect(t.block.townships.features).not.toBeNull();

		// Inside the loaded box: nothing new.
		t.set({ bounds: { west: 0.02, south: 0.02, east: 0.12, north: 0.12 } });
		await vi.advanceTimersByTimeAsync(1000);
		expect(sectionCalls()).toHaveLength(1);

		// Out of it: asked again.
		t.set({ bounds: { west: 1, south: 1, east: 1.1, north: 1.1 } });
		await vi.advanceTimersByTimeAsync(300);
		expect(sectionCalls()).toHaveLength(2);
		t.block.destroy();
	});

	it("a refused bbox falls back to townships", async () => {
		vi.mocked(getPesticideSections).mockRejectedValue(badRequest());
		const t = setup({ zoom: 11 });
		await vi.advanceTimersByTimeAsync(300);
		await flush();
		expect(sectionCalls()).toHaveLength(2);
		const [padded, unpadded] = sectionCalls().map((c) => c.bbox);
		expect(unpadded).toEqual([VIEW.west, VIEW.south, VIEW.east, VIEW.north]);
		expect(padded[0]).toBeLessThan(unpadded[0]);
		expect(t.block.refusedZoom).toBe(1);
		expect(t.block.sectionsFailed).toBe(false);
		expect(t.block.townships.features?.features).toHaveLength(IDS.length);
		t.block.destroy();
	});

	it("the lens loads its block after 50 ms, once per block", async () => {
		const t = setup();
		await flush();
		let release!: () => void;
		vi.mocked(getPesticideSections).mockImplementationOnce(
			() => new Promise((resolve) => (release = () => resolve(sections() as never)))
		);
		t.set({ lensCenter: ref("T-1") });
		await vi.advanceTimersByTimeAsync(49);
		expect(getPesticideSections).not.toHaveBeenCalled();
		await vi.advanceTimersByTimeAsync(1);
		expect(sectionCalls()).toHaveLength(1);
		// The 3 x 3 block (a row here): T-0, T-1 and T-2, so their union.
		const bbox = sectionCalls()[0].bbox.map((x) => Math.round(x * 1000) / 1000);
		expect(bbox).toEqual([0, 0, 0.3, 0.1]);
		// Lens features never blank the townships, even in flight.
		expect(t.block.townships.features).not.toBeNull();
		release();
		await flush();
		expect(t.block.lens.features?.features).toHaveLength(1);
		expectRegistered(t.block.lens);
		// The sections' ref: one legend section for the sections and the lens.
		expect(t.block.lens.scale).toBe(useScaleRef("pounds-applied", "section", useQueryKey(query())));

		// Away and back: the block is cached.
		t.set({ lensCenter: null });
		t.set({ lensCenter: ref("T-1") });
		await vi.advanceTimersByTimeAsync(100);
		expect(sectionCalls()).toHaveLength(1);
		// Another block loads, and the first block's features stay.
		vi.mocked(getPesticideSections).mockImplementationOnce(async () => sections("s2") as never);
		t.set({ lensCenter: ref("T-3") });
		await vi.advanceTimersByTimeAsync(50);
		expect(sectionCalls()).toHaveLength(2);
		await flush();
		expect(t.block.lens.features?.features.map((f) => f.properties.id).toSorted()).toEqual([
			"s1",
			"s2"
		]);
		t.block.destroy();
	});

	it("a sections load for an old key writes nothing after the key changes", async () => {
		const fails: ((error: unknown) => void)[] = [];
		vi.mocked(getPesticideSections).mockImplementation(
			() => new Promise((_, reject) => fails.push(reject))
		);
		const t = setup({ zoom: 11 });
		await vi.advanceTimersByTimeAsync(300);
		expect(sectionCalls()).toHaveLength(1);
		// A new period while the padded box is in flight; then the server refuses the old box.
		t.set({ query: query({ year: 2023, month: 7 }) });
		fails[0](badRequest());
		await flush();
		// No unpadded retry for the old key, and no refusal counted.
		expect(sectionCalls().filter((c) => c.bbox[0] === VIEW.west)).toHaveLength(0);
		expect(t.block.refusedZoom).toBe(0);
		// Nor a failure for a query no longer shown.
		const off = setup({ zoom: 11 });
		await vi.advanceTimersByTimeAsync(300);
		const pending = fails.length - 1;
		off.set({ on: false });
		fails[pending](new Error("offline"));
		await flush();
		expect(off.block.sectionsFailed).toBe(false);
		t.block.destroy();
		off.block.destroy();
	});

	it("blockOf and parentOf answer in refKeys", async () => {
		const t = setup();
		await flush();
		expect(t.block.blockOf(ref("T-1")).toSorted()).toEqual([ref("T-0"), ref("T-1"), ref("T-2")]);
		expect(t.block.blockOf(ref("nowhere"))).toEqual([]);
		const section = { level: "section", township: "T-0" } as UseProps;
		expect(t.block.parentOf(section)).toBe(ref("T-0"));
		expect(t.block.parentOf({ level: "township", township: "T-0" } as UseProps)).toBeNull();
		t.block.destroy();
	});

	it("childrenLoaded is true only for a township whose block the lens holds", async () => {
		const t = setup();
		await flush();
		// No lens yet.
		expect(t.block.childrenLoaded(ref("T-0"))).toBe(false);
		t.set({ lensCenter: ref("T-1") });
		await vi.advanceTimersByTimeAsync(50);
		await flush();
		// The block around T-1 is T-0, T-1 and T-2.
		expect(t.block.childrenLoaded(ref("T-0"))).toBe(true);
		expect(t.block.childrenLoaded(ref("T-2"))).toBe(true);
		// A township outside the loaded block, and one that does not exist.
		expect(t.block.childrenLoaded(ref("T-3"))).toBe(false);
		expect(t.block.childrenLoaded(ref("nowhere"))).toBe(false);
		// A section ref is not a township.
		expect(t.block.childrenLoaded(encodeRef({ kind: "feature", id: "section:s1" }))).toBe(false);
		// A lens of another key holds nothing for the new key.
		t.set({ query: query({ year: 2023, month: 7 }) });
		expect(t.block.childrenLoaded(ref("T-0"))).toBe(false);
		t.block.destroy();
	});

	it("a new period gives a new scale ref and drops the old features", async () => {
		const t = setup();
		await flush();
		const first = t.block.townships.scale;
		expect(first).not.toBeNull();
		let release!: () => void;
		vi.mocked(getPesticideTownships).mockImplementationOnce(
			(params) =>
				new Promise(
					(resolve) => (release = () => resolve(townships(params?.geometry !== false) as never))
				)
		);
		t.set({ query: query({ year: 2023, month: 7 }) });
		await flush();
		expect(t.block.townships.features).toBeNull();
		expect(t.block.townshipsState).toBe("loading");
		expectRegistered(t.block.townships);
		release();
		await flush();
		expect(t.block.townships.scale).not.toBe(first);
		expect(t.block.townships.features?.features).toHaveLength(IDS.length);
		expectRegistered(t.block.townships);
		t.block.destroy();
	});

	it("a source's scale ref is registered before it is exposed", async () => {
		const t = setup({ zoom: 11, lensCenter: ref("T-1") });
		const sources = [t.block.townships, t.block.sections, t.block.lens];
		for (let i = 0; i < 8; i++) {
			for (const source of sources) expectRegistered(source);
			await vi.advanceTimersByTimeAsync(50);
		}
		// A new figure on the same data: a new ref, registered from the held classes, no refetch.
		const before = t.block.townships.scale;
		t.set({ query: { ...query(), figure: "applications" } });
		expect(t.block.townships.scale).not.toBe(before);
		for (const source of sources) expectRegistered(source);
		expect(townshipCalls()).toHaveLength(1);
		expect(t.block.townships.features?.features[0].properties.value).toBe(10);
		t.block.destroy();
	});

	it("a new key that fails never shows the old key's classes: its empty scale, as no data does", async () => {
		const t = setup({ zoom: 11, lensCenter: ref("T-1") });
		await vi.advanceTimersByTimeAsync(200);
		const oldTownships = t.block.townships.scale as ScaleRef;
		const oldSections = t.block.sections.scale as ScaleRef;
		expect(useScaleFor(oldTownships)?.levels.length).toBeGreaterThan(0);
		expect(useScaleFor(oldSections)?.levels.length).toBeGreaterThan(0);
		vi.mocked(getPesticideTownships).mockRejectedValueOnce(new Error("offline"));
		t.set({ query: query({ year: 2023, month: 7 }) });
		await flush();
		expect(t.block.townshipsState).toBe("error");
		for (const source of [t.block.townships, t.block.sections, t.block.lens]) {
			const scale = source.scale as ScaleRef;
			expect(scale).not.toBe(oldTownships);
			expect(scale).not.toBe(oldSections);
			expect(useScaleFor(scale)?.levels).toEqual([]);
		}
		t.block.destroy();
	});

	it("from the section zoom, an unlisted period or a gone filter is the sections' status row too; the lens adds none", async () => {
		const t = setup({
			query: query({ year: 2017, month: null }),
			zoom: 12,
			lensCenter: ref("T-0")
		});
		await vi.advanceTimersByTimeAsync(200);
		const noData = {
			state: "unavailable",
			reason: "no-data",
			message: "No pesticide use reported for 2017 yet."
		};
		expect(t.block.townships.status).toEqual(noData);
		expect(t.block.sections.status).toEqual(noData);
		expect(t.block.lens.status).toEqual({ state: "ready" });
		vi.mocked(getChemicalDetails).mockRejectedValue(
			new Error("Not found", { cause: { result: { status: 404 } } })
		);
		t.set({ query: { ...query(), filters: { chemical: "gone" } } });
		await vi.advanceTimersByTimeAsync(200);
		expect(t.block.townshipsState).toBe("filter-gone");
		expect(t.block.sections.status).toMatchObject({ state: "unavailable", reason: "filter-gone" });
		expect(t.block.lens.status).toEqual({ state: "ready" });
		// Back to a listed period with no filters: the rows clear.
		t.set({ query: query() });
		await vi.advanceTimersByTimeAsync(200);
		expect(t.block.townships.status).toEqual({ state: "ready" });
		expect(t.block.sections.status).toEqual({ state: "ready" });
		t.block.destroy();
	});

	it("a failed load reads error, and retry asks again", async () => {
		vi.mocked(getPesticideTownships).mockRejectedValueOnce(new Error("offline"));
		const t = setup();
		await flush();
		expect(t.block.townshipsState).toBe("error");
		t.block.retry();
		await flush();
		expect(t.block.townshipsState).toBe("ready");
		t.block.destroy();
	});

	it("off asks for nothing", async () => {
		const t = setup({ on: false, zoom: 12, lensCenter: ref("T-1") });
		await vi.advanceTimersByTimeAsync(1000);
		expect(getPesticideTownships).not.toHaveBeenCalled();
		expect(getPesticideSections).not.toHaveBeenCalled();
		t.block.destroy();
	});
});
