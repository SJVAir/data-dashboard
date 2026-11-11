/**
 * Live share links: device A (Maria) shares a dashboard saved to her account; a viewer opens the
 * link in a second context, signed out (or as another account). Everything runs against the one
 * mocked documents server. The shared page polls every minute, so a viewer polls at once instead
 * by becoming visible again (`pollNow`).
 */
import type { BrowserContext, Locator, Page } from "@playwright/test";
import type { AccountUser } from "../src/lib/account/identity";
import type { FakeRemote } from "../src/lib/sync/remote-fake";
import { expect, test, type Device, type DocumentsServer } from "./fixtures";
import {
	DASHBOARD_URL,
	expectNoViolations,
	maria,
	nav,
	openPicker,
	openSharedDoc,
	renameWidget,
	setVisibility,
	sharedDoc,
	STARTER_TITLES,
	widgetTitles
} from "./helpers";

test.use({ reducedMotion: "reduce", account: maria });

const NAME = "Field trip";
const TITLES = ["Alpha", "Beta", "Gamma"];
const PLAN = sharedDoc(NAME, TITLES);
const SHARED_URL = /\/workspace\/shared\/[^/]+$/;
const UNAVAILABLE = "This shared dashboard is no longer available.";

const sam: AccountUser = {
	id: "q2Xr7VbcS0mWm2pTj9Lk3A",
	full_name: "Sam Chen",
	email: "sam@example.com",
	phone: null,
	phone_verified: false,
	language: "en"
};

function savedToAccount(page: Page): Locator {
	return nav(page).getByText("Saved to your account", { exact: true });
}

function shareDialog(page: Page): Locator {
	return page.getByRole("dialog", { name: "Share dashboard" });
}

function liveLink(page: Page): Locator {
	return shareDialog(page).getByRole("textbox", { name: "Live link" });
}

function madeByBar(page: Page): Locator {
	return page.getByRole("complementary", { name: "About this shared dashboard" });
}

function idOf(page: Page): string {
	return new URL(page.url()).pathname.split("/").pop()!;
}

/** Polls at once, as a page does when it comes back into view. */
async function pollNow(page: Page): Promise<void> {
	await setVisibility(page, "hidden");
	await setVisibility(page, "visible");
}

/** Device A saves the trip plan to Maria's account and waits for it to reach the server. */
async function savedPlan(page: Page): Promise<string> {
	await openSharedDoc(page, PLAN);
	await expect(savedToAccount(page)).toBeVisible();
	return idOf(page);
}

async function openShare(page: Page): Promise<Locator> {
	await openPicker(page, NAME);
	await page.getByRole("menuitem", { name: "Share…" }).click();
	const dialog = shareDialog(page);
	await expect(dialog).toBeVisible();
	return dialog;
}

/** Opens the Share dialog, creates a live link, and resolves it. */
async function createLink(page: Page): Promise<string> {
	const dialog = await openShare(page);
	await dialog.getByRole("button", { name: "Create link" }).click();
	await expect(liveLink(page)).toHaveValue(SHARED_URL);
	return liveLink(page).inputValue();
}

/** A second context: signed out (`null`) or signed in as `user`. */
async function viewer(server: DocumentsServer, user: AccountUser | null): Promise<Device> {
	const device = await server.newDevice();
	device.account.set(user);
	return device;
}

async function expectShared(page: Page, titles: string[]): Promise<void> {
	await expect(page).toHaveURL(SHARED_URL);
	await expect(page.getByRole("heading", { level: 1, name: NAME })).toBeVisible();
	await expect(widgetTitles(page)).toHaveText(titles);
}

/** The server's documents for `account`. */
async function serverDocuments(fake: FakeRemote, account: string) {
	fake.signedInAs = account;
	return (await fake.list()).documents;
}

async function grantClipboard(context: BrowserContext, browserName: string): Promise<void> {
	// Only Chromium has clipboard permissions to grant; the others allow writes on a click. (A
	// refused grant in WebKit breaks the context's later pages, which axe opens.)
	if (browserName === "chromium") {
		await context.grantPermissions(["clipboard-read", "clipboard-write"]);
	}
}

test("a teacher's link opens for a student with no account", async ({
	page,
	context,
	browserName,
	documentsServer
}) => {
	await grantClipboard(context, browserName);
	const id = await savedPlan(page);
	const url = await createLink(page);
	expect(documentsServer.fake.requests).toContain(`share ${id}`);
	await shareDialog(page)
		.getByRole("region", { name: "Anyone with the link can view" })
		.getByRole("button", { name: "Copy link" })
		.click();
	await expect(shareDialog(page).getByText("Link copied")).toBeVisible();
	await expectNoViolations(page);

	const student = await viewer(documentsServer, null);
	await student.page.goto(url);
	await expectShared(student.page, TITLES);
	const bar = madeByBar(student.page);
	await expect(bar.getByText("Shared by an SJVAir user")).toBeVisible();
	await expect(bar.getByText("This is not an official SJVAir page.")).toBeVisible();
	await expect(student.page.getByRole("button", { name: "Make a copy" })).toBeVisible();
	// View only: no dashboard menu, and a widget's menu only shows it fullscreen.
	await expect(student.page.getByRole("button", { name: "Dashboard actions" })).toHaveCount(0);
	await expect(student.page.getByRole("button", { name: "Add widget" })).toHaveCount(0);
	await expectNoViolations(student.page);
	await student.page.getByRole("button", { name: "Actions for Alpha", exact: true }).click();
	await expect(student.page.getByRole("menuitem")).toHaveText(["Fullscreen"]);
});

