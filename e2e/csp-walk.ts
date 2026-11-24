/**
 * The CSP walk: one list of steps that opens every route (`csp-walk-routes.ts`) and the lazy parts
 * a person opens from them in the built app (the few it can't reach are listed in `DEFERRED.md`). `csp-walk.spec.ts` runs it on the E2E fakes under the
 * contract CSP; the local stack run (`e2e-local/`) runs the same steps against sjvair.com's real
 * enforced header, signed in, on real data. So no step names fixture data (titles, places,
 * monitor ids): each finds things by role and the app's own English labels, and reads what it
 * needs (the Map's title, the dashboard's address, the share links) from the page.
 *
 * Imports only Playwright and the route list (never `./fixtures` or a fixture server), since the
 * stack run imports it too.
 */
import {
	expect,
	type BrowserContext,
	type ConsoleMessage,
	type Locator,
	type Page
} from "@playwright/test";

/** Where the walk runs: the E2E fakes, or the local sjvair.com stack. */
export type WalkTarget = "fakes" | "stack";

/** What earlier steps found, for later ones. */
export type WalkState = {
	/** The dashboard the walk made (its absolute address). */
	dashboardUrl?: string;
	/** Its Map widget's title, as the page shows it. */
	mapTitle?: string;
	/** Its copy link (`…/import#…`). */
	shareLink?: string;
	/** Its live link (`…/shared/:token`). */
	liveLink?: string;
};

/** One named step: opens one route or lazy part and waits for its content. */
export type WalkStep = {
	name: string;
	/** The targets it runs on (omitted: both). */
	on?: WalkTarget[];
	run(page: Page, state: WalkState): Promise<void>;
};

const DASHBOARD_URL = /\/workspace\/dashboards\/[0-9a-f-]{36}$/;
const NEW_WIDGET_URL = /\/workspace\/dashboards\/[0-9a-f-]{36}\/widgets\/new(\?.*)?$/;
const EDIT_URL = /\/workspace\/dashboards\/[0-9a-f-]{36}\/widgets\/[^/]+\/edit$/;
const SHARED_URL = /\/workspace\/shared\/[^/]+$/;
const DATA_PORTAL = { level: 1, name: "Data Portal" } as const;
/** A generated Map title ("{shows} map" or "{shows} map · {place}"). */
const MAP_TITLE = / map( · .+)?$/;
/** The welcome Note's title, and the bold start of its text (rendered by `marked`). */
const NOTE = "Note";
const WELCOME = "Welcome to the SJVAir Dashboard.";

/**
 * Whether the page's browser can make a WebGL context (copied from `helpers.ts`, which imports
 * fixture code). Without it a Map draws no map region, only its frame and title.
 */
function hasWebGL(page: Page): Promise<boolean> {
	return page.evaluate(() => {
		const canvas = document.createElement("canvas");
		return !!(canvas.getContext("webgl2") ?? canvas.getContext("webgl"));
	});
}

function need<T>(value: T | undefined, what: string): T {
	if (value === undefined) throw new Error(`The walk has no ${what} (an earlier step failed)`);
	return value;
}

/** The widgets' titles, in reading order. */
function widgetTitles(page: Page): Locator {
	return page.getByRole("main").getByRole("heading", { level: 2 });
}

/** The Map widget's region (it holds the GL map and its UI), by its title. */
function mapOf(page: Page, title: string): Locator {
	const escaped = title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	return page.getByRole("region", { name: new RegExp(`^${escaped}(?:\\.|$)`) });
}

/**
 * The first Map widget's title, once its data has loaded. A widget's code loads when it comes near
 * the screen, and a Map is titled "Map" until then, so it's scrolled into view first.
 */
async function readMapTitle(page: Page, known?: string): Promise<string> {
	const loading = widgetTitles(page).filter({ hasText: /^Map$/ });
	const loaded = known
		? widgetTitles(page).filter({ hasText: known })
		: widgetTitles(page).filter({ hasText: MAP_TITLE });
	const either = loading.or(loaded).first();
	await expect(either).toBeVisible();
	await either.scrollIntoViewIfNeeded();
	await expect(loaded.first()).toBeVisible({ timeout: 15_000 });
	return (await loaded.first().textContent())!.trim();
}

