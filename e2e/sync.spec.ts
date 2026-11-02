/**
 * Two devices on one account: the test's own context (device A) and a second context (device B),
 * each with its own storage and session, sharing the mocked documents server. Device A goes
 * offline with `setOffline`. Polling runs every minute, so a device polls at once instead by
 * becoming visible again (`pollNow`) or coming back online.
 */
import type { Locator, Page } from "@playwright/test";
import type { FakeRemote } from "../src/lib/sync/remote-fake";
import { expect, setOffline, test, type Device, type DocumentsServer } from "./fixtures";
import {
	DASHBOARD_URL,
	expectNoViolations,
	expectSaved,
	liveRegion,
	maria,
	nav,
	openSharedDoc,
	renameWidget,
	setVisibility,
	sharedDoc,
	titleBar,
	widgetTitles
} from "./helpers";

test.use({ reducedMotion: "reduce", account: maria });

const TITLES = ["Alpha", "Beta", "Gamma"];
// Alpha and Beta side by side on top, Gamma full width below.
const PLAN = sharedDoc("Field trip", TITLES, [
	{ x: 0, y: 0, w: 6, h: 4 },
	{ x: 6, y: 0, w: 6, h: 4 },
	{ x: 0, y: 4, w: 12, h: 4 }
]);

function savedToAccount(page: Page): Locator {
	return nav(page).getByText("Saved to your account", { exact: true });
}

function savedOnDevice(page: Page): Locator {
	return nav(page).getByText("Saved on this device", { exact: true });
}

function deviceConflict(page: Page): Locator {
	return page.getByRole("dialog", { name: "Changed on another device" });
}

function accountButton(page: Page): Locator {
	return page.getByRole("button", { name: "ML, account menu for Maria Lopez" });
}

function signInLink(page: Page): Locator {
	return page.getByRole("link", { name: "Sign in" });
}

function idOf(page: Page): string {
	return new URL(page.url()).pathname.split("/").pop()!;
}

/** Polls at once, as a tab does when it comes back into view. */
async function pollNow(page: Page): Promise<void> {
	await setVisibility(page, "hidden");
	await setVisibility(page, "visible");
}

/** The widget titles the server holds for `id` (read as the signed-in person). */
async function serverTitles(fake: FakeRemote, id: string): Promise<string[] | null> {
	fake.signedInAs = maria.id;
	try {
		const doc = await fake.get(id);
		const body = doc.body as { widgets: Array<{ title: string | null }> };
		return body.widgets.map((w) => w.title ?? "");
	} catch {
		return null;
	}
}

/** The server's version of `id`. */
async function serverVersion(fake: FakeRemote, id: string): Promise<number> {
	fake.signedInAs = maria.id;
	return (await fake.get(id)).version;
}

/** Each widget's rect as the server holds it, by widget id. */
async function serverRects(fake: FakeRemote, id: string): Promise<Record<string, unknown>> {
	fake.signedInAs = maria.id;
	const doc = await fake.get(id);
	const body = doc.body as { widgets: Array<{ id: string; rect: unknown }> };
	return Object.fromEntries(body.widgets.map((w) => [w.id, w.rect]));
}

/** Where each widget is drawn, by widget id, from the grid's top left corner. */
async function boxes(page: Page) {
	const drawn: Record<string, { x: number; y: number; width: number; height: number }> = {};
	for (const id of ["w0", "w1", "w2"]) {
		const box = await page.getByTestId(`widget-${id}`).boundingBox();
		if (!box) throw new Error(`widget-${id} isn't shown`);
		drawn[id] = box;
	}
	const left = Math.min(...Object.values(drawn).map((b) => b.x));
	const top = Math.min(...Object.values(drawn).map((b) => b.y));
	return Object.fromEntries(
		Object.entries(drawn).map(([id, b]) => [id, { ...b, x: b.x - left, y: b.y - top }])
	);
}

