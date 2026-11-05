import "../../../app.css";
import axe from "axe-core";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { toast } from "svelte-sonner";
import { render } from "vitest-browser-svelte";
import { page } from "vitest/browser";
import { BASE } from "$lib/routing";
import { setPlatform } from "$lib/platform";
import { createMemoryIdentity, createMemoryPlatform } from "$lib/platform/memory";
import { APP_CONTEXT_KEY, initApp, type AppContext } from "$lib/store/app.svelte";
import { createMemoryTabHub } from "$lib/store/tab-channel";
import type { SyncContext } from "$lib/sync/context";
import { createFakeRemote } from "$lib/sync/remote-fake";
import type { Dashboard, WidgetInstance } from "$lib/documents/schema";
import { Toaster } from "$lib/components/ui/sonner";
import {
	ACCOUNT,
	SPACE,
	edit,
	makeDoc,
	storeDoc,
	title,
	user,
	widget
} from "$lib/sync/test-support";
import { uploadDocument } from "$lib/sync/upload";
import { SyncWorker } from "$lib/sync/worker.svelte";
import ConfirmDialog from "./ConfirmDialog.svelte";
import ShareDialog from "./ShareDialog.svelte";
import { openShare, share, type SharePoints } from "./lazy.svelte";
import { animationsSettled } from "../../../test/animations";

const URL_TEXT = "http://localhost/workspace/import#1.abcdef";
const SWAPPED_URL = "http://localhost/workspace/import#1.swapped";
const EXACT_URL = "http://localhost/workspace/import#1.exact";

const mocked = vi.hoisted(() => ({
	placeRegion: vi.fn<() => Promise<{ type: string; code: string } | null>>()
}));
vi.mock("$lib/data", () => ({
	placeRegion: mocked.placeRegion,
	getResolvers: () => ({
		regions: { resolve: async () => ({ id: "z1", name: "ZIP 93721" }) }
	})
}));

beforeEach(() => {
	mocked.placeRegion.mockReset();
	mocked.placeRegion.mockResolvedValue({ type: "zipcode", code: "93721" });
});

const workers: SyncWorker[] = [];
afterEach(() => {
	for (const worker of workers.splice(0)) worker.stop();
	toast.dismiss();
});

/** A signed-out app with the Share dialog mounted. */
async function signedOut() {
	const memory = createMemoryPlatform();
	setPlatform(memory);
	const app = await initApp(memory, { channel: createMemoryTabHub().channel(), tabId: "t1" });
	await render(ShareDialog, { context: new Map([[APP_CONTEXT_KEY, app]]) });
	return { memory, app };
}

/**
 * A signed-in app holding dashboard `d1` (uploaded unless `upload` is false), its sync worker
 * (not started: the test drives it), and the Share and Confirm dialogs mounted.
 */
async function signedIn({ upload = true, doc }: { upload?: boolean; doc?: Dashboard } = {}) {
	const identity = createMemoryIdentity({ state: "signed-in", user: user(ACCOUNT) });
	identity.start();
	identity.currentSpace = async () => SPACE;
	const memory = createMemoryPlatform({ identity });
	setPlatform(memory);
	const fake = createFakeRemote({ accountId: ACCOUNT });
	const app = await initApp(memory, {
		channel: createMemoryTabHub().channel(),
		tabId: "t1",
		loadSync: null
	});
	await storeDoc(memory, doc);
	const ctx: SyncContext = {
		platform: memory,
		space: SPACE,
		accountId: ACCOUNT,
		remote: fake,
		channel: app.channel,
		tabId: app.tabId,
		buildId: "test-build",
		now: () => new Date()
	};
	if (upload) expect(await uploadDocument(ctx, "d1")).toBe("saved");
	const worker = new SyncWorker(ctx);
	workers.push(worker);
	app.sync = worker;
	const context = new Map([[APP_CONTEXT_KEY, app]]);
	await render(ShareDialog, { context });
	await render(ConfirmDialog, { context });
	return { memory, fake, app, worker };
}

const openLive = () =>
	openShare({ url: URL_TEXT, linkUnavailable: null, onDownload() {}, live: { docId: "d1" } });
const liveUrl = (token: string) => `${location.origin}${BASE}/shared/${token}`;
const dialog = () => page.getByRole("dialog", { name: "Share dashboard" });
const liveSection = () => dialog().getByRole("region", { name: "Anyone with the link can view" });
const copySection = () => dialog().getByRole("region", { name: "Send a copy instead" });

