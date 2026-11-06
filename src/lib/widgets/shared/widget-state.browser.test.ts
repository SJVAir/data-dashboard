import "../../../app.css";
import axe from "axe-core";
import { afterEach, expect, test, vi } from "vitest";
import { toast } from "svelte-sonner";
import { render } from "vitest-browser-svelte";
import { page } from "vitest/browser";
import type { PlaceInfo, QueryData, QueryState, UnavailableReason } from "$lib/data/types";
import { UNAVAILABLE_REASONS } from "$lib/data/types";
import type { Dashboard, WidgetInstance } from "$lib/documents/schema";
import { formatDate } from "$lib/format";
import { m } from "$lib/paraglide/messages.js";
import { createMemoryPlatform } from "$lib/platform/memory";
import { DocumentSession } from "$lib/store/document-session.svelte";
import { APP_CONTEXT_KEY, initApp } from "$lib/store/app.svelte";
import { createMemoryTabHub } from "$lib/store/tab-channel";
import StateHarness from "./test-harness/StateHarness.svelte";

afterEach(() => toast.dismiss());

const widget: WidgetInstance = {
	id: "w1",
	type: "placeholder",
	title: null,
	rect: { x: 0, y: 0, w: 4, h: 4 },
	data: {
		layers: [{ dataset: "air-quality", place: { kind: "region", type: "tract", code: "1" } }]
	}
};

const point = { t: 0, mean: 1, min: 1, max: 1, count: 1, partial: false };
function data(opts: { empty?: boolean; places?: PlaceInfo[] } = {}): QueryData {
	return {
		series: [{ place: "region:tract:1", points: opts.empty ? [] : [point] }],
		places: opts.places ?? [{ place: "region:tract:1", name: "Tract 1" }],
		resolution: "day",
		fromRaw: false,
		processor: null,
		fetchedAt: 0
	};
}

async function seed() {
	const platform = createMemoryPlatform();
	const app = await initApp(platform, { channel: createMemoryTabHub().channel(), tabId: "t1" });
	const id = await app.index.createBlank();
	const stored = (await platform.documents.get(app.space, id)) as Dashboard;
	await platform.documents.commit(app.space, {
		docId: id,
		baseVersion: stored.version,
		doc: { ...stored, body: { widgets: [widget] } },
		entries: []
	});
	const session = (await DocumentSession.open(platform, app.space, id, "t2"))!;
	app.current = { session, isStarter: false };
	return { app, session };
}

async function show(
	state: QueryState,
	extra: {
		retired?: { name: string; since: string };
		onchoose?: () => void;
		widget?: WidgetInstance;
	} = {}
) {
	const { app, session } = await seed();
	const onretry = vi.fn();
	const screen = await render(StateHarness, {
		props: { state, widget, onretry, ...extra },
		context: new Map([[APP_CONTEXT_KEY, app]])
	});
	return { screen, session, onretry };
}

test("idle", async () => {
	const { screen } = await show({ status: "idle" });
	await expect.element(screen.getByText(m.widget_state_idle())).toBeInTheDocument();
	expect(m.widget_state_idle()).toBe("Choose a place to show data.");
});

test("idle offers Choose a place when editable and given onchoose", async () => {
	const onchoose = vi.fn();
	const { screen } = await show({ status: "idle" }, { onchoose });
	await screen.getByRole("button", { name: m.widget_state_choose_place() }).click();
	expect(onchoose).toHaveBeenCalledOnce();
	await screen.unmount();
	const plain = await show({ status: "idle" });
	await expect.element(plain.screen.getByText(m.widget_state_idle())).toBeInTheDocument();
	expect(page.getByRole("button", { name: m.widget_state_choose_place() }).query()).toBeNull();
});

test("idle has no Choose a place on a read-only dashboard", async () => {
	const { screen, session } = await show({ status: "idle" }, { onchoose: vi.fn() });
	session.readOnly = "invalid";
	await expect.element(screen.getByText(m.widget_state_idle())).toBeInTheDocument();
	await expect
		.poll(() => page.getByRole("button", { name: m.widget_state_choose_place() }).query())
		.toBeNull();
});

test("loading shows a skeleton after the delay, and no content", async () => {
	const { screen } = await show({ status: "loading" });
	expect(screen.container.querySelector("[data-skeleton]")).toBeNull();
	await expect.poll(() => screen.container.querySelector("[data-skeleton]")).not.toBeNull();
	expect(screen.container.querySelector("[data-testid=content]")).toBeNull();
});

test("loading with stale data keeps showing it", async () => {
	const { screen } = await show({ status: "loading", data: data() });
	await expect.element(screen.getByTestId("content")).toBeInTheDocument();
});

test("ready shows the content; all-empty series show the empty message", async () => {
	const ready = await show({ status: "ready", data: data() });
	await expect.element(ready.screen.getByTestId("content")).toBeInTheDocument();
	await ready.screen.unmount();
	const { screen } = await show({ status: "ready", data: data({ empty: true }) });
	await expect.element(screen.getByText(m.widget_state_empty())).toBeInTheDocument();
	expect(screen.container.querySelector("[data-testid=content]")).toBeNull();
});