/** The widget titled `title` (its frame), for what's inside it. */
function widgetOf(page: Page, title: string): Locator {
	return page
		.locator("[data-testid^=widget-]")
		.filter({ has: page.getByRole("group", { name: title, exact: true }) });
}

/** Waits for the Map titled `title` to draw (its GL map), where the browser has WebGL. */
async function expectMapDrawn(page: Page, title: string): Promise<void> {
	if (!(await hasWebGL(page))) return;
	const map = mapOf(page, title);
	await expect(map).toBeVisible();
	await expect(map.getByRole("region", { name: "Map", exact: true })).toBeVisible();
}

/** The welcome Note's rendered text. */
async function expectNoteRendered(page: Page): Promise<void> {
	const note = widgetOf(page, NOTE).first();
	await expect(note.locator("strong", { hasText: WELCOME })).toBeVisible();
}

/** Opens the widget titled `title`'s ⋯ menu and picks `item`. */
async function widgetMenuItem(page: Page, title: string, item: string): Promise<void> {
	await page
		.getByRole("button", { name: `Actions for ${title}`, exact: true })
		.first()
		.click();
	await page.getByRole("menuitem", { name: item, exact: true }).click();
}

/** Opens the dashboard's ⋯ menu ("Dashboard actions") and picks `item`. */
async function dashboardMenuItem(page: Page, item: string): Promise<void> {
	await page.getByRole("button", { name: "Dashboard actions", exact: true }).click();
	await page.getByRole("menuitem", { name: item, exact: true }).click();
}

/** Closes every open dialog with Escape (one at a time: a question can sit over a picker). */
async function escapeDialogs(page: Page): Promise<void> {
	const dialogs = page.getByRole("dialog");
	await expect(dialogs.first()).toBeVisible();
	await expect(async () => {
		if ((await dialogs.count()) > 0) await page.keyboard.press("Escape");
		await expect(dialogs).toHaveCount(0, { timeout: 1_000 });
	}).toPass();
}

async function backToDashboard(page: Page, state: WalkState): Promise<void> {
	const url = need(state.dashboardUrl, "dashboard");
	if (page.url() !== url) await page.goto(url);
	await expect(page).toHaveURL(url);
	await expect(widgetTitles(page).first()).toBeVisible();
	if (state.mapTitle) await readMapTitle(page, state.mapTitle);
}

/** The Data Portal, open and drawn. */
async function expectDataPortal(page: Page): Promise<void> {
	await expect(page.getByRole("heading", DATA_PORTAL)).toBeVisible();
}

/**
 * Whether a widget's body has loaded its code and data. `el` is a dashboard widget's frame or the
 * Data Portal's preview; either holds its title first and its body second. The body is empty
 * until its code is asked for, then shows a skeleton (`data-skeleton`) while the code loads, and
 * a "Loading…" status while its data does.
 */
function bodyLoaded(el: Element): boolean {
	const body = el.children[1];
	if (!body || body.childElementCount === 0) return false;
	if (body.querySelector("[data-skeleton]")) return false;
	return ![...body.querySelectorAll("[role=status]")].some((status) =>
		/^Loading…?$/.test((status.textContent ?? "").trim())
	);
}

/** Scrolls `container` (a widget frame or the preview) into view and waits for its body to load. */
async function expectBodyLoaded(container: Locator, what: string): Promise<void> {
	// The locator is resolved afresh on every poll: the preview remounts between Show as choices,
	// so an element found earlier can be gone (detached) by the time it's scrolled or read.
	await expect
		.poll(
			async () => {
				try {
					await container.scrollIntoViewIfNeeded({ timeout: 2_000 });
					return await container.evaluate(bodyLoaded, undefined, { timeout: 2_000 });
				} catch {
					// Detached, or not there yet: try again on the next poll.
					return false;
				}
			},
			{ message: `${what} loaded`, timeout: 20_000 }
		)
		.toBe(true);
}

/**
 * Brings every widget on the page into view in turn and waits for each one's code (each type's
 * lazy chunk: uPlot for a Chart, the calendar, MapLibre, `marked`) and data, so no lazy part is
 * skipped because it sat below the fold.
 */