async function expectNoAxeViolations() {
	// After the open animation: mid-fade, the text's contrast is measured too low.
	const el = dialog().element();
	await animationsSettled(el);
	const results = await axe.run(el);
	expect(results.violations).toEqual([]);
}

/** Opens the dialog and creates the live link; resolves its token. */
async function createLink(worker: SyncWorker): Promise<string> {
	openLive();
	await liveSection().getByRole("button", { name: "Create link" }).click();
	await expect.poll(() => worker.states.d1?.shareToken).toBeTruthy();
	return worker.states.d1!.shareToken!;
}

test("Copy writes the link and announces it in a live region", async () => {
	const { memory } = await signedOut();
	openShare({ url: URL_TEXT, linkUnavailable: null, onDownload() {}, live: null });
	await expect
		.element(
			dialog().getByText(
				"Anyone who opens this link gets their own copy. They won't see changes you make later."
			)
		)
		.toBeInTheDocument();
	await dialog().getByRole("button", { name: "Copy link" }).click();
	expect(memory.clipboard.last).toBe(URL_TEXT);
	await expect.element(dialog().getByRole("status").first()).toHaveTextContent("Link copied");
});

test("when copying is refused, the field is focused with the whole link selected", async () => {
	const { memory } = await signedOut();
	memory.clipboard.fail(true);
	openShare({ url: URL_TEXT, linkUnavailable: null, onDownload() {}, live: null });
	await dialog().getByRole("button", { name: "Copy link" }).click();
	const field = dialog().getByRole("textbox", { name: "Link" });
	await expect.element(field).toHaveFocus();
	const el = field.element() as HTMLInputElement;
	expect(el.selectionStart).toBe(0);
	expect(el.selectionEnd).toBe(URL_TEXT.length);
	await expect.element(dialog().getByRole("status").first()).toHaveTextContent("");
	expect(dialog().getByText("Link copied").elements()).toHaveLength(0);
});

test("a dashboard too big for a link shows the message and only the download button", async () => {
	await signedOut();
	let downloaded = 0;
	openShare({
		url: null,
		linkUnavailable: "too-big",
		onDownload: () => downloaded++,
		live: null
	});
	await expect
		.element(
			dialog().getByText(
				"This dashboard is too big to share as a link. Download it as a file and send that instead."
			)
		)
		.toBeInTheDocument();
	expect(dialog().getByRole("textbox").elements()).toHaveLength(0);
	expect(dialog().getByRole("button", { name: "Copy link" }).elements()).toHaveLength(0);
	await dialog().getByRole("button", { name: "Download file instead" }).click();
	expect(downloaded).toBe(1);
});

test("Share on a read-only dashboard opens the dialog with the download only", async () => {
	const { memory } = await signedOut();
	const { shareDashboard } = await import("$lib/sharing/actions");
	const doc = { kind: "dashboard", schemaVersion: 99, id: "d1", name: "Newer", body: {}, extra: 1 };
	const app = {
		current: { isStarter: false, session: { readOnly: "newer", doc, flush: async () => {} } },
		index: { names: new Map() },
		sync: null
	} as unknown as AppContext;
	await shareDashboard(app);
	await expect
		.element(dialog().getByRole("button", { name: "Download file instead" }))
		.toBeVisible();
	expect(dialog().getByRole("textbox").elements()).toHaveLength(0);
	await dialog().getByRole("button", { name: "Download file instead" }).click();
	expect(memory.files.saved).toHaveLength(1);
	expect(JSON.parse(memory.files.saved[0].contents).documents[0].extra).toBe(1);
});

test("signed out shows the copy link and a sign-in line", async () => {
	await signedOut();
	openShare({ url: URL_TEXT, linkUnavailable: null, onDownload() {}, live: null });
	await expect.element(dialog().getByRole("textbox", { name: "Link" })).toHaveValue(URL_TEXT);
	const signIn = dialog().getByRole("link", {
		name: "Sign in to share a live link that stays up to date."
	});
	await expect.element(signIn).toBeVisible();
	expect(signIn.element().getAttribute("href")).toMatch(/^\/account\/login\/\?next=/);
	expect(dialog().getByRole("button", { name: "Create link" }).elements()).toHaveLength(0);
});

