/**
 * The CSP walk (`csp-walk.ts`) on the fakes, under the contract CSP the preview sends: every route
 * and lazy part, every directive. A violation the listener sees (`watchCsp`, which the fixture
 * adds to every context) fails the test with the step it happened in; a console message about
 * the policy (where some engines report a worker's or a font's) fails it too. The walk's routes
 * (the Map's monitors among them) are the fixture's defaults.
 */
import { expect, test } from "./fixtures";
import { maria } from "./helpers";
import { runWalk, watchCspConsole } from "./csp-walk";

// Live links need an account.
test.use({ account: maria, reducedMotion: "reduce" });

test("the walk raises no CSP violation", async ({ page, context, cspViolations }) => {
	test.setTimeout(180_000);
	const messages: string[] = [];
	watchCspConsole(context, messages);
	let step = "";
	let seen = 0;
	await runWalk(page, "fakes", (name) => {
		// A violation is reported against the step it happened in (the one before this).
		const fresh = cspViolations.slice(seen);
		seen = cspViolations.length;
		expect(
			fresh.map((v) => `${step}: ${v.directive} ${v.blockedURI}`),
			"CSP violations"
		).toEqual([]);
		step = name;
	});
	expect(
		cspViolations.slice(seen).map((v) => `${step}: ${v.directive} ${v.blockedURI}`),
		"CSP violations"
	).toEqual([]);
	expect(messages, "CSP console messages").toEqual([]);
});

test("a worker's violation is caught", async ({ page, context, cspViolations, browserName }) => {
	// Chromium fires a worker's `securitypolicyviolation` on the worker's own global (the page's
	// listener never sees it) and logs nothing to the console, so neither check can see it there.
	// Firefox logs it ("Content-Security-Policy: …"); WebKit is checked in CI.
	test.fixme(
		browserName === "chromium",
		"Chromium surfaces a worker's CSP violation neither to the page's listener nor the console"
	);
	// A same-origin file (so `script-src 'self'` allows it) that starts a `blob:` worker (which
	// `worker-src` allows), whose eval the policy blocks.
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
	watchCspConsole(context, messages);
	await page.goto("./");
	await expect(page.getByRole("main")).toBeVisible();
	await page.addScriptTag({ url: "__csp-worker-probe.js" });
	await expect
		.poll(() => cspViolations.length + messages.length, { timeout: 5_000 })
		.toBeGreaterThan(0);
	// Expected here; clear it so the fixture's own check passes.
	cspViolations.length = 0;
});
