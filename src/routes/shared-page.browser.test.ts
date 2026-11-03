import "../app.css";
import axe from "axe-core";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { toast } from "svelte-sonner";
import { render } from "vitest-browser-svelte";
import { page, userEvent } from "vitest/browser";
import type { Dashboard } from "$lib/documents/schema";
import { setPlatform } from "$lib/platform";
import { createMemoryPlatform, type MemoryPlatform } from "$lib/platform/memory";
import { reportUrl } from "$lib/shared/report";
import { APP_CONTEXT_KEY, initApp, type AppContext } from "$lib/store/app.svelte";
import { createMemoryTabHub } from "$lib/store/tab-channel";
import { saveFields } from "$lib/sync/merge";
import type { RemoteDocuments } from "$lib/sync/remote";
import { createFakeRemote, type FakeRemote } from "$lib/sync/remote-fake";
import { makeDoc, widget } from "$lib/sync/test-support";
import { navigate } from "../router";
import SharedHarness from "./test-harness/SharedHarness.svelte";

const mocked = vi.hoisted(() => ({ remote: null as RemoteDocuments | null }));
vi.mock("$lib/shared/remote", () => ({ sharedRemote: async () => mocked.remote }));

const OWNER = "owner";
const originalUrl = location.href;
const originalTitle = document.title;
let fake: FakeRemote;
const apps: AppContext[] = [];

beforeEach(async () => {
	await page.viewport(1280, 800);
	fake = createFakeRemote({ accountId: OWNER });
	fake.signedInAs = null;
	mocked.remote = fake;
});

afterEach(async () => {
	toast.dismiss();
	history.replaceState(null, "", originalUrl);
	document.title = originalTitle;
	for (const app of apps.splice(0)) await app.close();
});

async function asOwner<T>(fn: () => Promise<T>): Promise<T> {
	fake.signedInAs = OWNER;
	try {
		return await fn();
	} finally {
		fake.signedInAs = null;
	}
}

async function save(doc: Dashboard): Promise<void> {
	await asOwner(async () => {
		let baseVersion: number | null = null;
		try {
			baseVersion = (await fake.get(doc.id)).version;
		} catch {
			// New.
		}
		await fake.save(doc.id, {
			...saveFields(doc),
			baseVersion,
			changes: [],
			accountId: OWNER,
			buildId: "owner-build",
			snapshot: null
		});
	});
}

const classDoc = (): Dashboard => ({
	...makeDoc("s1"),
	name: "Class dashboard",
	body: {
		widgets: [
			{ ...widget("a"), title: "Readings" },
			{ ...widget("b", { x: 6, y: 0, w: 6, h: 4 }), title: "Map" }
		]
	}
});

async function publish(doc: Dashboard = classDoc()): Promise<string> {
	await save(doc);
	return asOwner(() => fake.share(doc.id));
}

type Opened = { app: AppContext; platform: MemoryPlatform; unmount: () => Promise<void> };

async function openApp(prepare?: (app: AppContext) => Promise<void>) {
	const platform = createMemoryPlatform();
	setPlatform(platform);
	const app = await initApp(platform, { channel: createMemoryTabHub().channel(), tabId: "t1" });
	apps.push(app);
	await prepare?.(app);
	return { app, platform };
}

async function renderShared(
	opened: { app: AppContext; platform: MemoryPlatform },
	token: string,
	opts: { widget?: string; routed?: boolean } = {}
): Promise<Opened> {
	await navigate("/shared/:token", {
		params: { token },
		...(opts.widget ? { search: { widget: opts.widget } } : {})
	});
	const screen = await render(SharedHarness, {
		props: { routed: opts.routed ?? false },
		context: new Map([[APP_CONTEXT_KEY, opened.app]])
	});
	return { ...opened, unmount: () => screen.unmount() };
}

async function openShared(token: string, opts: { widget?: string; routed?: boolean } = {}) {
	return renderShared(await openApp(), token, opts);
}

const bar = () => page.getByRole("complementary", { name: "About this shared dashboard" });
const titleBar = (name: string) => page.getByRole("group", { name });
const heading = (name: string) => page.getByRole("heading", { level: 1, name });
const placeholder = (id: string) => document.querySelector<HTMLElement>(`[data-widget="${id}"]`);
const isFullscreen = (id: string) => placeholder(id)?.dataset.fullscreen === "true";