test("create link shows and selects the live link", async () => {
	const { app, fake, worker } = await signedIn();
	const { shareDashboard } = await import("$lib/sharing/actions");
	app.current = { session: (await app.sessions.get("d1"))!, isStarter: false };
	await shareDashboard(app);
	await expect
		.element(
			liveSection().getByText(
				"Students and others can open it without an account. They see your changes as you make them."
			)
		)
		.toBeVisible();
	expect(liveSection().getByRole("textbox", { name: "Live link" }).elements()).toHaveLength(0);
	await liveSection().getByRole("button", { name: "Create link" }).click();
	const field = liveSection().getByRole("textbox", { name: "Live link" });
	await expect.element(field).toHaveFocus();
	const token = worker.states.d1!.shareToken!;
	expect(fake.requests).toContain("share d1");
	await expect.element(field).toHaveValue(liveUrl(token));
	const el = field.element() as HTMLInputElement;
	expect(el.selectionStart).toBe(0);
	expect(el.selectionEnd).toBe(liveUrl(token).length);
	await expect.element(liveSection().getByRole("button", { name: "Stop sharing" })).toBeVisible();
	expect(liveSection().getByRole("button", { name: "Create link" }).elements()).toHaveLength(0);
});

test("copy puts the live link on the clipboard", async () => {
	const { memory, worker } = await signedIn();
	const token = await createLink(worker);
	await liveSection().getByRole("button", { name: "Copy link" }).click();
	expect(memory.clipboard.last).toBe(liveUrl(token));
	await expect.element(dialog().getByText("Link copied")).toBeVisible();
	await expectNoAxeViolations();
});

test("an already shared dashboard opens with its link selected", async () => {
	const { worker } = await signedIn();
	await worker.share("d1");
	openLive();
	const field = liveSection().getByRole("textbox", { name: "Live link" });
	await expect.element(field).toHaveFocus();
	await expect.element(field).toHaveValue(liveUrl(worker.states.d1!.shareToken!));
});

test("stop sharing asks, then turns the link off", async () => {
	const { fake, worker } = await signedIn();
	await createLink(worker);
	await liveSection().getByRole("button", { name: "Stop sharing" }).click();
	const confirm = page.getByRole("dialog", { name: "Stop sharing this dashboard?" });
	await expect
		.element(
			confirm.getByText(
				"The link stops working for everyone who has it. If you share again, you'll get a new link."
			)
		)
		.toBeVisible();
	await confirm.getByRole("button", { name: "Stop sharing" }).click();
	await expect.element(dialog().getByText("Link turned off")).toBeVisible();
	expect(fake.requests).toContain("unshare d1");
	expect(worker.states.d1?.shareToken).toBeNull();
	expect(liveSection().getByRole("textbox", { name: "Live link" }).elements()).toHaveLength(0);
	await expect.element(liveSection().getByRole("button", { name: "Create link" })).toBeVisible();
});

test("cancelling stop sharing keeps the link", async () => {
	const { fake, worker } = await signedIn();
	const token = await createLink(worker);
	await liveSection().getByRole("button", { name: "Stop sharing" }).click();
	const confirm = page.getByRole("dialog", { name: "Stop sharing this dashboard?" });
	await confirm.getByRole("button", { name: "Cancel" }).click();
	await expect.element(confirm).not.toBeInTheDocument();
	expect(fake.requests).not.toContain("unshare d1");
	await expect
		.element(liveSection().getByRole("textbox", { name: "Live link" }))
		.toHaveValue(liveUrl(token));
});

test("unsynced changes: the dialog says the link shows the last saved version", async () => {
	const { memory, fake, worker } = await signedIn();
	await edit(memory, [title("a", "Newer")]);
	openLive();
	// After the display name loads: the upload before sharing fails, the share goes through.
	await expect.element(dialog().getByRole("button", { name: "Save name" })).toBeEnabled();
	fake.refuseNext.push({ code: "unknown", status: 503 });
	await liveSection().getByRole("button", { name: "Create link" }).click();
	await expect.poll(() => worker.states.d1?.shareToken).toBeTruthy();
	await expect
		.element(
			liveSection().getByText(
				"The link shows this dashboard as last saved to your account. Your newest changes will appear once they're saved."
			)
		)
		.toBeVisible();
});