async function expectWidgetsLoaded(page: Page): Promise<void> {
	const frames = page.getByRole("main").locator("[data-testid^=widget-]");
	await expect(frames.first()).toBeVisible();
	const count = await frames.count();
	for (let i = 0; i < count; i++)
		await expectBodyLoaded(frames.nth(i), `widget ${i + 1} of ${count}`);
}

/** The Data Portal's preview, once its widget has loaded. */
async function expectPreviewLoaded(page: Page): Promise<void> {
	await expectBodyLoaded(page.getByTestId("get-data-preview"), "the Data Portal preview");
}

/** Picks each Show as choice in turn, waiting for its preview, and ends on `last`. */
async function previewEachType(page: Page, last: string): Promise<void> {
	await expectPreviewLoaded(page);
	const choices = page.getByTestId("get-data-preview-column").getByRole("radio");
	const count = await choices.count();
	for (let i = 0; i < count; i++) {
		if (!(await choices.nth(i).isChecked())) await choices.nth(i).check();
		await expectPreviewLoaded(page);
	}
	const end = page.getByRole("radio", { name: last, exact: true });
	if (!(await end.isChecked())) await end.check();
	await expectPreviewLoaded(page);
}

/** The Map's feature list (its List button shows only while focused). */
async function openFeatureList(map: Locator): Promise<Locator> {
	const list = map.getByRole("listbox", { name: "Features on the map" });
	const button = map.getByRole("button", { name: "List of features on the map" });
	await button.focus();
	await button.press("Enter");
	await expect(list).toBeVisible();
	return list;
}

/** The dashboard's first calendar (a widget with a day grid): its frame and title. */
async function firstCalendar(page: Page): Promise<{ frame: Locator; title: string }> {
	const frame = page
		.getByRole("main")
		.locator("[data-testid^=widget-]")
		.filter({ has: page.getByRole("grid") })
		.first();
	await frame.scrollIntoViewIfNeeded();
	await expectBodyLoaded(frame, "the calendar");
	const title = (await frame.getByRole("heading", { level: 2 }).first().textContent())!.trim();
	return { frame, title };
}

/** The account menu's button (signed in: "{initials}, account menu for {name}"). */
function accountButton(page: Page): Locator {
	return page.getByRole("button", { name: /account menu/i });
}

/** Whether `url` is the documents sync API (the walk holds it back to leave a change unsynced). */
const isDocumentsApi = (url: URL) => url.pathname.includes("/api/2.0/documents/");

/** Whether `url` is the session account (the walk answers it signed out, on the fakes only). */
const isAccountApi = (url: URL) => url.pathname.endsWith("/api/2.0/account/");

