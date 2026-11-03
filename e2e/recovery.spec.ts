/**
 * Recovery across two devices (Maria's phone and laptop, one mocked documents server): restoring
 * and permanently deleting from Recently deleted, restoring an earlier version from the account,
 * and a deleted account's dashboards going. A second device polls at once by becoming visible.
 */
import type { Page } from "@playwright/test";
import { expect, setOffline, test, type DocumentsServer } from "./fixtures";
import {
	DASHBOARD_URL,
	expectNoViolations,
	maria,
	PLACEHOLDER,
	nav,
	openPicker,
	renameWidget,
	setVisibility,
	widgetTitles
} from "./helpers";

test.use({ reducedMotion: "reduce", account: maria });

const NAME = "My dashboard";

/** The starter's first widget renamed, which saves it as Maria's own copy in her account. */
async function ownCopy(page: Page, title = "My first widget"): Promise<void> {
	await page.goto("./");
	await expect(widgetTitles(page)).toHaveCount(3);
	await renameWidget(page, PLACEHOLDER, title);
	await expect(page).toHaveURL(DASHBOARD_URL);
	await expect(savedToAccount(page)).toBeVisible();
}

function savedToAccount(page: Page) {
	return nav(page).getByText("Saved to your account", { exact: true });
}

function recentlyDeleted(page: Page) {
	return page.getByRole("heading", { level: 2, name: "Recently deleted" });
}

async function pollNow(page: Page): Promise<void> {
	await setVisibility(page, "hidden");
	await setVisibility(page, "visible");
}

/** The server's state of the document `id` as Maria sees it. */
async function serverGet(server: DocumentsServer, id: string) {
	server.fake.signedInAs = maria.id;
	return server.fake.get(id);
}

/** Maria's own copy on device A, saved to her account, with another dashboard to land on. */
async function savedCopy(page: Page): Promise<string> {
	await ownCopy(page);
	await expect(savedToAccount(page)).toBeVisible();
	const id = new URL(page.url()).pathname.split("/").pop()!;
	await openPicker(page, NAME);
	await page.getByRole("menuitem", { name: "New blank dashboard" }).click();
	await expect(page).not.toHaveURL(new RegExp(id));
	await expect(page).toHaveURL(DASHBOARD_URL);
	await expect(savedToAccount(page)).toBeVisible();
	return id;
}

/** Deletes the dashboard named `name` from the picker (the open one) and waits for the server. */
async function deleteOpen(page: Page, server: DocumentsServer, id: string, name: string) {
	await page.goto(`./dashboards/${id}`);
	await openPicker(page, name);
	await page.getByRole("menuitem", { name: "Delete dashboard" }).click();
	const toast = page.getByRole("listitem").filter({ hasText: "Dashboard deleted" });
	await expect(toast).toBeVisible();
	await expect(toast).toBeHidden({ timeout: 15_000 });
	await expect.poll(async () => (await serverGet(server, id)).deletedAt).not.toBeNull();
}

test("a dashboard deleted on one device can be restored on the other", async ({
	page,
	documentsServer
}) => {
	const id = await savedCopy(page);
	const b = await documentsServer.newDevice();
	await b.page.goto("./dashboards");
	await expect(b.page.getByRole("link", { name: NAME })).toBeVisible();

	await deleteOpen(page, documentsServer, id, NAME);
	await pollNow(b.page);
	await expect(recentlyDeleted(b.page)).toBeVisible();
	await b.page.getByRole("button", { name: `Restore ${NAME}` }).click();
	await expect(b.page).toHaveURL(new RegExp(`/dashboards/${id}$`));
	await expect.poll(async () => (await serverGet(documentsServer, id)).deletedAt).toBeNull();

	await page.goto("./dashboards");
	await pollNow(page);
	await expect(page.getByRole("link", { name: NAME })).toBeVisible();
	await expect(recentlyDeleted(page)).toHaveCount(0);
});

test("delete now removes it from the account and from the other device", async ({
	page,
	documentsServer
}) => {
	const id = await savedCopy(page);
	const b = await documentsServer.newDevice();
	await deleteOpen(page, documentsServer, id, NAME);
	await b.page.goto("./dashboards#recently-deleted");
	await expect(b.page.getByRole("button", { name: `Restore ${NAME}` })).toBeVisible();

	await page.goto("./dashboards#recently-deleted");
	await page.getByRole("button", { name: `Delete now: ${NAME}` }).click();
	const dialog = page.getByRole("dialog", { name: "Delete this dashboard now?" });
	await expect(dialog).toContainText("removed from your account on every device");
	await expectNoViolations(page);
	await dialog.getByRole("button", { name: "Delete now" }).click();
	await expect(dialog).toBeHidden();
	await expect(recentlyDeleted(page)).toHaveCount(0);
	documentsServer.fake.signedInAs = maria.id;
	await expect(documentsServer.fake.get(id)).rejects.toMatchObject({ code: "gone" });

	await pollNow(b.page);
	await expect(recentlyDeleted(b.page)).toHaveCount(0);
});

