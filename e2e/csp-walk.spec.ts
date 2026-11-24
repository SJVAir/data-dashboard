/**
 * The CSP walk (`csp-walk.ts`) on the fakes, under the contract CSP the preview sends: every route
 * and lazy part, every directive. A violation the listener sees (`watchCsp`, which the fixture
 * adds to every context) fails the test with the step it happened in; a console message about
 * the policy (where Firefox reports a worker's) or a worker's violation (Chromium, over CDP) fails
 * it too. The walk's routes (the Map's monitors among them) are the fixture's defaults.
 */
import type { CspViolation } from "./fixtures";
import { expect, test } from "./fixtures";
import { maria } from "./helpers";
import { runWalk, watchCspConsole, watchWorkerCsp } from "./csp-walk";

// Live links need an account.
test.use({ account: maria, reducedMotion: "reduce" });

/** A violation as a failure line: the step it happened in, the directive, what, and where. */
function line(step: string, v: CspViolation): string {
	return `${step}: ${v.directive} ${v.blockedURI} (${v.sourceFile})`;
}

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
			fresh.map((v) => line(step, v)),
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

test("a worker's violation is caught", async ({ page, context, cspViolations }) => {
	// A same-origin file (so `script-src 'self'` allows it) that starts a `blob:` worker (which
	// `worker-src` allows), whose eval the policy blocks. Firefox logs it to the console; Chromium
	// reports it only over CDP (`watchWorkerCsp`); WebKit is checked in CI.
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