test("error offers Retry, with or without stale data", async () => {
	const { screen, onretry } = await show({ status: "error", error: new Error("x") });
	await expect.element(screen.getByText(m.widget_state_error())).toBeInTheDocument();
	await screen.getByRole("button", { name: m.widget_state_retry() }).click();
	expect(onretry).toHaveBeenCalledOnce();
	await screen.unmount();
	const stale = await show({ status: "error", error: new Error("x"), data: data() });
	await expect.element(stale.screen.getByTestId("content")).toBeInTheDocument();
	await expect
		.element(stale.screen.getByRole("button", { name: m.widget_state_retry() }))
		.toBeInTheDocument();
});

test("each unavailable reason has its own message", async () => {
	const seen = new Set<string>();
	const GONE = ["region-unresolved", "location-unresolved", "monitor-unlisted"];
	for (const reason of UNAVAILABLE_REASONS.filter((r) => !GONE.includes(r))) {
		const { screen } = await show({ status: "unavailable", reason: reason as UnavailableReason });
		const key = `widget_state_unavailable_${reason.replaceAll("-", "_")}` as const;
		const text = (m as unknown as Record<string, () => string>)[key]();
		seen.add(text);
		await expect.element(screen.getByText(text)).toBeInTheDocument();
		await screen.unmount();
	}
	expect(seen.size).toBe(UNAVAILABLE_REASONS.length - GONE.length);
});

test("the no-longer-available card: Remove removes the widget; no Choose another without onchoose", async () => {
	const { screen, session } = await show({ status: "unavailable", reason: "region-unresolved" });
	await expect.element(screen.getByText(m.widget_state_gone_title())).toBeInTheDocument();
	expect(page.getByRole("button", { name: m.widget_state_choose_another() }).query()).toBeNull();
	const results = await axe.run(screen.container);
	expect(results.violations).toEqual([]);
	await screen.getByRole("button", { name: m.widget_state_remove() }).click();
	expect(session.doc.body.widgets).toHaveLength(0);
	session.undo();
	expect(session.doc.body.widgets).toHaveLength(1);
});

test.each(["region-unresolved", "location-unresolved", "monitor-unlisted"] as const)(
	"%s shows the card with Choose another and Remove when editable",
	async (reason) => {
		const onchoose = vi.fn();
		const { screen } = await show({ status: "unavailable", reason }, { onchoose });
		await expect.element(screen.getByText(m.widget_state_gone_title())).toBeInTheDocument();
		await expect
			.element(screen.getByRole("button", { name: m.widget_state_remove() }))
			.toBeInTheDocument();
		const results = await axe.run(screen.container);
		expect(results.violations).toEqual([]);
		await screen.getByRole("button", { name: m.widget_state_choose_another() }).click();
		expect(onchoose).toHaveBeenCalledOnce();
	}
);

test("point-outside says so, with Choose another", async () => {
	const onchoose = vi.fn();
	const { screen } = await show({ status: "unavailable", reason: "point-outside" }, { onchoose });
	expect(m.widget_state_unavailable_point_outside()).toBe(
		"Your location is outside the area SJVAir covers."
	);
	await expect
		.element(screen.getByText("Your location is outside the area SJVAir covers."))
		.toBeInTheDocument();
	const results = await axe.run(screen.container);
	expect(results.violations).toEqual([]);
	await screen.getByRole("button", { name: m.widget_state_choose_another() }).click();
	expect(onchoose).toHaveBeenCalledOnce();
});

test("a retired school gets a note; Switch swaps the school and undo reverts", async () => {
	const schoolWidget: WidgetInstance = {
		...widget,
		data: {
			layers: [{ dataset: "air-quality", place: { kind: "location", source: "cde", code: "1" } }]
		}
	};
	const places: PlaceInfo[] = [
		{
			place: "region:zipcode:93702",
			name: "93702",
			via: {
				kind: "location",
				source: "cde",
				code: "1",
				name: "Old High",
				retired: { since: "2024-03-05", replacedBy: { source: "cde", code: "2" } }
			}
		}
	];
	const platform = createMemoryPlatform();
	const app = await initApp(platform, { channel: createMemoryTabHub().channel(), tabId: "t1" });
	const id = await app.index.createBlank();
	const stored = (await platform.documents.get(app.space, id)) as Dashboard;
	await platform.documents.commit(app.space, {
		docId: id,
		baseVersion: stored.version,
		doc: { ...stored, body: { widgets: [schoolWidget] } },
		entries: []
	});
	const session = (await DocumentSession.open(platform, app.space, id, "t2"))!;
	app.current = { session, isStarter: false };
	const screen = await render(StateHarness, {
		props: {
			state: { status: "ready", data: data({ places }) } as QueryState,
			widget: schoolWidget,
			onretry: vi.fn()
		},
		context: new Map([[APP_CONTEXT_KEY, app]])
	});
	await expect
		.element(
			screen.getByText(
				m.widget_state_location_retired({ name: "Old High", date: formatDate("2024-03-05") })
			)
		)
		.toBeInTheDocument();
	expect(m.widget_state_location_retired({ name: "Old High", date: "D" })).toBe(
		"Old High is no longer listed (since D)"
	);
	const results = await axe.run(screen.container);
	expect(results.violations).toEqual([]);
	await screen.getByRole("button", { name: m.widget_state_switch() }).click();
	expect(session.doc.body.widgets[0].data.layers[0].place).toEqual({
		kind: "location",
		source: "cde",
		code: "2"
	});
	session.undo();
	expect(session.doc.body.widgets[0].data.layers[0].place).toEqual({
		kind: "location",
		source: "cde",
		code: "1"
	});
});

