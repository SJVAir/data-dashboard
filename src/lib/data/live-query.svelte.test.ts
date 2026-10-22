import { describe, expect, it } from "vitest";
import type { DatasetAdapter, RegionResolver } from "./adapters/registry";
import { LiveQuery } from "./live-query.svelte";
import { createQueryClient } from "./query/client";
import { FIXTURE_CATALOG, fixtureMetadata } from "./testing/fixtures";
import type { QueryData, QueryInput } from "./types";

const DATA: QueryData = {
	series: [],
	resolution: "hour",
	fromRaw: false,
	processor: null,
	fetchedAt: 1
};

const regions: RegionResolver = { resolve: async () => "unsupported" };

function setup(metadata = fixtureMetadata()) {
	const pending: Array<(d: QueryData) => void> = [];
	const adapter: DatasetAdapter = {
		id: "air-quality",
		async target(layer) {
			if (layer.place?.kind === "monitor") return { kind: "monitors", ids: [layer.place.id] };
			return { unavailable: "place-unsupported" };
		},
		offered: (base) => base,
		fetch: () => new Promise((resolve) => pending.push(resolve))
	};
	const client = createQueryClient({ adapters: [adapter], metadata, regions });
	return { client, pending };
}

const input: QueryInput = {
	layer: { dataset: "air-quality", entryType: "pm25", place: { kind: "monitor", id: "m-pa" } },
	dateRange: { kind: "trailing", amount: 7, unit: "day" }
};

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("LiveQuery", () => {
	it("reflects loading, then ready", async () => {
		const { client, pending } = setup();
		const q = new LiveQuery(client, input);
		expect(q.state.status).toBe("loading");
		await flush();
		pending[0](DATA);
		await flush();
		expect(q.state).toEqual({ status: "ready", data: DATA });
	});

	it("destroy() unsubscribes", async () => {
		const { client, pending } = setup();
		const q = new LiveQuery(client, input);
		await flush();
		pending[0](DATA);
		await flush();
		expect(client.entries()[0].subscribers).toBe(1);
		q.destroy();
		expect(client.entries()[0].subscribers).toBe(0);
	});

	it("set(null) drops the subscription and setPolling passes through", async () => {
		const { client, pending } = setup();
		const q = new LiveQuery(client, null);
		expect(client.entries()).toHaveLength(0);
		q.set(input);
		await flush();
		pending[0](DATA);
		await flush();
		q.setPolling(false);
		expect(client.entries()[0].polling).toBe(false);
		q.set(null);
		expect(client.entries()[0].subscribers).toBe(0);
	});

	it("retry() re-plans after an error", async () => {
		let fail = true;
		const metadata = fixtureMetadata({
			catalog: async () => {
				if (fail) throw new Error("catalog down");
				return FIXTURE_CATALOG;
			}
		});
		const { client } = setup(metadata);
		const q = new LiveQuery(client, input);
		await flush();
		expect(q.state.status).toBe("error");

		fail = false;
		q.retry();
		await flush();
		expect(q.state.status).toBe("loading");
		expect(client.entries()).toHaveLength(1);
	});
});
