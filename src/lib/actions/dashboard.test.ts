import { beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "svelte-sonner";
import { askWhichPlace, openPlacePicker } from "$lib/components/dialogs/lazy.svelte";
import { openRename } from "$lib/components/dialogs/RenameDialog.svelte";
import { takeAfterMenuClose } from "$lib/components/menu/menu-state.svelte";
import type { ChosenPlace, Layer } from "$lib/data/schema";
import type { Dashboard, WidgetInstance } from "$lib/documents/schema";
import type { AppContext } from "$lib/store/app.svelte";
import { STARTER_ID } from "$lib/starter/starter";
import { chartType } from "$lib/widgets/chart";
import { registerWidgetType } from "$lib/widgets/registry";
import { navigate } from "../../router";
import { startGetData, dashboardActions } from "./dashboard";
import { isDisabled } from "./types";

vi.mock("../../router", () => ({ navigate: vi.fn(async () => {}) }));
vi.mock("$lib/safety/report", () => ({ report: vi.fn() }));
vi.mock("$lib/components/dialogs/RenameDialog.svelte", () => ({ openRename: vi.fn() }));
vi.mock("svelte-sonner", () => ({ toast: Object.assign(vi.fn(), { info: vi.fn() }) }));
vi.mock("$lib/components/dialogs/lazy.svelte", async (original) => ({
	...(await original<object>()),
	openPlacePicker: vi.fn(),
	askWhichPlace: vi.fn()
}));

const CTX = { target: {} as Element, payload: {} };

function app(isStarter = false, readOnly: false | "newer" = false): AppContext {
	return {
		current: { session: { doc: { id: "d1", body: { widgets: [] } }, readOnly }, isStarter },
		index: { names: new Map() }
	} as unknown as AppContext;
}

beforeEach(() => {
	vi.clearAllMocks();
	registerWidgetType(chartType);
});

describe("Add widget", () => {
	it("Add widget's Chart item opens Get data for this dashboard", async () => {
		const items = dashboardActions(app())(CTX);
		const add = items.find((i) => i.id === "add-widget");
		const chart = add?.children?.find((i) => i.id === "add-widget-chart");
		expect(chart).toBeDefined();
		await chart?.run?.(CTX);
		expect(navigate).toHaveBeenCalledWith("/dashboards/:id/widgets/new", {
			params: { id: "d1" },
			search: { type: "chart" }
		});
	});

	it("on the starter it opens Get data for the starter", () => {
		startGetData(app(true), "chart");
		expect(navigate).toHaveBeenCalledWith("/dashboards/:id/widgets/new", {
			params: { id: STARTER_ID },
			search: { type: "chart" }
		});
	});

	it("on a read-only dashboard it opens nothing", () => {
		startGetData(app(false, "newer"), "chart");
		expect(navigate).not.toHaveBeenCalled();
	});

	it("a locked dashboard disables Add widget", () => {
		const add = dashboardActions(app(false, "newer"))(CTX).find((i) => i.id === "add-widget");
		expect(add && isDisabled(add)).toBe(true);
	});
});

describe("Duplicate for another place", () => {
	const A: ChosenPlace = { kind: "region", type: "county", code: "06019" };
	const B: ChosenPlace = { kind: "location", source: "schools", code: "123" };
	const C: ChosenPlace = { kind: "monitor", id: "m1" };
	const TO: ChosenPlace = { kind: "region", type: "county", code: "06029" };

	function widget(id: string, places: ChosenPlace[], y: number): WidgetInstance {
		const layers: Layer[] = places.map((place) => ({ dataset: "air-quality", place }));
		return { id, type: "chart", title: null, rect: { x: 0, y, w: 6, h: 4 }, data: { layers } };
	}
	const note = (y: number): WidgetInstance => ({
		id: `note-${y}`,
		type: "notes",
		title: null,
		rect: { x: 0, y, w: 6, h: 2 },
		data: { layers: [] }
	});

	function doc(widgets: WidgetInstance[], bar?: ChosenPlace): Dashboard {
		return {
			id: "d1",
			body: { widgets, ...(bar ? { placeBar: { place: bar } } : {}) }
		} as unknown as Dashboard;
	}

	function setup(d: Dashboard, isStarter = false, readOnly: false | "newer" = false) {
		const flush = vi.fn(async () => {});
		const copy = { doc: { id: "copy", name: null } };
		const duplicate = vi.fn(async () => "copy");
		const app = {
			current: { session: { doc: d, readOnly, flush }, isStarter },
			index: { names: new Map(), items: [], duplicate },
			sessions: { get: vi.fn(async () => copy) }
		} as unknown as AppContext;
		return { app, flush, duplicate };
	}

	function item(app: AppContext, id?: string) {
		return dashboardActions(app, id)(CTX).find((i) => i.id === "duplicate-for-another-place");
	}

	/** Runs the item as the menu does (after it closes); resolves once the picker is open. */
	async function run(app: AppContext, id?: string) {
		item(app, id)!.run(CTX);
		takeAfterMenuClose()?.();
		await vi.waitFor(() => expect(openPlacePicker).toHaveBeenCalled());
		const opts = vi.mocked(openPlacePicker).mock.calls[0][0] as {
			pick: (p: ChosenPlace) => void;
		};
		return opts.pick;
	}

	it("sits next to Duplicate", () => {
		const ids = dashboardActions(setup(doc([widget("a", [A], 0)])).app)(CTX).map((i) => i.id);
		expect(ids.indexOf("duplicate-for-another-place")).toBe(ids.indexOf("duplicate-dashboard") + 1);
	});

	it("is hidden when nothing shows a place to replace (only Notes, only comparisons)", () => {
		expect(item(setup(doc([note(0)])).app)).toBeUndefined();
		expect(item(setup(doc([widget("a", [A, C], 0)])).app)).toBeUndefined();
		expect(item(setup(doc([])).app)).toBeUndefined();
	});

	it("is disabled on a read-only dashboard", () => {
		const found = item(setup(doc([widget("a", [A], 0)]), false, "newer").app);
		expect(found && isDisabled(found)).toBe(true);
	});

	it("with a visible bar, the bar's place is replaced (no tie asked)", async () => {
		const d = doc([widget("a", [A], 0), widget("b", [B], 4), widget("c", [B], 8)], A);
		const { app, flush, duplicate } = setup(d);
		const pick = await run(app);
		pick(TO);
		await vi.waitFor(() => expect(openRename).toHaveBeenCalled());
		expect(askWhichPlace).not.toHaveBeenCalled();
		expect(flush).toHaveBeenCalled();
		expect(duplicate).toHaveBeenCalledWith("d1", { from: A, to: TO });
		expect(navigate).toHaveBeenCalledWith("/dashboards/:id", {
			params: { id: "copy" },
			replace: false
		});
	});

	it("otherwise the main place is replaced", async () => {
		// The bar's place shows on no widget: it isn't visible.
		const d = doc([widget("a", [B], 0), widget("b", [B], 4), widget("c", [A, C], 8)], C);
		const { app, duplicate } = setup(d);
		(await run(app))(TO);
		await vi.waitFor(() => expect(duplicate).toHaveBeenCalledWith("d1", { from: B, to: TO }));
		expect(askWhichPlace).not.toHaveBeenCalled();
	});

	it("on a tie, asks which place first (in reading order), then the new place", async () => {
		vi.mocked(askWhichPlace).mockResolvedValue(A);
		const d = doc([widget("b", [B], 0), widget("a", [A], 4)]);
		const { app, duplicate } = setup(d);
		const pick = await run(app);
		expect(askWhichPlace).toHaveBeenCalledWith([B, A]);
		pick(TO);
		await vi.waitFor(() => expect(duplicate).toHaveBeenCalledWith("d1", { from: A, to: TO }));
	});

	it("a dismissed tie question makes no copy", async () => {
		vi.mocked(askWhichPlace).mockResolvedValue(null);
		const { app, duplicate } = setup(doc([widget("b", [B], 0), widget("a", [A], 4)]));
		item(app)!.run(CTX);
		takeAfterMenuClose()?.();
		await vi.waitFor(() => expect(askWhichPlace).toHaveBeenCalled());
		await Promise.resolve();
		expect(openPlacePicker).not.toHaveBeenCalled();
		expect(duplicate).not.toHaveBeenCalled();
	});

	it("the starter duplicates with its chosen place replaced", async () => {
		const d = doc([widget("a", [B], 0), widget("b", [B], 4)], B);
		const { app, flush, duplicate } = setup(d, true);
		(await run(app))(TO);
		await vi.waitFor(() => expect(duplicate).toHaveBeenCalledWith(STARTER_ID, { from: B, to: TO }));
		expect(flush).not.toHaveBeenCalled();
		await vi.waitFor(() => expect(openRename).toHaveBeenCalled());
	});

	it("a row with nothing to replace says so", async () => {
		const { app, duplicate } = setup(doc([]));
		const row = doc([note(0)]);
		(app.sessions.get as ReturnType<typeof vi.fn>).mockResolvedValue({
			doc: row,
			readOnly: false,
			flush: vi.fn()
		});
		item(app, "row")!.run(CTX);
		takeAfterMenuClose()?.();
		await vi.waitFor(() => expect(toast.info).toHaveBeenCalled());
		expect(duplicate).not.toHaveBeenCalled();
	});
});