test("a live link made from the starter doesn't show its welcome Note to viewers", async ({
	page,
	documentsServer
}) => {
	const welcome = "Welcome to the SJVAir Dashboard.";
	await page.goto("./");
	await expect(page.getByText(welcome)).toBeVisible();
	await openPicker(page, "Starter dashboard");
	await page.getByRole("menuitem", { name: "Share…" }).click();
	await expect(page).toHaveURL(DASHBOARD_URL);
	await expect(savedToAccount(page)).toBeVisible();
	await shareDialog(page).getByRole("button", { name: "Create link" }).click();
	await expect(liveLink(page)).toHaveValue(SHARED_URL);
	const url = await liveLink(page).inputValue();
	await page.keyboard.press("Escape");
	// The owner still sees it.
	await expect(page.getByText(welcome)).toBeVisible();

	const student = await viewer(documentsServer, null);
	await student.page.goto(url);
	await expect(student.page).toHaveURL(SHARED_URL);
	await expect(widgetTitles(student.page)).toHaveText(STARTER_TITLES.slice(1));
	await expect(student.page.getByText(welcome)).toHaveCount(0);
});

test("the viewer sees the owner's change after a poll", async ({ page, documentsServer }) => {
	await savedPlan(page);
	const url = await createLink(page);
	await page.keyboard.press("Escape");

	const student = await viewer(documentsServer, null);
	await student.page.goto(url);
	await expectShared(student.page, TITLES);

	await renameWidget(page, "Alpha", "Bus at 9");
	await expect(savedToAccount(page)).toBeVisible();
	const token = url.split("/").pop()!;
	await expect
		.poll(async () => {
			documentsServer.fake.signedInAs = null;
			return (await documentsServer.fake.shared(token)).version;
		})
		.toBe(2);

	await pollNow(student.page);
	await expect(widgetTitles(student.page)).toHaveText(["Bus at 9", "Beta", "Gamma"]);
	expect(documentsServer.fake.requests.some((r) => r.startsWith(`sharedChanges ${token}`))).toBe(
		true
	);
});

test("stop sharing: the open page and a fresh load both say no longer available", async ({
	page,
	documentsServer
}) => {
	const id = await savedPlan(page);
	const url = await createLink(page);

	const student = await viewer(documentsServer, null);
	await student.page.goto(url);
	await expectShared(student.page, TITLES);

	await shareDialog(page).getByRole("button", { name: "Stop sharing" }).click();
	const confirm = page.getByRole("dialog", { name: "Stop sharing this dashboard?" });
	await expect(confirm).toBeVisible();
	await expectNoViolations(page);
	await confirm.getByRole("button", { name: "Stop sharing" }).click();
	await expect(shareDialog(page).getByText("Link turned off")).toBeVisible();
	await expect(shareDialog(page).getByRole("button", { name: "Create link" })).toBeVisible();
	expect(documentsServer.fake.requests).toContain(`unshare ${id}`);

	await pollNow(student.page);
	await expect(student.page.getByRole("heading", { level: 1, name: UNAVAILABLE })).toBeVisible();
	await expect(widgetTitles(student.page)).toHaveCount(0);

	await student.page.reload();
	await expect(student.page.getByRole("heading", { level: 1, name: UNAVAILABLE })).toBeVisible();
	await expect(widgetTitles(student.page)).toHaveCount(0);
	await expectNoViolations(student.page);

	// Sharing again makes a new link; the old one stays dead.
	await shareDialog(page).getByRole("button", { name: "Create link" }).click();
	await expect(liveLink(page)).toHaveValue(SHARED_URL);
	expect(await liveLink(page).inputValue()).not.toBe(url);
	await student.page.reload();
	await expect(student.page.getByRole("heading", { level: 1, name: UNAVAILABLE })).toBeVisible();
});

