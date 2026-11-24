/**
 * The CSP walk (`csp-walk.ts`) on the fakes, under the contract CSP the preview sends: every route
 * and lazy part, every directive. A violation the listener sees (`watchCsp`, which the fixture
 * adds to every context) fails the test with the step it happened in; a console message about
 * the policy (where Firefox reports a worker's) or a worker's violation (Chromium, over CDP) fails
 * it too. The walk's routes (the Map's monitors among them) are the fixture's defaults.
 */
import { expect, test } from "./fixtures";
import { maria } from "./helpers";
import {
	WALK,
	redactUrls,
	routePattern,
	runWalk,
	violationLine,
	watchCspConsole,
	watchWorkerCsp
} from "./csp-walk";
import { WALK_ROUTES } from "./csp-walk-routes";

// Live links need an account.
test.use({ account: maria, reducedMotion: "reduce" });

test("the walk raises no CSP violation", async ({ page, context, cspViolations }) => {
	test.setTimeout(240_000);
	let step = "";
	const messages: string[] = [];
	watchCspConsole(context, messages, () => step);
	await watchWorkerCsp(context, page, messages, () => step);
	let seen = 0;
	const flush = () => {
		// A violation is reported against the step it happened in (the one still current).
		const fresh = cspViolations.slice(seen);
		seen = cspViolations.length;
		expect(
			fresh.map((v) => violationLine(step, v)),
			"CSP violations"
		).toEqual([]);
	};
	await runWalk(page, "fakes", (name) => {
		flush();
		step = name;
	});
	flush();
	expect(messages, "CSP console and worker messages").toEqual([]);
});

test("a worker's violation is caught", async ({ page, context, cspViolations, browserName }) => {
	test.fixme(
		browserName === "webkit",
		"WebKit exposes no worker CSP event or console message to Playwright; workers are covered on Chromium (CDP) and Firefox (console)"
	);
	// A same-origin file (so `script-src 'self'` allows it) that starts a `blob:` worker (which
	// `worker-src` allows), whose eval the policy blocks. Firefox logs it to the console; Chromium
	// reports it only over CDP (`watchWorkerCsp`); WebKit shows it to neither (the fixme).
	await context.route("**/workspace/__csp-worker-probe.js", (route) =>
		route.fulfill({
			contentType: "text/javascript",
			body: `
				const source = 'try { eval("1"); } catch {}';
				const url = URL.createObjectURL(new Blob([source], { type: "text/javascript" }));
				window.__probeWorker = new Worker(url);
			`
		})
	);
	const messages: string[] = [];
	watchCspConsole(context, messages, () => "probe");
	await watchWorkerCsp(context, page, messages, () => "probe");
	await page.goto("./");
	await expect(page.getByRole("main")).toBeVisible();
	await page.addScriptTag({ url: "__csp-worker-probe.js" });
	await expect
		.poll(
			() =>
				messages.some((m) => /script-src/.test(m)) ||
				cspViolations.some((v) => /^script-src/.test(v.directive)),
			{ timeout: 5_000 }
		)
		.toBe(true);
	// Expected here; clear it so the fixture's own check passes.
	cspViolations.length = 0;
});

test("a recorded line never carries a URL's query", () => {
	const url = "https://api.maptiler.com/x?key=SECRET";
	const built = violationLine("step", {
		directive: "connect-src",
		blockedURI: url,
		sourceFile: `${url}#frag`
	});
	expect(built).not.toContain("SECRET");
	expect(built).toContain("https://api.maptiler.com/x");
	expect(redactUrls(`Refused to connect to '${url}' because it violates CSP`)).not.toContain(
		"SECRET"
	);
});

test("the steps' routes are exactly WALK_ROUTES, which the router's routes are checked against", () => {
	// `src/csp-walk-routes.browser.test.ts` checks WALK_ROUTES against the router; this ties it to
	// the steps, and the walk checks each step really goes where it says.
	const covered = new Set(WALK.flatMap((step) => step.routes));
	expect([...covered].sort()).toEqual([...WALK_ROUTES].sort());
});

test("a route key matches its own paths only", () => {
	expect(routePattern("/").test("/workspace/")).toBe(true);
	expect(routePattern("/").test("/workspace/data")).toBe(false);
	expect(routePattern("/dashboards/:id").test("/workspace/dashboards/abc")).toBe(true);
	expect(routePattern("/dashboards/:id").test("/workspace/dashboards/abc/widgets")).toBe(false);
	expect(routePattern("/shared").test("/workspace/shared/tok")).toBe(false);
	expect(
		routePattern("/dashboards/:id/widgets/:widgetId/edit").test(
			"/workspace/dashboards/a/widgets/new"
		)
	).toBe(false);
});