/** Device A saves the trip plan to the account; device B opens it from the server. */
async function bothDevices(page: Page, server: DocumentsServer): Promise<Device> {
	await openSharedDoc(page, PLAN);
	await expect(savedToAccount(page)).toBeVisible();
	const b = await server.newDevice();
	await b.page.goto(page.url());
	await expect(widgetTitles(b.page)).toHaveText(TITLES);
	await expect(savedToAccount(b.page)).toBeVisible();
	return b;
}

/** Moves `title` with the keyboard: pick up, press `keys`, drop. */
async function keyboardMove(page: Page, title: string, keys: string[]): Promise<void> {
	await titleBar(page, title).focus();
	await page.keyboard.press("Enter");
	await expect(liveRegion(page)).toHaveText(new RegExp(`^Picked up ${title}\\.`));
	for (const key of keys) await page.keyboard.press(key);
	await page.keyboard.press("Enter");
	await expect(liveRegion(page)).toHaveText(new RegExp(`^Dropped ${title} at`));
}

test("an edit on one device appears on the other", async ({ page, documentsServer }) => {
	const b = await bothDevices(page, documentsServer);

	await renameWidget(page, "Alpha", "Edited on A");
	await expect
		.poll(() => serverTitles(documentsServer.fake, idOf(page)))
		.toEqual(["Edited on A", "Beta", "Gamma"]);

	await pollNow(b.page);
	await expect(widgetTitles(b.page)).toHaveText(["Edited on A", "Beta", "Gamma"]);
	await expect(savedToAccount(b.page)).toBeVisible();
});

test("offline edits on one device and online edits on the other merge", async ({
	page,
	context,
	documentsServer
}) => {
	const b = await bothDevices(page, documentsServer);

	await setOffline(context, true);
	await renameWidget(page, "Alpha", "Alpha on A");
	await expect(savedOnDevice(page)).toBeVisible();

	await renameWidget(b.page, "Beta", "Beta on B");
	await expect
		.poll(() => serverTitles(documentsServer.fake, idOf(page)))
		.toEqual(["Alpha", "Beta on B", "Gamma"]);

	await setOffline(context, false);
	const merged = ["Alpha on A", "Beta on B", "Gamma"];
	await expect(widgetTitles(page)).toHaveText(merged);
	await expect(savedToAccount(page)).toBeVisible();
	await expect.poll(() => serverTitles(documentsServer.fake, idOf(page))).toEqual(merged);

	await pollNow(b.page);
	await expect(widgetTitles(b.page)).toHaveText(merged);
	await expect(deviceConflict(page)).toHaveCount(0);
	await expect(deviceConflict(b.page)).toHaveCount(0);
});

test("the same title changed on both asks on the later device; keep mine wins and theirs is a snapshot", async ({
	page,
	context,
	documentsServer
}) => {
	const b = await bothDevices(page, documentsServer);
	const id = idOf(page);

	await setOffline(context, true);
	await renameWidget(page, "Alpha", "Mine");
	await expect(savedOnDevice(page)).toBeVisible();

	await renameWidget(b.page, "Alpha", "Theirs");
	await expect
		.poll(() => serverTitles(documentsServer.fake, id))
		.toEqual(["Theirs", "Beta", "Gamma"]);

	await setOffline(context, false);
	const dialog = deviceConflict(page);
	await expect(dialog).toBeVisible();
	await expect(
		dialog.getByText(
			"This dashboard was changed on another device while you were editing the same thing."
		)
	).toBeVisible();
	await expectNoViolations(page);
	// Device B saved first: it never asks.
	await expect(deviceConflict(b.page)).toHaveCount(0);

	await dialog.getByRole("button", { name: "Keep mine" }).click();
	await expect(dialog).toBeHidden();
	await expect(widgetTitles(page)).toHaveText(["Mine", "Beta", "Gamma"]);
	await expect(savedToAccount(page)).toBeVisible();
	await expect
		.poll(() => serverTitles(documentsServer.fake, id))
		.toEqual(["Mine", "Beta", "Gamma"]);

	// The version "Keep mine" replaced (device B's) is kept as a conflict snapshot.
	const snapshots = documentsServer.fake.snapshots(id);
	expect(snapshots).toHaveLength(1);
	expect(snapshots[0].reason).toBe("conflict");
	const kept = snapshots[0].body as { widgets: Array<{ title: string | null }> };
	expect(kept.widgets.map((w) => w.title)).toEqual(["Theirs", "Beta", "Gamma"]);

	await pollNow(b.page);
	await expect(widgetTitles(b.page)).toHaveText(["Mine", "Beta", "Gamma"]);
	await expect(deviceConflict(b.page)).toHaveCount(0);
});