test("make a copy, signed out, then again: the second time asks", async ({
	page,
	documentsServer
}) => {
	const id = await savedPlan(page);
	const url = await createLink(page);

	const student = await viewer(documentsServer, null);
	await student.page.goto(url);
	await expectShared(student.page, TITLES);
	await student.page.getByRole("button", { name: "Make a copy" }).click();
	await expect(student.page).toHaveURL(DASHBOARD_URL);
	await expect(student.page.getByText("Saved a copy to your dashboards")).toBeVisible();
	await expect(widgetTitles(student.page)).toHaveText(TITLES);
	const copy = student.page.url();
	// Signed out, the copy stays in this browser.
	expect(
		(await serverDocuments(documentsServer.fake, maria.id)).filter((d) => d.copiedFrom === id)
	).toEqual([]);

	await student.page.goto(url);
	await expectShared(student.page, TITLES);
	await student.page.getByRole("button", { name: "Make a copy" }).click();
	const dialog = student.page.getByRole("dialog");
	await expect(dialog.getByText("You already have a copy of this dashboard")).toBeVisible();
	await dialog.getByRole("button", { name: "Open my copy" }).click();
	await expect(student.page).toHaveURL(copy);
});

test("make a copy signed in: it uploads", async ({ page, documentsServer }) => {
	const id = await savedPlan(page);
	const url = await createLink(page);

	const other = await viewer(documentsServer, sam);
	await other.page.goto(url);
	await expectShared(other.page, TITLES);
	await other.page.getByRole("button", { name: "Make a copy" }).click();
	await expect(other.page).toHaveURL(DASHBOARD_URL);
	await expect(savedToAccount(other.page)).toBeVisible();
	const copyId = idOf(other.page);

	const uploaded = await serverDocuments(documentsServer.fake, sam.id);
	expect(uploaded.map((d) => ({ id: d.id, name: d.name, copiedFrom: d.copiedFrom }))).toEqual([
		{ id: copyId, name: NAME, copiedFrom: id }
	]);
});

test("the copy shows Based on with the display name", async ({ page, documentsServer }) => {
	const id = await savedPlan(page);
	const dialog = await openShare(page);
	const name = dialog.getByRole("textbox", { name: "Your name on shared dashboards (optional)" });
	await expect(name).toBeEnabled();
	await expect(name).toHaveValue("");
	await name.fill("Ms. Rivera");
	await dialog.getByRole("button", { name: "Save name" }).click();
	await expect(dialog.getByText("Name saved")).toBeVisible();
	await dialog.getByRole("button", { name: "Create link" }).click();
	await expect(liveLink(page)).toHaveValue(SHARED_URL);
	const url = await liveLink(page).inputValue();
	expect(documentsServer.fake.requests).toEqual(
		expect.arrayContaining(["getProfile", "setProfile"])
	);

	const student = await viewer(documentsServer, null);
	await student.page.goto(url);
	await expectShared(student.page, TITLES);
	await expect(madeByBar(student.page).getByText("Shared by Ms. Rivera")).toBeVisible();
	await student.page.getByRole("button", { name: "Make a copy" }).click();
	await expect(student.page).toHaveURL(DASHBOARD_URL);
	await expect(student.page.getByTestId("based-on")).toHaveText(`Based on ${NAME} by Ms. Rivera`);
	expect(documentsServer.fake.requests).toContain(`credit ${id}`);

	// The name is kept: the dialog shows it next time.
	await page.keyboard.press("Escape");
	await openShare(page);
	await expect(
		shareDialog(page).getByRole("textbox", { name: "Your name on shared dashboards (optional)" })
	).toHaveValue("Ms. Rivera");
});

test("report this page links to the contact form with the shared path", async ({
	page,
	documentsServer
}) => {
	await savedPlan(page);
	const url = await createLink(page);
	const token = url.split("/").pop()!;

	const student = await viewer(documentsServer, null);
	await student.page.goto(url);
	await expectShared(student.page, TITLES);
	const report = madeByBar(student.page).getByRole("link", { name: "Report this page" });
	await expect(report).toHaveAttribute(
		"href",
		`https://www.sjvair.com/contact/?topic=Report&page=${encodeURIComponent(`/workspace/shared/${token}`)}`
	);
	await expect(report).toHaveAttribute("target", "_blank");
});

test("a link shared on one device shows on the other", async ({ page, documentsServer }) => {
	const id = await savedPlan(page);
	const a2 = await documentsServer.newDevice();
	await a2.page.goto(`./dashboards/${id}`);
	await expect(widgetTitles(a2.page)).toHaveText(TITLES);
	await expect(savedToAccount(a2.page)).toBeVisible();

	// Before: no link yet on either device.
	await openShare(a2.page);
	await expect(shareDialog(a2.page).getByRole("button", { name: "Create link" })).toBeVisible();
	await a2.page.keyboard.press("Escape");
	await expect(shareDialog(a2.page)).toBeHidden();

	const url = await createLink(page);

	// A poll brings the link's sync record over; the open dialog shows it.
	await pollNow(a2.page);
	await openShare(a2.page);
	await expect(liveLink(a2.page)).toHaveValue(url);
	await expectNoViolations(a2.page);
});