test("delete now offline says so and keeps the row", async ({ page, context, documentsServer }) => {
	const id = await savedCopy(page);
	await deleteOpen(page, documentsServer, id, NAME);
	await page.goto("./dashboards#recently-deleted");
	await expect(page.getByRole("button", { name: `Delete now: ${NAME}` })).toBeVisible();

	await setOffline(context, true);
	await page.getByRole("button", { name: `Delete now: ${NAME}` }).click();
	const dialog = page.getByRole("dialog", { name: "Delete this dashboard now?" });
	await dialog.getByRole("button", { name: "Delete now" }).click();
	await expect(
		page.getByText("Couldn't reach your account, so the dashboard wasn't deleted.")
	).toBeVisible();
	await expect(page.getByRole("button", { name: `Restore ${NAME}` })).toBeVisible();
	await setOffline(context, false);
	expect((await serverGet(documentsServer, id)).deletedAt).not.toBeNull();
});

test("restore an earlier version from the account", async ({ page, documentsServer }) => {
	await ownCopy(page, "Before");
	await expect(savedToAccount(page)).toBeVisible();
	// The first save after creation keeps the replaced version as the day's snapshot.
	await renameWidget(page, "Before", "After");
	await expect(savedToAccount(page)).toBeVisible();
	const id = new URL(page.url()).pathname.split("/").pop()!;
	await expect.poll(() => documentsServer.fake.snapshots(id).length).toBeGreaterThan(0);
	const before = documentsServer.fake.snapshots(id).length;

	await openPicker(page, NAME);
	await page.getByRole("menuitem", { name: "Restore an earlier version…" }).click();
	const dialog = page.getByRole("dialog", { name: "Restore an earlier version" });
	const choices = dialog.getByRole("group", { name: "Choose a version" }).getByRole("radio");
	await expect(choices.first()).toBeChecked();
	await expectNoViolations(page);
	await dialog.getByRole("button", { name: "Restore" }).click();
	await expect(dialog).toBeHidden();
	await expect(widgetTitles(page).filter({ hasText: "Before" })).toHaveCount(1);
	await expect(widgetTitles(page).filter({ hasText: "After" })).toHaveCount(0);

	await nav(page).getByRole("button", { name: "Undo" }).click();
	await expect(widgetTitles(page).filter({ hasText: "After" })).toHaveCount(1);

	await nav(page).getByRole("button", { name: "Redo" }).click();
	await expect(widgetTitles(page).filter({ hasText: "Before" })).toHaveCount(1);
	await expect(savedToAccount(page)).toBeVisible();
	const kept = documentsServer.fake.snapshots(id);
	expect(kept.length).toBeGreaterThan(before);
	const conflict = kept.find((s) => s.reason === "conflict");
	expect(conflict).toBeTruthy();
	expect(JSON.stringify(conflict!.body)).toContain("After");
});

test("a deleted account's dashboards are gone on next open", async ({ page, documentsServer }) => {
	await ownCopy(page);
	await expect(savedToAccount(page)).toBeVisible();
	const spaces = () =>
		page.evaluate(
			() =>
				new Promise<string[]>((resolve, reject) => {
					const open = indexedDB.open("sjvair-workspace");
					open.onerror = () => reject(open.error);
					open.onsuccess = () => {
						const db = open.result;
						const rows = db.transaction("documents").objectStore("documents").getAll();
						rows.onsuccess = () => {
							db.close();
							resolve([...new Set(rows.result.map((r: { space: string }) => r.space))]);
						};
					};
				})
		);
	expect(await spaces()).toContain(`account:${maria.id}`);

	const block = JSON.stringify({ v: 1, user: null, deletedAccount: maria.id });
	await page.route(
		(url) => url.pathname.startsWith("/workspace/") && !/\.\w+$/.test(url.pathname),
		async (route) => {
			if (route.request().resourceType() !== "document") return route.fallback();
			const response = await route.fetch();
			const html = (await response.text()).replace(
				"</head>",
				`<script type="application/json" id="sjvair-identity">${block}</script></head>`
			);
			await route.fulfill({ response, body: html });
		}
	);
	documentsServer.fake.signedInAs = null;
	await page.reload();
	// The anonymous space shows: the account's dashboard isn't in it, and Sign in is offered.
	await expect(nav(page).getByRole("link", { name: "Sign in" })).toBeVisible();
	await expect(
		page.getByRole("heading", { level: 1, name: "This dashboard isn't saved in this browser." })
	).toBeVisible();
	await expect.poll(spaces).not.toContain(`account:${maria.id}`);
});