test("moving widgets on both devices never asks", async ({ page, context, documentsServer }) => {
	const b = await bothDevices(page, documentsServer);
	const id = idOf(page);

	await setOffline(context, true);
	// Down passes Gamma, the next widget below in Alpha's columns.
	await keyboardMove(page, "Alpha", ["ArrowDown"]);
	await expect(widgetTitles(page)).toHaveText(["Beta", "Gamma", "Alpha"]);
	await expect(savedOnDevice(page)).toBeVisible();

	// The same widget, moved differently on the other device (pushing Beta and Gamma down).
	await keyboardMove(b.page, "Alpha", ["ArrowRight"]);
	await expect.poll(() => serverVersion(documentsServer.fake, id)).toBe(2);

	await setOffline(context, false);
	await expect(savedToAccount(page)).toBeVisible();
	await expect(deviceConflict(page)).toHaveCount(0);
	// Device A saved last, so its move of Alpha wins; the others keep device B's moves, and the
	// grid tidies any overlap.
	await expect
		.poll(() => serverRects(documentsServer.fake, id))
		.toEqual({
			w0: { x: 0, y: 8, w: 6, h: 4 },
			w1: { x: 6, y: 4, w: 6, h: 4 },
			w2: { x: 0, y: 8, w: 12, h: 4 }
		});

	await pollNow(b.page);
	await expect.poll(() => boxes(b.page)).toEqual(await boxes(page));
	await expect(widgetTitles(b.page)).toHaveText(await widgetTitles(page).allTextContents());
	await expect(deviceConflict(b.page)).toHaveCount(0);
});

test("sign out with unsaved changes, sign out anyway, sign back in: the change reaches the server", async ({
	page,
	accountServer,
	documentsServer
}) => {
	const { fake } = documentsServer;
	await openSharedDoc(page, PLAN);
	await expect(savedToAccount(page)).toBeVisible();
	const url = page.url();
	const id = idOf(page);

	// The server can't be reached; the session still can.
	fake.offline = true;
	await renameWidget(page, "Alpha", "Not on the server yet");
	await expect(savedOnDevice(page)).toBeVisible();

	await accountButton(page).click();
	await page.getByRole("menuitem", { name: "Sign out" }).click();
	const dialog = page.getByRole("dialog", { name: "Some changes aren't in your account yet" });
	await expect(dialog).toBeVisible();
	await expect(
		dialog.getByText("1 dashboard has changes not yet saved to your account.")
	).toBeVisible();
	await expectNoViolations(page);

	await dialog.getByRole("button", { name: "Finish saving, then sign out" }).click();
	await expect(
		dialog.getByText(
			"Some changes couldn't be saved to your account yet. Check your connection and try again."
		)
	).toBeVisible();
	await expect(accountButton(page)).toBeVisible();

	await dialog.getByRole("button", { name: "Sign out anyway" }).click();
	await expect(dialog).toBeHidden();
	await expect(signInLink(page)).toBeVisible();
	fake.offline = false;
	expect(await serverTitles(fake, id)).toEqual(TITLES);

	// Hidden from whoever uses this browser next.
	await page.goto(url);
	await expect(page.getByText("This dashboard isn't saved in this browser.")).toBeVisible();

	accountServer.set(maria);
	await page.reload();
	await expect(accountButton(page)).toBeVisible();
	await expect(widgetTitles(page)).toHaveText(["Not on the server yet", "Beta", "Gamma"]);
	await expect
		.poll(() => serverTitles(fake, id))
		.toEqual(["Not on the server yet", "Beta", "Gamma"]);
	await expect(savedToAccount(page)).toBeVisible();
});

