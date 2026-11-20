import ChartLine from "@lucide/svelte/icons/chart-line";
import Table from "@lucide/svelte/icons/table";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WidgetInstance } from "$lib/documents/schema";
import { m } from "$lib/paraglide/messages.js";
import type { AppContext } from "$lib/store/app.svelte";
import type { WidgetMenuEnv } from "../registry";
import { setMapSend } from "./send-registry";
import { runShowIn, showInItems } from "./show-in-items";

const showIn = vi.fn(async () => {});
vi.mock("./show-in", () => ({ showIn: (...args: unknown[]) => showIn(...(args as [])) }));

const app = {} as AppContext;
const widget = { id: "w1", type: "map" } as WidgetInstance;
const env = (w: WidgetInstance | null = widget): WidgetMenuEnv => ({ app, widget: () => w });
const ctx = { target: {} as Element, payload: {} };
let removals: Array<() => void> = [];

function offer(marks: string[], leftOut = 0) {
	removals.push(
		setMapSend(widget.id, Symbol(), {
			marks,
			leftOut,
			draft: () => ({ type: "map", data: { layers: [] } })
		})
	);
}

afterEach(() => {
	for (const remove of removals) remove();
	removals = [];
	showIn.mockClear();
});

describe("showInItems", () => {
	it("lists nothing without an entry, or with no marks to send", () => {
		expect(showInItems(env())).toEqual([]);
		offer([], 2);
		expect(showInItems(env())).toEqual([]);
		expect(showInItems(env(null))).toEqual([]);
	});

	it("lists both items, for viewers too, while a mark is sent", () => {
		offer(["a"]);
		const items = showInItems(env());
		expect(items.map((i) => i.id)).toEqual(["map_show_in_chart", "map_show_in_table"]);
		expect(items[0]).toMatchObject({
			label: m.map_show_in_chart(),
			icon: ChartLine,
			group: "data",
			forViewers: true
		});
		expect(items[1]).toMatchObject({
			label: m.map_show_in_table(),
			icon: Table,
			group: "data",
			forViewers: true
		});
	});

	it("runs showIn with the sent marks and the left-out count", async () => {
		offer(["a", "b"], 1);
		const [chart, table] = showInItems(env());
		chart.run(ctx);
		await vi.waitFor(() => expect(showIn).toHaveBeenCalledTimes(1));
		expect(showIn).toHaveBeenLastCalledWith(
			app,
			"w1",
			{ kind: "monitors", ids: ["a", "b"], leftOut: 1 },
			"chart"
		);
		table.run(ctx);
		await vi.waitFor(() => expect(showIn).toHaveBeenCalledTimes(2));
		expect(showIn).toHaveBeenLastCalledWith(
			app,
			"w1",
			{ kind: "monitors", ids: ["a", "b"], leftOut: 1 },
			"table"
		);
	});

	it("ignores a second run while the first is still opening", async () => {
		let finish = () => {};
		showIn.mockImplementationOnce(() => new Promise<void>((r) => (finish = r)));
		offer(["a"]);
		const [chart, table] = showInItems(env());
		chart.run(ctx);
		chart.run(ctx);
		table.run(ctx);
		// The section card's button shares the guard.
		runShowIn(app, "w1", { kind: "section", code: "M1" });
		await vi.waitFor(() => expect(showIn).toHaveBeenCalledTimes(1));
		await new Promise((r) => setTimeout(r, 10));
		expect(showIn).toHaveBeenCalledTimes(1);
		finish();
		await new Promise((r) => setTimeout(r, 10));
		table.run(ctx);
		await vi.waitFor(() => expect(showIn).toHaveBeenCalledTimes(2));
	});

	it("runs again after a failed run", async () => {
		showIn.mockImplementationOnce(async () => {
			throw new Error("offline");
		});
		offer(["a"]);
		const [chart] = showInItems(env());
		chart.run(ctx);
		await vi.waitFor(() => expect(showIn).toHaveBeenCalledTimes(1));
		await new Promise((r) => setTimeout(r, 10));
		chart.run(ctx);
		await vi.waitFor(() => expect(showIn).toHaveBeenCalledTimes(2));
	});

	it("does nothing when the entry is gone by the time it runs", async () => {
		offer(["a"]);
		const [chart] = showInItems(env());
		for (const remove of removals) remove();
		removals = [];
		chart.run(ctx);
		await new Promise((r) => setTimeout(r, 10));
		expect(showIn).not.toHaveBeenCalled();
	});
});