test("never uploaded: says why it can't share", async () => {
	const { fake } = await signedIn({ upload: false });
	fake.maxDocuments = 0;
	openLive();
	await liveSection().getByRole("button", { name: "Create link" }).click();
	await expect
		.element(
			liveSection().getByText(
				"This dashboard isn't saved to your account yet, so it can't have a link."
			)
		)
		.toBeVisible();
	await expect
		.element(
			liveSection().getByText(
				"Your account holds as many dashboards as it can, so this one is only in this browser. Deleting one you don't need makes room."
			)
		)
		.toBeVisible();
	expect(liveSection().getByRole("textbox", { name: "Live link" }).elements()).toHaveLength(0);
});

test("blocked and offline say so", async () => {
	const { fake } = await signedIn();
	fake.disableSharing("d1");
	openLive();
	const create = liveSection().getByRole("button", { name: "Create link" });
	await create.click();
	await expect
		.element(liveSection().getByText("Sharing is turned off for this dashboard."))
		.toBeVisible();
	fake.offline = true;
	await create.click();
	await expect
		.element(liveSection().getByText("Couldn't reach SJVAir. Check your connection and try again."))
		.toBeVisible();
	expect(
		liveSection().getByText("Sharing is turned off for this dashboard.").elements()
	).toHaveLength(0);
});

test("the display name saves, and a refused one says so", async () => {
	const { fake } = await signedIn();
	await fake.setProfile("Ms. Lopez");
	openLive();
	const field = dialog().getByRole("textbox", {
		name: "Your name on shared dashboards (optional)"
	});
	await expect.element(field).toHaveValue("Ms. Lopez");
	await expect
		.element(
			dialog().getByText(
				"Shown on your shared dashboards and on copies made from them. Leave it empty to show no name."
			)
		)
		.toBeVisible();
	await field.fill("Room 12");
	await dialog().getByRole("button", { name: "Save name" }).click();
	await expect.poll(async () => (await fake.getProfile()).displayName).toBe("Room 12");
	await field.fill("x".repeat(61));
	await dialog().getByRole("button", { name: "Save name" }).click();
	await expect
		.element(dialog().getByText("That name can't be used. Try a shorter one."))
		.toBeVisible();
	expect((await fake.getProfile()).displayName).toBe("Room 12");
});

test("a name refused for rate or sign-in says why", async () => {
	const { fake } = await signedIn();
	openLive();
	const field = dialog().getByRole("textbox", {
		name: "Your name on shared dashboards (optional)"
	});
	await expect.element(field).toBeEnabled();
	await field.fill("Room 12");
	fake.refuseNext.push({ code: "rate_limited", status: 429 });
	await dialog().getByRole("button", { name: "Save name" }).click();
	await expect
		.element(dialog().getByText("Too many changes in a short time. Wait a minute and try again."))
		.toBeVisible();
	fake.refuseNext.push({ code: "unauthorized", status: 401 });
	await dialog().getByRole("button", { name: "Save name" }).click();
	await expect
		.element(
			dialog().getByText("You're signed out, so the name wasn't saved. Sign in and try again.")
		)
		.toBeVisible();
	fake.offline = true;
	await dialog().getByRole("button", { name: "Save name" }).click();
	await expect
		.element(dialog().getByText("Couldn't reach SJVAir. Check your connection and try again."))
		.toBeVisible();
});

test("a name refused for another reason says something went wrong", async () => {
	const { fake } = await signedIn();
	openLive();
	const field = dialog().getByRole("textbox", {
		name: "Your name on shared dashboards (optional)"
	});
	await expect.element(field).toBeEnabled();
	fake.refuseNext.push({ code: "forbidden", status: 403 });
	await dialog().getByRole("button", { name: "Save name" }).click();
	await expect.element(dialog().getByText("Something went wrong. Please try again.")).toBeVisible();
});

test("an opening without a live link has no name field, even after a failed load", async () => {
	const { fake, memory } = await signedIn();
	fake.offline = true;
	openLive();
	await expect.element(dialog().getByRole("button", { name: "Try again" })).toBeVisible();
	openShare({ url: URL_TEXT, linkUnavailable: null, onDownload() {}, live: null });
	await expect
		.element(dialog().getByRole("button", { name: "Download file instead" }))
		.toBeVisible();
	fake.offline = false;
	memory.online.setOnline(false);
	memory.online.setOnline(true);
	expect(
		dialog()
			.getByRole("textbox", { name: /Your name/ })
			.elements()
	).toHaveLength(0);
	expect(dialog().getByRole("button", { name: "Try again" }).elements()).toHaveLength(0);
});