test("moving this browser's dashboards into the account", async ({
	page,
	accountServer,
	documentsServer
}) => {
	accountServer.set(null);
	await openSharedDoc(page, PLAN);
	await expectSaved(page);
	const id = idOf(page);

	accountServer.set(maria);
	await page.reload();
	const dialog = page.getByRole("dialog", { name: "Dashboards on this browser" });
	await expect(dialog).toBeVisible();
	await expect(
		dialog.getByText("Add the dashboard made on this browser to your account?")
	).toBeVisible();
	await expectNoViolations(page);
	await dialog.getByRole("button", { name: "Add to my account" }).click();
	await expect(dialog).toBeHidden();

	// Same id, now in the account.
	await expect.poll(() => serverTitles(documentsServer.fake, id)).toEqual(TITLES);
	const b = await documentsServer.newDevice();
	await b.page.goto(`./dashboards/${id}`);
	await expect(widgetTitles(b.page)).toHaveText(TITLES);
});

test("a shared or reloaded page never shows another account's dashboards", async ({
	page,
	context,
	documentsServer
}) => {
	await openSharedDoc(page, PLAN);
	await expect(savedToAccount(page)).toBeVisible();
	const url = page.url();
	const other = await context.newPage();
	await other.goto(url);
	await expect(widgetTitles(other)).toHaveText(TITLES);

	// Everything is saved, so signing out asks nothing.
	await accountButton(page).click();
	await page.getByRole("menuitem", { name: "Sign out" }).click();
	await expect(signInLink(page)).toBeVisible();
	await expect(signInLink(other)).toBeVisible();
	const asked = documentsServer.fake.requests.length;

	// Both tabs show the anonymous space, now and after a reload of the dashboard's address.
	for (const tab of [page, other]) {
		await expect(tab.getByRole("heading", { name: "Alpha" })).toHaveCount(0);
		await tab.goto(url);
		await expect(tab.getByText("This dashboard isn't saved in this browser.")).toBeVisible();
		await expect(widgetTitles(tab)).toHaveCount(0);
	}
	await page.goto("./dashboards");
	await expect(page.getByText("You don't have any dashboards yet.")).toBeVisible();
	await expect(page.getByText("Field trip")).toHaveCount(0);
	// Signed out, nothing asks the server for documents.
	expect(documentsServer.fake.requests.slice(asked)).toEqual([]);
});

test("a dashboard permanently deleted elsewhere while edited offline asks to keep it", async ({
	page,
	context,
	documentsServer
}) => {
	const { fake } = documentsServer;
	await openSharedDoc(page, PLAN);
	await expect(savedToAccount(page)).toBeVisible();
	const id = idOf(page);

	await setOffline(context, true);
	await renameWidget(page, "Alpha", "Kept");
	await expect(savedOnDevice(page)).toBeVisible();
	fake.purge(id);

	await setOffline(context, false);
	const dialog = page.getByRole("dialog", { name: "Permanently deleted" });
	await expect(dialog).toBeVisible();
	await expectNoViolations(page);
	await dialog.getByRole("button", { name: "Keep as a new dashboard" }).click();
	await expect(dialog).toBeHidden();

	await expect(page).toHaveURL(DASHBOARD_URL);
	await expect.poll(() => idOf(page)).not.toBe(id);
	const copy = idOf(page);
	await expect(widgetTitles(page)).toHaveText(["Kept", "Beta", "Gamma"]);
	await expect(savedToAccount(page)).toBeVisible();
	expect(await serverTitles(fake, copy)).toEqual(["Kept", "Beta", "Gamma"]);
});
