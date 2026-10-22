import { describe, expect, it } from "vitest";
import type { DatasetAdapter, RegionResolver } from "./adapters/registry";
import { LiveQuery } from "./live-query.svelte";
import { createQueryClient } from "./query/client";
import { fixtureMetadata } from "./testing/fixtures";
import type { QueryData, QueryInput } from "./types";

// In the browser, where runes compile for the client (Node tests get the server build, which
// never proxies state).
describe("LiveQuery in the browser", () => {
	it("keeps the data it is given rather than a deep proxy of it", async () => {
		const data: QueryData = {
			series: [{ place: "monitor:m-pa", points: [] }],
			resolution: "hour",
			fromRaw: false,
			processor: null,
			fetchedAt: 1
		};
		const adapter: DatasetAdapter = {
			id: "air-quality",
			target: async () => ({ kind: "monitors", ids: ["m-pa"] }),
			offered: (base) => base,
			fetch: async () => data
		};
		const regions: RegionResolver = { resolve: async () => "unsupported" };
		const client = createQueryClient({ adapters: [adapter], metadata: fixtureMetadata(), regions });
		const input: QueryInput = {
			layer: { dataset: "air-quality", entryType: "pm25", place: { kind: "monitor", id: "m-pa" } },
			dateRange: { kind: "trailing", amount: 7, unit: "day" }
		};
		const q = new LiveQuery(client, input);
		await expect.poll(() => q.state.status).toBe("ready");
		expect(q.state.status === "ready" && q.state.data).toBe(data);
		q.destroy();
	});
});