test("shows the dashboard read-only under the made-by bar", async () => {
	const token = await publish();
	await openShared(token);
	await expect.element(heading("Class dashboard")).toBeVisible();
	await expect.element(bar()).toBeVisible();
	await expect.element(titleBar("Readings")).toBeVisible();
	await expect.element(titleBar("Map")).toBeVisible();
	await expect.element(page.getByRole("button", { name: "Make a copy" })).toBeVisible();
	// The bar comes first, then the heading, then the grid.
	const h1 = heading("Class dashboard").element();
	expect(
		bar().element().compareDocumentPosition(h1) & Node.DOCUMENT_POSITION_FOLLOWING
	).toBeTruthy();
	expect(
		h1.compareDocumentPosition(titleBar("Readings").element()) & Node.DOCUMENT_POSITION_FOLLOWING
	).toBeTruthy();
	// Read-only: nothing arranges or adds.
	expect(document.querySelector("[data-resize]")).toBeNull();
	await expect.element(page.getByRole("button", { name: "Add widget" })).not.toBeInTheDocument();
	await expect.poll(() => document.title).toBe("Class dashboard · SJVAir Dashboard");
	// Signed out: only the shared read was asked for.
	expect(fake.requests).toEqual(expect.arrayContaining([`shared ${token}`]));
});

test("an untitled shared dashboard has a generic heading", async () => {
	const token = await publish({ ...classDoc(), name: null });
	await openShared(token);
	await expect.element(heading("Untitled shared dashboard")).toBeVisible();
});

test("the bar shows the display name, or a generic label", async () => {
	const named = await publish();
	await asOwner(() => fake.setProfile("Ms. Ruiz"));
	const first = await openShared(named);
	await expect.element(bar().getByText("Shared by Ms. Ruiz")).toBeVisible();
	const link = bar().getByRole("link", { name: "Report this page" }).element();
	expect(link.getAttribute("href")).toBe(reportUrl(named));
	expect(link.getAttribute("target")).toBe("_blank");
	expect(link.getAttribute("rel")).toBe("noopener");
	await first.unmount();

	await asOwner(() => fake.setProfile(null));
	await openShared(named);
	await expect.element(bar().getByText("Shared by an SJVAir user")).toBeVisible();
});

test("the bar shows nothing else about the owner", async () => {
	const token = await publish();
	await asOwner(() => fake.setProfile("Ms. Ruiz"));
	await openShared(token);
	await expect.element(bar()).toBeVisible();
	const aside = bar().element();
	const parts = [...aside.children].map((el) => el.textContent?.trim());
	expect(parts).toEqual([
		"Shared by Ms. Ruiz",
		"This is not an official SJVAir page.",
		"Report this page"
	]);
	expect(aside.textContent?.replace(/\s+/g, "")).toBe(parts.join("").replace(/\s+/g, ""));
	// No way to dismiss it.
	expect(aside.querySelector("button")).toBeNull();
});