test("a name that failed to load can be retried", async () => {
	const { fake } = await signedIn();
	await fake.setProfile("Ms. Lopez");
	fake.offline = true;
	openLive();
	const retry = dialog().getByRole("button", { name: "Try again" });
	await expect.element(retry).toBeVisible();
	fake.offline = false;
	await retry.click();
	const field = dialog().getByRole("textbox", {
		name: "Your name on shared dashboards (optional)"
	});
	await expect.element(field).toHaveValue("Ms. Lopez");
	await expect.element(field).toBeEnabled();
	expect(dialog().getByRole("button", { name: "Try again" }).elements()).toHaveLength(0);
});

test("a name refused while loading isn't called a connection problem", async () => {
	for (const [code, status, text] of [
		["unauthorized", 401, "You're signed out, so your name can't be shown. Sign in and try again."],
		["rate_limited", 429, "Your name couldn't be loaded. Try again in a moment."]
	] as const) {
		const { fake } = await signedIn();
		fake.refuseNext.push({ code, status });
		openLive();
		await expect.element(dialog().getByText(text)).toBeVisible();
		expect(
			dialog().getByText("Couldn't reach SJVAir. Check your connection and try again.").elements()
		).toHaveLength(0);
		await expect.element(dialog().getByRole("button", { name: "Try again" })).toBeVisible();
	}
});

test("a name that couldn't be loaded offline says to check the connection", async () => {
	const { fake } = await signedIn();
	fake.offline = true;
	openLive();
	await expect
		.element(dialog().getByText("Couldn't reach SJVAir. Check your connection and try again."))
		.toBeVisible();
});

test("a name that failed to load reloads when the connection returns", async () => {
	const { fake, memory } = await signedIn();
	await fake.setProfile("Ms. Lopez");
	fake.offline = true;
	openLive();
	await expect.element(dialog().getByRole("button", { name: "Try again" })).toBeVisible();
	fake.offline = false;
	memory.online.setOnline(false);
	memory.online.setOnline(true);
	await expect
		.element(dialog().getByRole("textbox", { name: "Your name on shared dashboards (optional)" }))
		.toHaveValue("Ms. Lopez");
});

test("a read-only dashboard says why it has no link", async () => {
	await signedOut();
	openShare({ url: null, linkUnavailable: "read-only", onDownload() {}, live: null });
	await expect
		.element(
			dialog().getByText(
				"This dashboard is open read-only, so it can't be shared as a link. You can download it as a file instead."
			)
		)
		.toBeVisible();
	expect(dialog().getByText("too big").elements()).toHaveLength(0);
});

test("downloading says the file is on its way", async () => {
	await signedOut();
	openShare({ url: URL_TEXT, linkUnavailable: null, onDownload() {}, live: null });
	await dialog().getByRole("button", { name: "Download file instead" }).click();
	await expect.element(dialog().getByText("Your file is downloading.")).toBeVisible();
});

test("send a copy instead still offers the link and the file", async () => {
	const { memory, worker } = await signedIn();
	let downloaded = 0;
	openShare({
		url: URL_TEXT,
		linkUnavailable: null,
		onDownload: () => downloaded++,
		live: { docId: "d1" }
	});
	await expect
		.element(copySection().getByRole("heading", { name: "Send a copy instead" }))
		.toBeVisible();
	await expect
		.element(
			copySection().getByText(
				"Anyone who opens this link gets their own copy. They won't see changes you make later."
			)
		)
		.toBeVisible();
	await expect.element(copySection().getByRole("textbox", { name: "Link" })).toHaveValue(URL_TEXT);
	await copySection().getByRole("button", { name: "Copy link" }).click();
	expect(memory.clipboard.last).toBe(URL_TEXT);
	await copySection().getByRole("button", { name: "Download file instead" }).click();
	expect(downloaded).toBe(1);
	expect(worker.states.d1?.shareToken ?? null).toBeNull();
});

// Location privacy

const POINT = { kind: "point", lat: 36.7378, lon: -119.7871 } as const;

function pointWidget(id: string): WidgetInstance {
	return {
		...widget(id),
		type: "chart",
		data: { layers: [{ dataset: "air-quality", entryType: "pm25", place: POINT }] }
	};
}

const withPoints = (...ids: string[]): Dashboard => ({
	...makeDoc(),
	body: { widgets: ids.map(pointWidget) }
});

