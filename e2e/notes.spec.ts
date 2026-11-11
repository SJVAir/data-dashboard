/**
 * Notes end to end: adding one and formatting it with the toolbar, keeping it across a reload and
 * in a share link, a hostile link (rendered inert, no CSP violation: `e2e/fixtures.ts` fails any
 * test that sees one), and accessibility of a Note and its editor. The welcome Note on the
 * starter and the Edit note menu item are in `finish-line` and `a11y`.
 */
import type { Locator, Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import {
	DASHBOARD_URL,
	NOTE,
	expectNoViolations,
	expectSaved,
	newBlankDashboard,
	openPicker,
	shareLinkFor,
	widgetTitles
} from "./helpers";

test.use({ reducedMotion: "reduce" });

function editor(page: Page): Locator {
	return page.getByRole("dialog", { name: "Edit note" });
}

function noteBody(page: Page): Locator {
	return page.locator("[data-testid^=widget-]").filter({
		has: page.getByRole("group", { name: NOTE, exact: true })
	});
}

/** Adds a Note to the open dashboard; its editor opens, and `text` is typed with a bulleted line. */
async function addFormattedNote(page: Page): Promise<void> {
	await page.getByRole("button", { name: "Add widget" }).click();
	await page.getByRole("menuitem", { name: "Note", exact: true }).click();
	await expect(editor(page)).toBeVisible();
	const toolbar = editor(page).getByRole("toolbar", { name: "Formatting" });
	await editor(page).getByRole("textbox", { name: "Note text" }).click();
	await page.keyboard.type("Wear a mask");
	await page.keyboard.press("Control+a");
	await toolbar.getByRole("button", { name: "Bold", exact: true }).click();
	await page.keyboard.press("End");
	await page.keyboard.press("Enter");
	await toolbar.getByRole("button", { name: "Bulleted list", exact: true }).click();
	// Bold carries onto the new line; turn it off for the list item.
	await toolbar.getByRole("button", { name: "Bold", exact: true }).click();
	await page.keyboard.type("Check the air first");
	await editor(page).getByRole("button", { name: "Save" }).click();
	await expect(editor(page)).toBeHidden();
}

test("add a Note, format it with the toolbar, reload, and open its share link", async ({
	page,
	documentsServer
}) => {
	await newBlankDashboard(page);
	await addFormattedNote(page);
	await expect(widgetTitles(page)).toHaveText([NOTE]);
	await expect(noteBody(page).locator("strong")).toHaveText("Wear a mask");
	await expect(noteBody(page).getByRole("listitem")).toHaveText("Check the air first");
	await expectSaved(page);

	await page.reload();
	await expect(noteBody(page).locator("strong")).toHaveText("Wear a mask");
	await expect(noteBody(page).getByRole("listitem")).toHaveText("Check the air first");

	await openPicker(page, "Untitled dashboard");
	await page.getByRole("menuitem", { name: "Share…" }).click();
	const link = await page
		.getByRole("dialog", { name: "Share dashboard" })
		.getByRole("textbox", { name: "Link", exact: true })
		.inputValue();
	expect(link).toContain("#1.");

	// Another browser (no storage of its own) opens the link: the Note reads the same.
	const other = await documentsServer.newDevice();
	await other.page.goto(link);
	await expect(other.page).toHaveURL(DASHBOARD_URL);
	await expect(noteBody(other.page).locator("strong")).toHaveText("Wear a mask");
	await expect(noteBody(other.page).getByRole("listitem")).toHaveText("Check the air first");
});

/** A dashboard document with one Note whose options are `options`, as a link carries it. */
function noteDoc(options: unknown) {
	return {
		kind: "dashboard",
		schemaVersion: 1,
		id: "shared-note-1",
		name: "A note",
		body: {
			widgets: [
				{
					id: "w0",
					type: "note",
					title: null,
					rect: { x: 0, y: 0, w: 6, h: 4 },
					data: { layers: [] },
					options
				}
			]
		}
	};
}

const HOSTILE = [
	"<script>window.__pwned = 1; alert(1)</script>",
	'<img src=x onerror="window.__pwned = 2; alert(2)">',
	"[click me](javascript:alert(1))",
	"[data](data:text/html,<script>alert(3)</script>)",
	"[vb](vbscript:msgbox(4))",
	"[proto](//evil.example/x)",
	'<a href="javascript:alert(5)">raw anchor</a>',
	"**still bold**"
].join("\n\n");

test("a hostile Note in a share link renders as inert text", async ({ page }) => {
	let dialogs = 0;
	page.on("dialog", async (dialog) => {
		dialogs++;
		await dialog.dismiss();
	});
	await page.goto(shareLinkFor(noteDoc({ text: HOSTILE })));
	await expect(page).toHaveURL(DASHBOARD_URL);
	const note = noteBody(page);
	await expect(note.locator("strong")).toHaveText("still bold");
	// The HTML is shown as text, not made into elements.
	await expect(note).toContainText("<script>");
	await expect(note).toContainText("onerror");
	await expect(note.locator("script, img, iframe, object, embed, form, style")).toHaveCount(0);
	await expect(note.locator("[onerror], [onclick], [onload]")).toHaveCount(0);
	// No live link carries a script-capable address.
	await expect(
		page.locator(
			"a[href^='javascript:' i], a[href^='data:' i], a[href^='vbscript:' i], a[href^='//']"
		)
	).toHaveCount(0);
	// The text of a refused link stays, as plain text.
	await expect(note).toContainText("click me");
	expect(await page.evaluate(() => (window as unknown as { __pwned?: number }).__pwned)).toBe(
		undefined
	);
	expect(dialogs).toBe(0);
	await expectNoViolations(page);
});

test("a Note naming a message that doesn't exist opens as an empty Note", async ({ page }) => {
	await page.goto(shareLinkFor(noteDoc({ message: "not_a_real_message" })));
	await expect(page).toHaveURL(DASHBOARD_URL);
	await expect(widgetTitles(page)).toHaveText([NOTE]);
	await expect(noteBody(page).locator("script, img, a")).toHaveCount(0);
});

test("a Note naming a message with unsafe characters is refused like any bad link", async ({
	page
}) => {
	await page.goto(shareLinkFor(noteDoc({ message: "<img src=x onerror=alert(1)>" })));
	await expect(
		page.getByRole("heading", { level: 1, name: "This link can't be opened." })
	).toBeVisible();
});

test("a 5,001-character Note is rejected with the usual message; 5,000 opens", async ({ page }) => {
	await page.goto(shareLinkFor(noteDoc({ text: "a".repeat(5001) })));
	await expect(
		page.getByRole("heading", { level: 1, name: "This link can't be opened." })
	).toBeVisible();
	// A link that differs only after the # doesn't reload the page, so leave first.
	await page.goto("about:blank");
	await page.goto(shareLinkFor(noteDoc({ text: "a".repeat(5000) })));
	await expect(page).toHaveURL(DASHBOARD_URL);
	await expect(widgetTitles(page)).toHaveText([NOTE]);
});

for (const colorScheme of ["light", "dark"] as const) {
	for (const [size, viewport] of [
		["desktop", { width: 1280, height: 800 }],
		["phone", { width: 390, height: 844 }]
	] as const) {
		test.describe(`${colorScheme} mode, ${size}`, () => {
			test.use({ colorScheme, viewport });

			test("a Note and its editor have no violations", async ({ page }) => {
				await page.goto("./");
				await expect(page.getByText("Welcome to the SJVAir Dashboard.")).toBeVisible();
				await expectNoViolations(page);
				await page.getByRole("button", { name: `Actions for ${NOTE}`, exact: true }).click();
				await page.getByRole("menuitem", { name: "Edit note", exact: true }).click();
				await expect(editor(page)).toBeVisible();
				await expect(editor(page).getByRole("textbox", { name: "Note text" })).toBeVisible();
				await expectNoViolations(page);
				// Over the limit: the message shows and the Save is off.
				await editor(page).getByRole("textbox", { name: "Note text" }).click();
				await page.keyboard.press("Control+a");
				await page.keyboard.press("Delete");
				await page.keyboard.insertText("a".repeat(5001));
				await expect(editor(page).getByText(/too long to save/)).toBeVisible();
				await expectNoViolations(page);
			});
		});
	}
}
