import { expect, test } from "vitest";
import { render } from "vitest-browser-svelte";
import { page } from "vitest/browser";
import { createMemoryPlatform } from "$lib/platform/memory";
import { setPlatform } from "$lib/platform";
import ShareDialog, { openShare } from "./ShareDialog.svelte";

const URL_TEXT = "http://localhost/workspace/import#1.abcdef";

test("Copy writes the link and announces it in a live region", async () => {
	const memory = createMemoryPlatform();
	setPlatform(memory);
	await render(ShareDialog);
	openShare({ url: URL_TEXT, onDownload() {} });
	const dialog = page.getByRole("dialog");
	await expect
		.element(
			dialog.getByText(
				"Anyone who opens this link gets their own copy. They won't see changes you make later."
			)
		)
		.toBeInTheDocument();
	await dialog.getByRole("button", { name: "Copy link" }).click();
	expect(memory.clipboard.last).toBe(URL_TEXT);
	await expect.element(dialog.getByRole("status")).toHaveTextContent("Link copied");
});

test("when copying is refused, the field is focused with the whole link selected", async () => {
	const memory = createMemoryPlatform();
	memory.clipboard.fail(true);
	setPlatform(memory);
	await render(ShareDialog);
	openShare({ url: URL_TEXT, onDownload() {} });
	const dialog = page.getByRole("dialog");
	await dialog.getByRole("button", { name: "Copy link" }).click();
	const field = dialog.getByRole("textbox", { name: "Link" });
	await expect.element(field).toHaveFocus();
	const el = field.element() as HTMLInputElement;
	expect(el.selectionStart).toBe(0);
	expect(el.selectionEnd).toBe(URL_TEXT.length);
	await expect.element(dialog.getByRole("status")).toHaveTextContent("");
	expect(dialog.getByText("Link copied").elements()).toHaveLength(0);
});

test("a dashboard too big for a link shows the message and only the download button", async () => {
	setPlatform(createMemoryPlatform());
	let downloaded = 0;
	await render(ShareDialog);
	openShare({ url: null, onDownload: () => downloaded++ });
	const dialog = page.getByRole("dialog");
	await expect
		.element(
			dialog.getByText(
				"This dashboard is too big to share as a link. Download it as a file and send that instead."
			)
		)
		.toBeInTheDocument();
	expect(dialog.getByRole("textbox").elements()).toHaveLength(0);
	expect(dialog.getByRole("button", { name: "Copy link" }).elements()).toHaveLength(0);
	await dialog.getByRole("button", { name: "Download file instead" }).click();
	expect(downloaded).toBe(1);
});

test("Share on a read-only dashboard opens the dialog with the download only", async () => {
	const memory = createMemoryPlatform();
	setPlatform(memory);
	const { shareDashboard } = await import("$lib/sharing/actions");
	const doc = { kind: "dashboard", schemaVersion: 99, id: "d1", name: "Newer", body: {}, extra: 1 };
	const app = {
		current: { isStarter: false, session: { readOnly: "newer", doc, flush: async () => {} } },
		index: { names: new Map() }
	} as unknown as Parameters<typeof shareDashboard>[0];
	await render(ShareDialog);
	await shareDashboard(app);
	const dialog = page.getByRole("dialog");
	await expect.element(dialog.getByRole("button", { name: "Download file instead" })).toBeVisible();
	expect(dialog.getByRole("textbox").elements()).toHaveLength(0);
	await dialog.getByRole("button", { name: "Download file instead" }).click();
	expect(memory.files.saved).toHaveLength(1);
	expect(JSON.parse(memory.files.saved[0].contents).documents[0].extra).toBe(1);
});