/** Counts the swapped and exact downloads of an opening with points. */
function pointsOffer(overrides: Partial<SharePoints> = {}) {
	const downloads = { swapped: 0, exact: 0 };
	const points: SharePoints = {
		summary: { kind: "one", region: "ZIP 93721" },
		swapped: { url: SWAPPED_URL, linkUnavailable: null, onDownload: () => downloads.swapped++ },
		exact: { url: EXACT_URL, linkUnavailable: null, onDownload: () => downloads.exact++ },
		useRegion() {},
		...overrides
	};
	return { downloads, points };
}

const NOTICE = "Your location is shared as ZIP 93721, not your exact position.";
const WARNING = "Anyone with the link or file will see your exact location.";

test("with an exact location, the copy link and file share its region unless the owner chooses", async () => {
	await signedOut();
	const { downloads, points } = pointsOffer();
	openShare({ live: null, points: async () => points });
	const link = dialog().getByRole("textbox", { name: "Link" });
	await expect.element(link).toHaveValue(SWAPPED_URL);
	await expect.element(dialog().getByText(NOTICE)).toBeVisible();
	expect(dialog().getByText(WARNING).elements()).toHaveLength(0);
	await dialog().getByRole("button", { name: "Download file instead" }).click();
	expect(downloads).toEqual({ swapped: 1, exact: 0 });

	const exact = dialog().getByRole("checkbox", { name: "Share my exact location instead" });
	await expect.element(exact).not.toBeChecked();
	await exact.click();
	await expect.element(dialog().getByText(WARNING)).toBeVisible();
	await expect.element(link).toHaveValue(EXACT_URL);
	await dialog().getByRole("button", { name: "Download file instead" }).click();
	expect(downloads).toEqual({ swapped: 1, exact: 1 });
	await expectNoAxeViolations();

	// Chosen per share: the next opening starts with the region again.
	share.open = false;
	await expect.element(dialog()).not.toBeInTheDocument();
	openShare({ live: null, points: async () => points });
	await expect.element(dialog().getByRole("textbox", { name: "Link" })).toHaveValue(SWAPPED_URL);
	await expect
		.element(dialog().getByRole("checkbox", { name: "Share my exact location instead" }))
		.not.toBeChecked();
});

test("a failed lookup offers no link or file until Retry succeeds", async () => {
	await signedOut();
	const { points } = pointsOffer();
	let calls = 0;
	openShare({
		live: null,
		points: async () => {
			if (++calls === 1) throw new Error("offline");
			return points;
		}
	});
	await expect.element(dialog().getByText("Can't look up your area right now.")).toBeVisible();
	expect(dialog().getByRole("textbox").elements()).toHaveLength(0);
	expect(dialog().getByRole("button", { name: "Download file instead" }).elements()).toHaveLength(
		0
	);
	expect(dialog().getByRole("button", { name: "Copy link" }).elements()).toHaveLength(0);
	await dialog().getByRole("button", { name: "Retry" }).click();
	await expect.element(dialog().getByRole("textbox", { name: "Link" })).toHaveValue(SWAPPED_URL);
	expect(dialog().getByText("Can't look up your area right now.").elements()).toHaveLength(0);
	expect(calls).toBe(2);
});

test("Share builds the region copy from a real lookup, and a failed one waits for Retry", async () => {
	const { memory } = await signedOut();
	const { shareDashboard } = await import("$lib/sharing/actions");
	const session = { readOnly: false, doc: withPoints("p"), flush: async () => {} };
	const app = {
		current: { isStarter: false, session },
		index: { names: new Map(), items: [], deleted: [] },
		sync: null
	} as unknown as AppContext;
	mocked.placeRegion.mockRejectedValueOnce(new Error("offline"));
	await shareDashboard(app);
	await expect.element(dialog().getByText("Can't look up your area right now.")).toBeVisible();
	await dialog().getByRole("button", { name: "Retry" }).click();
	await expect.element(dialog().getByText(NOTICE)).toBeVisible();
	const link = dialog().getByRole("textbox", { name: "Link" });
	await expect.element(link).toBeVisible();
	const swappedUrl = (link.element() as HTMLInputElement).value;
	expect(swappedUrl).toContain("/workspace/import#");
	await dialog().getByRole("button", { name: "Download file instead" }).click();
	const file = memory.files.saved[0].contents;
	expect(file).toContain('"zipcode"');
	expect(file).not.toContain("36.7378");
	await dialog().getByRole("checkbox", { name: "Share my exact location instead" }).click();
	await expect.element(link).not.toHaveValue(swappedUrl);
	await dialog().getByRole("button", { name: "Download file instead" }).click();
	expect(memory.files.saved[1].contents).toContain("36.7378");
});