test("make a copy saves it and opens it", async () => {
	const token = await publish();
	const { app } = await openShared(token);
	await page.getByRole("button", { name: "Make a copy" }).click();
	await expect.poll(() => location.pathname).toMatch(/^\/workspace\/dashboards\//);
	const id = location.pathname.split("/").at(-1)!;
	expect(id).not.toBe("s1");
	const stored = (await app.platform.documents.get(app.space, id)) as Dashboard;
	expect(stored).toMatchObject({ copiedFrom: "s1", name: "Class dashboard" });
	expect(stored.body.widgets.map((w) => w.title)).toEqual(["Readings", "Map"]);
	await expect.element(page.getByText("Saved a copy to your dashboards")).toBeVisible();
});

test("a second copy asks, even after the source changed", async () => {
	const token = await publish();
	const opened = await openApp();
	const first = await renderShared(opened, token);
	await page.getByRole("button", { name: "Make a copy" }).click();
	await expect.poll(() => location.pathname).toMatch(/^\/workspace\/dashboards\//);
	const copyId = location.pathname.split("/").at(-1)!;
	await first.unmount();
	toast.dismiss();

	// The owner changes it; the viewer comes back to the link.
	await save({ ...classDoc(), name: "Class dashboard, week 2", body: { widgets: [] } });
	const second = await renderShared(opened, token);
	await expect.element(heading("Class dashboard, week 2")).toBeVisible();
	await page.getByRole("button", { name: "Make a copy" }).click();
	await expect
		.element(page.getByRole("dialog", { name: "You already have a copy of this dashboard" }))
		.toBeVisible();
	await page.getByRole("button", { name: "Open my copy" }).click();
	await expect.poll(() => location.pathname).toBe(`/workspace/dashboards/${copyId}`);
	expect(opened.app.index.items).toHaveLength(1);
	await second.unmount();

	// Dismissed: nothing happens. "Make a new copy": a second copy.
	await renderShared(opened, token);
	await page.getByRole("button", { name: "Make a copy" }).click();
	await expect.element(page.getByRole("dialog")).toBeVisible();
	await userEvent.keyboard("{Escape}");
	await expect.element(page.getByRole("dialog")).not.toBeInTheDocument();
	expect(location.pathname).toBe(`/workspace/shared/${token}`);
	await page.getByRole("button", { name: "Make a copy" }).click();
	await page.getByRole("button", { name: "Make a new copy" }).click();
	await expect.poll(() => opened.app.index.items.length).toBe(2);
	await expect.poll(() => location.pathname).not.toBe(`/workspace/dashboards/${copyId}`);
	expect(location.pathname).toMatch(/^\/workspace\/dashboards\//);
});

test("the unavailable page", async () => {
	const revoked = await publish({ ...classDoc(), id: "r1", name: "Revoked one" });
	await asOwner(() => fake.unshare("r1"));
	await save({ ...classDoc(), id: "p1", name: "Private one" });

	const texts: string[] = [];
	for (const token of ["no-such-token", revoked, "p1"]) {
		const opened = await openShared(token);
		await expect.element(heading("This shared dashboard is no longer available.")).toBeVisible();
		await expect.element(page.getByRole("link", { name: "Your dashboards" })).toBeVisible();
		await expect.element(bar()).not.toBeInTheDocument();
		expect(document.title).toBe("Shared dashboard · SJVAir Dashboard");
		texts.push(document.querySelector("main")!.textContent!);
		await opened.unmount();
	}
	expect(new Set(texts).size).toBe(1);
	expect(texts[0]).not.toContain("Revoked one");
	expect(texts[0]).not.toContain("Private one");
});

test("offline on first load offers Try again", async () => {
	const token = await publish();
	fake.offline = true;
	await openShared(token);
	await expect.element(page.getByRole("button", { name: "Try again" })).toBeVisible();
	await expect.element(page.getByRole("link", { name: "Your dashboards" })).toBeVisible();
	fake.offline = false;
	await page.getByRole("button", { name: "Try again" }).click();
	await expect.element(heading("Class dashboard")).toBeVisible();
});

test("undo and redo never touch the viewer's own dashboard", async () => {
	const token = await publish();
	let ownId = "";
	const opened = await openApp(async (app) => {
		ownId = await app.index.createBlank();
		const session = (await app.sessions.get(ownId))!;
		session.apply({ op: "setField", target: { path: "name" }, from: null, to: "Mine" });
		await session.flush();
		app.current = { session, isStarter: false };
	});
	await renderShared(opened, token);
	await expect.element(heading("Class dashboard")).toBeVisible();
	expect(opened.app.current.session).toBeNull();

	titleBar("Readings").element().focus();
	await userEvent.keyboard("{Control>}z{/Control}");
	await userEvent.keyboard("{Control>}{Shift>}z{/Shift}{/Control}");
	await userEvent.keyboard("{Control>}z{/Control}");
	const own = (await opened.app.sessions.get(ownId))!;
	await own.flush();
	expect(own.doc.name).toBe("Mine");
	const stored = (await opened.app.platform.documents.get(opened.app.space, ownId)) as Dashboard;
	expect(stored.name).toBe("Mine");
});

test("a poll with a newer version updates the widgets, and a gone fullscreen widget exits", async () => {
	const token = await publish();
	const { platform } = await openShared(token, { widget: "b" });
	await expect.poll(() => isFullscreen("b")).toBe(true);

	await save({
		...classDoc(),
		body: {
			widgets: [
				{ ...widget("a"), title: "Readings" },
				{ ...widget("c"), title: "Smoke" }
			]
		}
	});
	// Becoming visible polls at once.
	platform.activity.setVisible(false);
	platform.activity.setVisible(true);
	await expect.element(titleBar("Smoke")).toBeVisible();
	await expect.poll(() => location.search).toBe("");
	await expect.poll(() => placeholder("b")).toBeNull();
	await expect
		.element(page.getByText("That widget isn't on this dashboard anymore."))
		.toBeVisible();
	await expect.element(heading("Class dashboard")).toBeVisible();
});

test("on the routed page, fullscreen then Escape goes back", async () => {
	const token = await publish();
	await openShared(token, { routed: true });
	await expect.element(titleBar("Readings")).toBeVisible();
	const entries = history.length;
	await page.getByRole("button", { name: "Show Readings fullscreen" }).click();
	await expect.poll(() => location.search).toBe("?widget=a");
	await expect.poll(() => isFullscreen("a")).toBe(true);
	expect(history.length).toBe(entries + 1);
	await userEvent.keyboard("{Escape}");
	await expect.poll(() => location.search).toBe("");
	await expect.poll(() => isFullscreen("a")).toBe(false);
	expect(location.pathname).toBe(`/workspace/shared/${token}`);
	await expect.element(heading("Class dashboard")).toBeVisible();
});

test("the shown and unavailable pages pass axe", async () => {
	const token = await publish();
	await asOwner(() => fake.setProfile("Ms. Ruiz"));
	const shown = await openShared(token);
	await expect.element(titleBar("Readings")).toBeVisible();
	expect((await axe.run(document.querySelector("main")!)).violations).toEqual([]);
	await shown.unmount();

	await openShared("no-such-token");
	await expect.element(heading("This shared dashboard is no longer available.")).toBeVisible();
	expect((await axe.run(document.querySelector("main")!)).violations).toEqual([]);
});