export const WALK: readonly WalkStep[] = [
	{
		// The starter in a fresh context (no storage). The stack reaches it signed in, through
		// New from starter, since a signed-in `/` opens one of the account's dashboards.
		name: "starter-first-visit",
		on: ["fakes"],
		async run(page) {
			await page.goto("./");
			await expect(page.getByRole("main")).toBeVisible();
			const title = await readMapTitle(page);
			await expectMapDrawn(page, title);
			await expectNoteRendered(page);
		}
	},
	{
		name: "dashboard-list",
		async run(page) {
			await page.goto("./dashboards");
			await expect(
				page.getByRole("button", { name: "New from starter", exact: true })
			).toBeVisible();
		}
	},
	{
		name: "new-from-starter",
		async run(page, state) {
			await page.getByRole("button", { name: "New from starter", exact: true }).click();
			await expect(page).toHaveURL(DASHBOARD_URL);
			state.dashboardUrl = page.url();
			state.mapTitle = await readMapTitle(page);
			await expectMapDrawn(page, state.mapTitle);
			await expectNoteRendered(page);
			await expectWidgetsLoaded(page);
		}
	},
	{
		name: "fullscreen",
		async run(page, state) {
			const title = need(state.mapTitle, "Map title");
			await widgetMenuItem(page, title, "Fullscreen");
			const exit = page.getByRole("button", { name: "Exit fullscreen" });
			await expect(exit).toBeVisible();
			await expectMapDrawn(page, title);
			await page.keyboard.press("Escape");
			await expect(exit).toBeHidden();
		}
	},
	{
		// The Notes editor (Lexical), opened and closed without a change.
		name: "notes-editor",
		async run(page) {
			await widgetMenuItem(page, NOTE, "Edit note");
			const editor = page.getByRole("dialog", { name: "Edit note" });
			await expect(editor.getByRole("textbox", { name: "Note text" })).toBeVisible();
			await escapeDialogs(page);
		}
	},
	{
		// The dashboard menu's dialogs, each opened and closed (nothing confirmed); Export saves a
		// file. Sign-in links leave the app, so they aren't a step.
		name: "dashboard-dialogs",
		async run(page) {
			await dashboardMenuItem(page, "Rename dashboard…");
			await expect(page.getByRole("dialog", { name: "Rename dashboard" })).toBeVisible();
			await escapeDialogs(page);

			// The place picker (the starter's copy has one place, so no "which place" question).
			await dashboardMenuItem(page, "Duplicate for another place…");
			await expect(
				page.getByRole("dialog").getByRole("combobox", { name: "Search for a place" })
			).toBeVisible();
			await escapeDialogs(page);

			await dashboardMenuItem(page, "Share…");
			await expect(page.getByRole("dialog", { name: "Share dashboard" })).toBeVisible();
			await escapeDialogs(page);

			await dashboardMenuItem(page, "Notifications…");
			await expect(page.getByRole("dialog", { name: "Notifications" })).toBeVisible();
			await escapeDialogs(page);

			const download = page.waitForEvent("download");
			await dashboardMenuItem(page, "Export…");
			await (await download).cancel();
		}
	},
	{
		// Restore an earlier version (it only lists them), then Help's privacy page and Clear my
		// data from it: each opened and closed, nothing restored or cleared.
		name: "menu-dialogs",
		async run(page) {
			await dashboardMenuItem(page, "Restore an earlier version…");
			const restore = page.getByRole("dialog", { name: "Restore an earlier version" });
			await expect(restore).toBeVisible();
			await escapeDialogs(page);

			await page.getByRole("button", { name: "Help", exact: true }).click();
			await page.getByRole("menuitem", { name: "Your data and privacy", exact: true }).click();
			const privacy = page.getByRole("dialog", { name: "Your data and privacy" });
			await expect(privacy).toBeVisible();
			await privacy.getByRole("button", { name: "Clear my data…", exact: true }).click();
			const clear = page.getByRole("dialog", { name: "Clear my data?" });
			await expect(clear).toBeVisible();
			// Never "Clear everything".
			await clear.getByRole("button", { name: "Cancel", exact: true }).click();
			await expect(page.getByRole("dialog")).toHaveCount(0);
		}
	},
	{
		// A copy link and a live link (the dashboard is saved to the account first).
		name: "share-link",
		async run(page, state) {
			await expect(
				page.getByRole("navigation", { name: "Main" }).getByText("Saved to your account", {
					exact: true
				})
			).toBeVisible();
			await dashboardMenuItem(page, "Share…");
			const dialog = page.getByRole("dialog", { name: "Share dashboard" });
			const copy = dialog.getByRole("textbox", { name: "Link", exact: true });
			await expect(copy).toHaveValue(/\/workspace\/import#.+/);
			state.shareLink = await copy.inputValue();
			await dialog.getByRole("button", { name: "Create link" }).click();
			const live = dialog.getByRole("textbox", { name: "Live link" });
			await expect(live).toHaveValue(SHARED_URL);
			state.liveLink = await live.inputValue();
			await escapeDialogs(page);
		}
	},
	{
		// With no fragment the page goes home; a copy link imports a copy (a new one, since this
		// browser already has the dashboard).
		name: "import-page",
		async run(page, state) {
			await page.goto("./import");
			await expect(page).not.toHaveURL(/\/import$/);
			await expect(widgetTitles(page).first()).toBeVisible();

			await page.goto(need(state.shareLink, "share link"));
			const makeNew = page.getByRole("button", { name: "Make a new copy" });
			await expect(makeNew.or(widgetTitles(page).first())).toBeVisible();
			if (await makeNew.isVisible()) await makeNew.click();
			await expect(page).toHaveURL(DASHBOARD_URL);
			// The imported copy, not the dashboard it was shared from.
			expect(page.url()).not.toBe(need(state.dashboardUrl, "dashboard"));
			await expect(widgetTitles(page).first()).toBeVisible();
		}
	},
	{
		name: "shared-page",
		async run(page, state) {
			await page.goto(need(state.liveLink, "live link"));
			await expect(page).toHaveURL(SHARED_URL);
			await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
			const title = await readMapTitle(page);
			await expectMapDrawn(page, title);
			await expectWidgetsLoaded(page);
		}
	},
	{
		// Get data for a new widget: a Table, then a Chart, added to the dashboard.
		name: "data-portal-new",
		async run(page, state) {
			await backToDashboard(page, state);
			const before = await widgetTitles(page).count();
			await page.goto(`${need(state.dashboardUrl, "dashboard")}/widgets/new`);
			await expect(page).toHaveURL(NEW_WIDGET_URL);
			await expectDataPortal(page);
			// Every Show as choice's preview (a Table, a Chart, …), ending on the Chart.
			await previewEachType(page, "Chart");
			await page.getByRole("button", { name: /^Add to (?!another dashboard$)/ }).click();
			await expect(page).toHaveURL(need(state.dashboardUrl, "dashboard"));
			await expect(widgetTitles(page)).toHaveCount(before + 1);
			await expectWidgetsLoaded(page);
		}
	},
	{
		name: "data-portal-edit",
		async run(page, state) {
			await backToDashboard(page, state);
			await widgetMenuItem(page, need(state.mapTitle, "Map title"), "Open in Data Portal");
			await expect(page).toHaveURL(EDIT_URL);
			await expectDataPortal(page);
			await expectPreviewLoaded(page);
			await page.goBack();
			await backToDashboard(page, state);
		}
	},
	{
		// A calendar's Download data (CSV): the file is asked for, then thrown away.
		name: "csv-download",
		async run(page, state) {
			await backToDashboard(page, state);
			const { title } = await firstCalendar(page);
			const download = page.waitForEvent("download");
			await widgetMenuItem(page, title, "Download data (CSV)");
			await (await download).cancel();
		}
	},
	{
		// A day picked on a calendar, then "Open these days in a chart" (a new Chart).
		name: "open-in-chart",
		async run(page, state) {
			await backToDashboard(page, state);
			const { frame, title } = await firstCalendar(page);
			const day = frame.locator("[role=gridcell][data-date]").filter({ hasText: /\S/ }).first();
			await day.click();
			await expect(frame.locator("[role=gridcell][data-selected]").first()).toBeVisible();
			const before = await widgetTitles(page).count();
			await widgetMenuItem(page, title, "Open these days in a chart");
			await expect(widgetTitles(page)).toHaveCount(before + 1);
			await expectWidgetsLoaded(page);
		}
	},
	{
		name: "data-page",
		async run(page) {
			await page.goto("./data");
			await expectDataPortal(page);
			await expectPreviewLoaded(page);
		}
	},
	{
		// Marks a monitor the way a person does (Shift-click in the Map's feature list), then
		// Show in a chart and Show in a table. With no WebGL there's no map to mark on, so the
		// items never show: the step opens the Map's menu only (its log line says so).
		name: "show-in",
		async run(page, state) {
			await backToDashboard(page, state);
			const title = need(state.mapTitle, "Map title");
			if (!(await hasWebGL(page))) {
				console.log("show-in: no WebGL, so no marks and no Show in items; opened the menu only");
				await page.getByRole("button", { name: `Actions for ${title}`, exact: true }).click();
				await expect(page.getByRole("menu")).toBeVisible();
				await page.keyboard.press("Escape");
				await expect(page.getByRole("menu")).toBeHidden();
				return;
			}
			const map = mapOf(page, title);
			const list = await openFeatureList(map);
			// A monitor's row (selectable rows carry aria-selected).
			const row = list.locator("[role=option][aria-selected]").first();
			await expect(row).toBeVisible();
			if ((await row.getAttribute("aria-selected")) !== "true") {
				await row.click({ modifiers: ["Shift"] });
				await expect(row).toHaveAttribute("aria-selected", "true");
			}

			for (const item of ["Show in a chart", "Show in a table"]) {
				await widgetMenuItem(page, title, item);
				await expect(page).toHaveURL(NEW_WIDGET_URL);
				await expectDataPortal(page);
				await expectPreviewLoaded(page);
				await page.goBack();
				await backToDashboard(page, state);
			}
		}
	},
	{
		// Trimmed and unknown paths redirect: to the dashboard, or home.
		name: "trimmed-paths",
		async run(page, state) {
			const dashboard = need(state.dashboardUrl, "dashboard");
			await page.goto(`${dashboard}/widgets`);
			await expect(page).toHaveURL(dashboard);
			await expect(widgetTitles(page).first()).toBeVisible();
			for (const path of ["./shared", "./no-such-page"]) {
				await page.goto(path);
				await expect(page).not.toHaveURL(/\/(shared|no-such-page)$/);
				await expect(widgetTitles(page).first()).toBeVisible();
			}
		}
	},
	{
		// Sign out with a change not yet in the account asks first (closed with Cancel, never
		// signed out): the documents API is held back while the dashboard is renamed, so the
		// change stays in this browser, then let through again.
		name: "sign-out-dialog",
		async run(page, state) {
			await backToDashboard(page, state);
			await page.route(isDocumentsApi, (route) => route.abort("internetdisconnected"));
			try {
				await dashboardMenuItem(page, "Rename dashboard…");
				const rename = page.getByRole("dialog", { name: "Rename dashboard" });
				await rename.getByRole("textbox", { name: "Name" }).fill("CSP walk");
				await rename.getByRole("button", { name: "Save", exact: true }).click();
				const main = page.getByRole("navigation", { name: "Main" });
				// Not in the account: only then can Sign out ask instead of signing out.
				await expect(main.getByText("Saved in this browser", { exact: true })).toBeVisible();
				await accountButton(page).click();
				await page.getByRole("menuitem", { name: "Sign out", exact: true }).click();
				const asking = page.getByRole("dialog", {
					name: "Some changes aren't in your account yet"
				});
				await expect(asking).toBeVisible();
				await asking.getByRole("button", { name: "Cancel", exact: true }).click();
				await expect(asking).toBeHidden();
				await expect(accountButton(page)).toBeVisible();
			} finally {
				await page.unroute(isDocumentsApi);
			}
		}
	},
	{
		// The fakes only: the stack's session can't be signed out and back in without a logout and
		// a login, which the stack run doesn't do. Signed out (the account answers 401), a
		// dashboard made in this browser; signed in again, the app offers to move it into the
		// account ("Keep in this browser": nothing moved).
		name: "move-to-account",
		on: ["fakes"],
		async run(page) {
			await page.route(isAccountApi, (route) =>
				route.fulfill({
					status: 401,
					json: { detail: "Authentication credentials were not provided." }
				})
			);
			try {
				await page.goto("./dashboards");
				await expect(page.getByRole("link", { name: "Sign in" })).toBeVisible();
				await page.getByRole("button", { name: "New from starter", exact: true }).click();
				await expect(page).toHaveURL(DASHBOARD_URL);
				// Stored in this browser (the indicator says "Saved" signed out).
				await expect(page.getByRole("button", { name: /^Saved/ })).toBeVisible();
				// Nothing in flight when the page goes (a request cut off mid-answer fails the fakes).
				await page.waitForLoadState("networkidle");
			} finally {
				await page.unroute(isAccountApi);
			}
			await page.goto("./dashboards");
			const offer = page.getByRole("dialog", { name: "Dashboards in this browser" });
			await expect(offer).toBeVisible();
			await offer.getByRole("button", { name: "Keep in this browser", exact: true }).click();
			await expect(offer).toBeHidden();
		}
	}
];

/**
 * `text` with every query string and fragment removed (up to the next whitespace, quote or
 * bracket), so a recorded line never carries a key (MapTiler's `?key=…`) from a blocked URL.
 */
export function redactUrls(text: string): string {
	return text.replace(/[?#][^\s"'`)>\]]*/g, "");
}

/** A violation as a failure line: the step, the directive, what was blocked and where, redacted. */
export function violationLine(
	step: string,
	v: { directive: string; blockedURI: string; sourceFile: string }
): string {
	return redactUrls(`${step}: ${v.directive} ${v.blockedURI} (${v.sourceFile})`);
}

/** Chromium and WebKit say "Content Security Policy"; Firefox says "Content-Security-Policy". */
const CSP_TEXT = /Content[- ]Security[- ]Policy/i;

/**
 * Records console messages that mention the Content Security Policy, from `context`'s pages and
 * their workers (some engines report a blocked worker or font only there), each as
 * `{step}: {text} ({source})`, `step` read when the message comes.
 */
export function watchCspConsole(
	context: BrowserContext,
	into: string[],
	step: () => string = () => ""
): void {
	const record = (message: ConsoleMessage) => {
		const text = message.text();
		if (CSP_TEXT.test(text))
			into.push(redactUrls(`${step()}: ${text} (${message.location().url})`));
	};
	const watchPage = (page: Page) => {
		page.on("console", record);
		page.on("worker", (worker) => worker.on("console", record));
	};
	context.pages().forEach(watchPage);
	context.on("page", watchPage);
}

/** A message from a worker's CDP session (`Target.receivedMessageFromTarget`). */
type WorkerMessage = {
	method?: string;
	params?: {
		issue?: {
			code: string;
			details?: {
				contentSecurityPolicyIssueDetails?: {
					blockedURL?: string;
					violatedDirective: string;
					contentSecurityPolicyViolationType: string;
					sourceCodeLocation?: { url: string; lineNumber: number };
				};
			};
		};
		entry?: { text: string; url?: string };
	};
};

/**
 * Chromium only (elsewhere it does nothing): records the CSP violations of `page`'s workers. A
 * worker's `securitypolicyviolation` fires on the worker's own global, so the page's listener
 * never sees it, and Playwright drops a worker's log entries. So this attaches to each worker over
 * CDP (`Target.setAutoAttach`, holding it until it's watched), enables `Audits` and `Log` there,
 * and records each `ContentSecurityPolicyIssue` (the directive, the blocked URL, the source) and
 * each CSP log entry, as `{step}: …`. The policy itself is untouched.
 */
export async function watchWorkerCsp(
	context: BrowserContext,
	page: Page,
	into: string[],
	step: () => string = () => ""
): Promise<void> {
	if (context.browser()?.browserType().name() !== "chromium") return;
	const cdp = await context.newCDPSession(page);
	let id = 0;
	cdp.on("Target.attachedToTarget", ({ sessionId }) => {
		void (async () => {
			for (const method of ["Audits.enable", "Log.enable", "Runtime.runIfWaitingForDebugger"]) {
				const message = JSON.stringify({ id: ++id, method });
				await cdp.send("Target.sendMessageToTarget", { sessionId, message }).catch(() => {});
			}
		})();
	});
	cdp.on("Target.receivedMessageFromTarget", ({ message }) => {
		const { method, params } = JSON.parse(message) as WorkerMessage;
		const csp = params?.issue?.details?.contentSecurityPolicyIssueDetails;
		if (
			method === "Audits.issueAdded" &&
			params?.issue?.code === "ContentSecurityPolicyIssue" &&
			csp
		) {
			const blocked = csp.blockedURL ?? csp.contentSecurityPolicyViolationType;
			const source = csp.sourceCodeLocation
				? `${csp.sourceCodeLocation.url}:${csp.sourceCodeLocation.lineNumber + 1}`
				: "";
			into.push(redactUrls(`${step()}: worker ${csp.violatedDirective} ${blocked} (${source})`));
		} else if (method === "Log.entryAdded" && params?.entry && CSP_TEXT.test(params.entry.text)) {
			into.push(redactUrls(`${step()}: worker ${params.entry.text} (${params.entry.url ?? ""})`));
		}
	});
	await cdp.send("Target.setAutoAttach", {
		autoAttach: true,
		waitForDebuggerOnStart: true,
		flatten: false
	});
}

/**
 * Runs each step for `target` in order, calling `onStep` before it, and waits for the network to
 * go idle after it. Resolves what the steps found.
 */
export async function runWalk(
	page: Page,
	target: WalkTarget,
	onStep: (name: string) => void
): Promise<WalkState> {
	const state: WalkState = {};
	for (const step of WALK) {
		if (step.on && !step.on.includes(target)) continue;
		onStep(step.name);
		await step.run(page, state);
		await page.waitForLoadState("networkidle");
	}
	return state;
}