test("Export always saves the region and says so", async () => {
	const { memory } = await signedOut();
	await render(Toaster);
	const { exportDashboard } = await import("$lib/sharing/actions");
	const app = {
		current: {
			isStarter: false,
			session: { readOnly: false, doc: withPoints("p"), flush: async () => {} }
		},
		index: { names: new Map(), items: [], deleted: [] },
		sync: null
	} as unknown as AppContext;
	await exportDashboard(app);
	expect(memory.files.saved).toHaveLength(1);
	expect(memory.files.saved[0].contents).toContain('"zipcode"');
	expect(memory.files.saved[0].contents).not.toContain("36.7378");
	await expect
		.poll(() => document.querySelector("[data-sonner-toast]")?.textContent)
		.toContain(NOTICE);
});

test("before a live link, Use ZIP 93721 instead swaps the points in one undoable edit", async () => {
	const { app, worker } = await signedIn({ doc: withPoints("p", "q") });
	const { shareDashboard } = await import("$lib/sharing/actions");
	const session = (await app.sessions.get("d1"))!;
	app.current = { session, isStarter: false };
	const applied = vi.spyOn(session, "apply");
	await shareDashboard(app);
	await expect
		.element(liveSection().getByText("This dashboard includes your exact location."))
		.toBeVisible();
	expect(liveSection().getByRole("button", { name: "Create link" }).elements()).toHaveLength(0);
	await expectNoAxeViolations();
	await liveSection().getByRole("button", { name: "Use ZIP 93721 instead" }).click();
	await expect.poll(() => worker.states.d1?.shareToken).toBeTruthy();
	await expect.element(liveSection().getByRole("textbox", { name: "Live link" })).toBeVisible();
	expect(applied.mock.calls.map(([change]) => change.op)).toEqual(["replaceDocument"]);
	const places = () => session.doc.body.widgets.map((w) => w.data.layers[0].place);
	expect(places()).toEqual([
		{ kind: "region", type: "zipcode", code: "93721" },
		{ kind: "region", type: "zipcode", code: "93721" }
	]);
	session.undo();
	expect(places()).toEqual([POINT, POINT]);
	expect(session.canUndo).toBe(false);
});

test("Share my exact location warns, then creates the link with the point kept", async () => {
	const { app, worker } = await signedIn({ doc: withPoints("p") });
	const { shareDashboard } = await import("$lib/sharing/actions");
	const session = (await app.sessions.get("d1"))!;
	app.current = { session, isStarter: false };
	await shareDashboard(app);
	await liveSection().getByRole("button", { name: "Share my exact location" }).click();
	await expect.element(liveSection().getByText(WARNING)).toBeVisible();
	await expect.poll(() => worker.states.d1?.shareToken).toBeTruthy();
	expect(session.doc.body.widgets[0].data.layers[0].place).toEqual(POINT);
	expect(session.canUndo).toBe(false);
});

test("with one point widget, Use ZIP 93721 instead edits only that widget's data", async () => {
	const doc = withPoints("p");
	doc.body.widgets.push(widget("other"));
	const { app, worker } = await signedIn({ doc });
	const { shareDashboard } = await import("$lib/sharing/actions");
	const session = (await app.sessions.get("d1"))!;
	app.current = { session, isStarter: false };
	const applied = vi.spyOn(session, "apply");
	await shareDashboard(app);
	await liveSection().getByRole("button", { name: "Use ZIP 93721 instead" }).click();
	await expect.poll(() => worker.states.d1?.shareToken).toBeTruthy();
	// Not a whole-document replacement: a concurrent edit elsewhere doesn't conflict with it.
	expect(applied.mock.calls.map(([change]) => change.op)).toEqual(["setWidgetData"]);
	expect(session.doc.body.widgets[0].data.layers[0].place).toEqual({
		kind: "region",
		type: "zipcode",
		code: "93721"
	});
	session.undo();
	expect(session.doc.body.widgets[0].data.layers[0].place).toEqual(POINT);
	expect(session.canUndo).toBe(false);
});