test("a retired place gets a note; Switch applies one setWidgetData and undo reverts", async () => {
	const places: PlaceInfo[] = [
		{
			place: "region:tract:1",
			name: "Tract 1",
			retired: { since: "2024-03-05", replacedBy: { type: "tract", code: "2" } }
		}
	];
	const { screen, session } = await show({ status: "ready", data: data({ places }) });
	await expect.element(screen.getByTestId("content")).toBeInTheDocument();
	await expect
		.element(
			screen.getByText(
				m.widget_state_place_retired({ place: "Tract 1", date: formatDate("2024-03-05") })
			)
		)
		.toBeInTheDocument();
	await screen.getByRole("button", { name: m.widget_state_switch() }).click();
	expect(session.doc.body.widgets[0].data.layers[0].place).toEqual({
		kind: "region",
		type: "tract",
		code: "2"
	});
	session.undo();
	expect(session.doc.body.widgets[0].data.layers[0].place).toEqual({
		kind: "region",
		type: "tract",
		code: "1"
	});
});

test("a retired place without a replacement has no Switch button", async () => {
	const places: PlaceInfo[] = [
		{ place: "region:tract:1", name: "Tract 1", retired: { since: "2024-03-05", replacedBy: null } }
	];
	const { screen } = await show({ status: "ready", data: data({ places }) });
	await expect.element(screen.getByTestId("content")).toBeInTheDocument();
	expect(page.getByRole("button", { name: m.widget_state_switch() }).query()).toBeNull();
});

test("a retired dataset shows its note over the data", async () => {
	const { screen } = await show(
		{ status: "ready", data: data() },
		{ retired: { name: "PM2.5", since: "2025-01-02" } }
	);
	await expect.element(screen.getByTestId("content")).toBeInTheDocument();
	await expect
		.element(
			screen.getByText(
				m.widget_state_dataset_retired({ dataset: "PM2.5", date: formatDate("2025-01-02") })
			)
		)
		.toBeInTheDocument();
});

test("Choose another on a retired entry type opens Edit data, not the place picker", async () => {
	const originalUrl = location.href;
	try {
		const onchoose = vi.fn();
		const { screen, session } = await show(
			{ status: "ready", data: data() },
			{
				retired: { name: "PM2.5", since: "2025-01-02" },
				onchoose,
				widget: { ...widget, type: "chart" }
			}
		);
		// sv-router loads a lazy route's code before it changes the URL; in browser tests that
		// code compiles on first use, which can outlast the poll on a loaded CI runner. Load it now.
		await import("../../../routes/GetData.svelte");
		await screen.getByRole("button", { name: m.widget_state_choose_another() }).click();
		await expect
			.poll(() => location.pathname)
			.toBe(`/workspace/dashboards/${session.doc.id}/widgets/w1/edit`);
		expect(onchoose).not.toHaveBeenCalled();
	} finally {
		history.replaceState(null, "", originalUrl);
	}
});

test("a retired dataset on a type Get data can't edit has no Choose another", async () => {
	const { screen } = await show(
		{ status: "ready", data: data() },
		{ retired: { name: "PM2.5", since: "2025-01-02" } }
	);
	await expect.element(screen.getByTestId("content")).toBeInTheDocument();
	expect(page.getByRole("button", { name: m.widget_state_choose_another() }).query()).toBeNull();
});

test("several retired places share one Switch button", async () => {
	const retiredTo = (n: string) => ({
		place: `region:tract:${n}`,
		name: `Tract ${n}`,
		retired: { since: "2024-03-05", replacedBy: { type: "tract", code: `${n}0` } }
	});
	const { screen } = await show({
		status: "ready",
		data: data({ places: [retiredTo("1"), retiredTo("2")] })
	});
	await expect.element(screen.getByTestId("content")).toBeInTheDocument();
	expect(page.getByRole("button", { name: m.widget_state_switch() }).elements()).toHaveLength(1);
});

test("stale data with no points is empty while loading or in error", async () => {
	const loading = await show({ status: "loading", data: data({ empty: true }) });
	await expect.element(loading.screen.getByText(m.widget_state_empty())).toBeInTheDocument();
	await loading.screen.unmount();
	const error = await show({ status: "error", error: 1, data: data({ empty: true }) });
	await expect.element(error.screen.getByText(m.widget_state_empty())).toBeInTheDocument();
});
