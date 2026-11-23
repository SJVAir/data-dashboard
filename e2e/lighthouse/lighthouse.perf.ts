/**
 * The low-end device check (step 6 spec 1, decisions 15–19): Lighthouse's mobile preset (Moto G
 * Power viewport, 4× CPU slowdown, slow 4G) on the production build, three runs per case, medians
 * reported. `npm run build && npm run perf:lighthouse`.
 *
 * The fakes (default): the build and the E2E fakes from a real HTTP server (`fake-server.ts`), in
 * four cases: a first visit (a fresh profile: the starter with its Map) and a saved dashboard (a
 * profile where the starter's first edit made a copy), each with the files gzipped and not.
 *
 * Another origin (the local stack): `LIGHTHOUSE_ORIGIN=http://localhost:8000`, signed in with
 * `WORKSPACE_E2E_IDENTIFIER` and `WORKSPACE_E2E_PASSWORD` (the way `npm run test:embedding` signs
 * in) when both are set. Page loads only: the sign-in, then the first-visit case on whatever the
 * account opens to, as the server serves the files. Nothing is written.
 *
 * Throttling is DevTools throttling by default: the browser really runs at a quarter speed on slow
 * 4G (Lighthouse's own values for it), so the three runs agree and each request's real throttled
 * timing shows where the time goes. Lighthouse's default, simulated throttling ("lantern"),
 * estimates the timings from an unthrottled load; on this app its LCP estimate jumped between
 * runs (5 s or 7.8 s, 9.5 s or 18 s) with how the fast load happened to order its requests. See
 * `docs/reference/lighthouse-2026-11-23.md`.
 *
 * Options (environment): `LIGHTHOUSE_RUNS` (default 3), `LIGHTHOUSE_THROTTLING` (`devtools`, the
 * default, or `simulate`), `LIGHTHOUSE_CASES` (comma-separated case names, to run fewer),
 * `LIGHTHOUSE_CHROME_FLAGS` (extra Chromium switches, space-separated). Raw reports and the
 * summary go to `lighthouse-results/` (git-ignored).
 */
import { spawn, type ChildProcess } from "node:child_process";
import {
	cpSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync
} from "node:fs";
import { cpus, totalmem, tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { chromium, expect, test, type Page } from "@playwright/test";
import lighthouse from "lighthouse";
import { DASHBOARD_URL, expectSaved } from "../helpers";
import { startFakeServer, type FakeServer } from "./fake-server";

type Lhr =
	Awaited<ReturnType<typeof lighthouse>> extends infer R
		? R extends { lhr: infer L }
			? L
			: never
		: never;

const ROOT = resolve(import.meta.dirname, "../..");
const RUNS = Number(process.env.LIGHTHOUSE_RUNS ?? 3);
const THROTTLING = process.env.LIGHTHOUSE_THROTTLING === "simulate" ? "simulate" : "devtools";
const EXTRA_FLAGS = process.env.LIGHTHOUSE_CHROME_FLAGS?.split(" ").filter(Boolean) ?? [];
const ORIGIN = process.env.LIGHTHOUSE_ORIGIN;
const ONLY = process.env.LIGHTHOUSE_CASES?.split(",").map((s) => s.trim());

/** The switches Playwright and chrome-launcher start Chromium with, for a quiet browser. */
const QUIET_CHROME = [
	"--headless=new",
	"--no-first-run",
	"--no-default-browser-check",
	"--disable-background-networking",
	"--disable-background-timer-throttling",
	"--disable-backgrounding-occluded-windows",
	"--disable-renderer-backgrounding",
	"--disable-component-update",
	"--disable-component-extensions-with-background-pages",
	"--disable-default-apps",
	"--disable-extensions",
	"--disable-sync",
	"--disable-field-trial-config",
	"--disable-hang-monitor",
	"--disable-client-side-phishing-detection",
	"--metrics-recording-only",
	"--password-store=basic",
	"--use-mock-keychain",
	"--mute-audio",
	// Headless Chromium draws WebGL (the Map) in software.
	"--enable-unsafe-swiftshader"
];

/** The Map widget's lazy chunk, from the build manifest (its file name changes with its hash). */
function mapChunkName(): string | null {
	const file = join(ROOT, "dist/.vite/manifest.json");
	if (!existsSync(file)) return null;
	const manifest: Record<string, { file: string }> = JSON.parse(readFileSync(file, "utf8"));
	const entry = manifest["src/lib/widgets/map/module.ts"];
	return entry ? basename(entry.file) : null;
}

/** A URL's file name, without its query (a MapTiler URL's query carries the key). */
function fileOf(url: string): string {
	try {
		const u = new URL(url);
		return `${u.host}${u.pathname.length > 1 ? "…/" + basename(u.pathname) : "/"}`;
	} catch {
		return "(unparsed)";
	}
}

/** Copies a profile for one run, without its HTTP and code caches (every run starts cold). */
function profileFor(template: string | null): string {
	const dir = mkdtempSync(join(tmpdir(), "lighthouse-profile-"));
	if (template) {
		cpSync(template, dir, { recursive: true });
		for (const cache of [
			"Cache",
			"Code Cache",
			"GPUCache",
			"DawnGraphiteCache",
			"DawnWebGPUCache"
		]) {
			rmSync(join(dir, "Default", cache), { recursive: true, force: true });
		}
		rmSync(join(dir, "DevToolsActivePort"), { force: true });
		for (const lock of ["SingletonLock", "SingletonSocket", "SingletonCookie"]) {
			rmSync(join(dir, lock), { force: true });
		}
	}
	return dir;
}

/** Starts Playwright's Chromium on `profile` with a DevTools port for Lighthouse. */
async function launchChrome(
	profile: string,
	flags: string[]
): Promise<{ port: number; process: ChildProcess }> {
	const child = spawn(
		chromium.executablePath(),
		[
			...QUIET_CHROME,
			...flags,
			`--user-data-dir=${profile}`,
			"--remote-debugging-port=0",
			"about:blank"
		],
		{ stdio: "ignore" }
	);
	const portFile = join(profile, "DevToolsActivePort");
	for (let i = 0; i < 200; i++) {
		if (existsSync(portFile)) {
			const port = Number(readFileSync(portFile, "utf8").split("\n")[0]);
			if (port > 0) return { port, process: child };
		}
		await sleep(50);
	}
	child.kill("SIGKILL");
	throw new Error("Chromium didn't open its DevTools port");
}

async function stopChrome(child: ChildProcess): Promise<void> {
	if (child.exitCode !== null) return;
	const exited = new Promise((done) => child.once("exit", done));
	child.kill("SIGTERM");
	await Promise.race([exited, sleep(5000)]);
	if (child.exitCode === null) child.kill("SIGKILL");
}

/** A persistent Playwright context on `profile`, with the same browser the runs use. */
async function withProfile(
	profile: string,
	flags: string[],
	work: (page: Page) => Promise<void>
): Promise<void> {
	const context = await chromium.launchPersistentContext(profile, {
		channel: "chromium",
		args: flags,
		ignoreHTTPSErrors: true,
		reducedMotion: "reduce"
	});
	try {
		await work(context.pages()[0] ?? (await context.newPage()));
	} finally {
		await context.close();
	}
}

/** A profile where the starter's first edit (a calendar day) made the person's own copy. */
async function savedDashboardProfile(server: FakeServer): Promise<string> {
	const profile = mkdtempSync(join(tmpdir(), "lighthouse-saved-"));
	await withProfile(profile, server.chromeFlags, async (page) => {
		await page.goto(server.url);
		const cells = page.getByRole("grid").first().locator("[role=gridcell][data-date]");
		await expect(cells.first()).toBeAttached();
		await cells.filter({ hasText: /\S/ }).first().click();
		await expect(page).toHaveURL(DASHBOARD_URL);
		await expectSaved(page);
		// The next visit to the home opens the copy.
		await page.goto(server.url);
		await expect(page).toHaveURL(DASHBOARD_URL);
	});
	return profile;
}

/** A profile signed in on `origin` as the E2E test user (page loads and the sign-in only). */
async function signedInProfile(origin: string): Promise<string> {
	const profile = mkdtempSync(join(tmpdir(), "lighthouse-stack-"));
	const identifier = process.env.WORKSPACE_E2E_IDENTIFIER!;
	const password = process.env.WORKSPACE_E2E_PASSWORD!;
	await withProfile(profile, EXTRA_FLAGS, async (page) => {
		await page.goto(`${origin}/account/login/`);
		await page.locator("[name=identifier]").fill(identifier);
		await page.locator("[name=password]").fill(password);
		await page
			.locator("form", { has: page.locator("[name=identifier]") })
			.locator("[type=submit]")
			.first()
			.click();
		await page.waitForURL((url) => !url.pathname.startsWith("/account/login"));
	});
	return profile;
}

type Metrics = {
	score: number;
	fcp: number;
	lcp: number;
	tbt: number;
	cls: number;
	si: number;
	totalBytes: number;
	scriptBytes: number;
	mapChunkBytes: number | null;
	mapChunkResourceBytes: number | null;
	/** The API's responses (on the fakes: the E2E fixtures, never compressed). */
	apiBytes: number;
};

type NetworkItem = {
	url: string;
	transferSize?: number;
	resourceSize?: number;
	resourceType?: string;
	networkRequestTime?: number;
	networkEndTime?: number;
};

function audit(lhr: Lhr, id: string) {
	return lhr.audits[id];
}

function networkItems(lhr: Lhr): NetworkItem[] {
	const details = audit(lhr, "network-requests")?.details as { items?: NetworkItem[] } | undefined;
	return details?.items ?? [];
}

/** The Map chunk's request: by name from the manifest, else (another origin's build) the largest script. */
function mapChunkRequest(lhr: Lhr, name: string | null): { item: NetworkItem; by: string } | null {
	const items = networkItems(lhr);
	const named = name ? items.find((i) => i.url.split("?")[0].endsWith(`/${name}`)) : undefined;
	if (named) return { item: named, by: "manifest" };
	if (ORIGIN) {
		const scripts = items.filter((i) => i.resourceType === "Script");
		scripts.sort((a, b) => (b.resourceSize ?? 0) - (a.resourceSize ?? 0));
		if (scripts[0]) return { item: scripts[0], by: "largest script" };
	}
	return null;
}

function metricsOf(lhr: Lhr, mapChunk: string | null): Metrics {
	const n = (id: string) => audit(lhr, id)?.numericValue ?? NaN;
	const items = networkItems(lhr);
	const map = mapChunkRequest(lhr, mapChunk);
	return {
		score: Math.round((lhr.categories.performance?.score ?? NaN) * 100),
		fcp: n("first-contentful-paint"),
		lcp: n("largest-contentful-paint"),
		tbt: n("total-blocking-time"),
		cls: n("cumulative-layout-shift"),
		si: n("speed-index"),
		totalBytes: n("total-byte-weight"),
		scriptBytes: items
			.filter((i) => i.resourceType === "Script")
			.reduce((sum, i) => sum + (i.transferSize ?? 0), 0),
		mapChunkBytes: map?.item.transferSize ?? null,
		mapChunkResourceBytes: map?.item.resourceSize ?? null,
		apiBytes: items
			.filter((i) => new URL(i.url).pathname.includes("/api/"))
			.reduce((sum, i) => sum + (i.transferSize ?? 0), 0)
	};
}

function median(values: number[]): number {
	const sorted = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
	if (!sorted.length) return NaN;
	const mid = Math.floor(sorted.length / 2);
	return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Where the time went in one run: the main thread, the scripts' CPU time, the Map chunk's load. */
function whereTimeGoes(lhr: Lhr, mapChunk: string | null) {
	type Item = Record<string, unknown>;
	const items = (id: string): Item[] =>
		((audit(lhr, id)?.details as { items?: Item[] } | undefined)?.items ?? []) as Item[];
	const map = mapChunkRequest(lhr, mapChunk);
	return {
		finalPath: new URL(lhr.finalDisplayedUrl).pathname.replace(/[0-9a-f-]{36}$/, "<id>"),
		mainThread: items("mainthread-work-breakdown").map((i) => ({
			group: i.groupLabel ?? i.group,
			ms: Math.round(Number(i.duration))
		})),
		bootup: items("bootup-time")
			.slice(0, 8)
			.map((i) => ({
				file: fileOf(String(i.url)),
				totalMs: Math.round(Number(i.total)),
				scriptingMs: Math.round(Number(i.scripting)),
				parseCompileMs: Math.round(Number(i.scriptParseCompile))
			})),
		// The LCP element and its subparts, and the layout shifts' culprits (selectors only on
		// another origin, where a label could hold the account's name).
		lcp: items("lcp-breakdown-insight").map((i) => {
			if (i.type === "node") {
				return { selector: i.selector, label: ORIGIN ? undefined : i.nodeLabel };
			}
			return ((i.items as Item[] | undefined) ?? []).map((p) => ({
				subpart: p.label,
				ms: Math.round(Number(p.duration))
			}));
		}),
		layoutShifts: items("layout-shifts").map((i) => {
			const node = i.node as { selector?: string; nodeLabel?: string } | undefined;
			return {
				selector: node?.selector,
				label: ORIGIN ? undefined : node?.nodeLabel?.split("\n")[0],
				score: Number(Number(i.score).toFixed(4))
			};
		}),
		mapChunk: map
			? {
					found: map.by,
					file: fileOf(map.item.url),
					transferSize: map.item.transferSize,
					resourceSize: map.item.resourceSize,
					// Observed times (simulated runs: unthrottled; DevTools runs: throttled).
					requestMs: Math.round(map.item.networkRequestTime ?? NaN),
					endMs: Math.round(map.item.networkEndTime ?? NaN)
				}
			: null
	};
}

/** Audits below 0.9 (excluding the metrics themselves), for sorting into findings and setup-only. */
function lowAudits(lhr: Lhr) {
	const metrics = new Set([
		"first-contentful-paint",
		"largest-contentful-paint",
		"total-blocking-time",
		"cumulative-layout-shift",
		"speed-index",
		"interactive",
		"max-potential-fid"
	]);
	return Object.values(lhr.audits)
		.filter(
			(a) =>
				!metrics.has(a.id) &&
				a.score !== null &&
				a.score < 0.9 &&
				(a.scoreDisplayMode === "binary" ||
					a.scoreDisplayMode === "numeric" ||
					a.scoreDisplayMode === "metricSavings")
		)
		.map((a) => ({ id: a.id, title: a.title, displayValue: a.displayValue ?? "" }));
}

/** The served build's `version.json`, next to its `app.js` (a read-only GET). */
async function buildVersion(lhr: Lhr): Promise<unknown> {
	const entry = networkItems(lhr).find((i) => i.url.split("?")[0].endsWith("/app.js"));
	if (!entry) return "app.js not seen";
	try {
		const response = await fetch(new URL("version.json", entry.url));
		return response.ok ? await response.json() : `version.json: HTTP ${response.status}`;
	} catch (error) {
		return `version.json: ${(error as Error).message}`;
	}
}

type Case = {
	name: string;
	gzip: boolean | null;
	profile: () => Promise<string | null>;
};

const kb = (bytes: number | null) =>
	bytes === null || !Number.isFinite(bytes) ? "–" : `${(bytes / 1024).toFixed(1)} KB`;
const s = (ms: number) => `${(ms / 1000).toFixed(2)} s`;

test("Lighthouse: the starter on a low-end phone", async () => {
	test.setTimeout(0);
	const stamp = new Date().toISOString().replace(/[:.]/g, "-");
	const out = join(
		ROOT,
		"lighthouse-results",
		`${stamp}-${ORIGIN ? "origin" : "fakes"}-${THROTTLING}`
	);
	mkdirSync(out, { recursive: true });
	const mapChunk = ORIGIN ? null : mapChunkName();
	if (!ORIGIN && !mapChunk) throw new Error("No build: run `npm run build` first");

	let server: FakeServer | null = null;
	let url: string;
	let flags: string[] = [...EXTRA_FLAGS];
	let cases: Case[];
	const templates: string[] = [];
	if (ORIGIN) {
		url = new URL("/workspace/", ORIGIN).href;
		const signIn = !!process.env.WORKSPACE_E2E_IDENTIFIER && !!process.env.WORKSPACE_E2E_PASSWORD;
		let profile: string | null = null;
		cases = [
			{
				name: "origin-first-visit",
				gzip: null,
				profile: async () => {
					if (signIn && !profile) {
						profile = await signedInProfile(new URL(ORIGIN).origin);
						templates.push(profile);
					}
					return profile;
				}
			}
		];
	} else {
		server = await startFakeServer();
		url = server.url;
		flags = [...server.chromeFlags, ...EXTRA_FLAGS];
		let saved: string | null = null;
		const savedProfile = async () => {
			if (!saved) {
				server!.gzip = true;
				saved = await savedDashboardProfile(server!);
				templates.push(saved);
			}
			return saved;
		};
		cases = [
			{ name: "first-visit-gzip", gzip: true, profile: async () => null },
			{ name: "first-visit-uncompressed", gzip: false, profile: async () => null },
			{ name: "saved-dashboard-gzip", gzip: true, profile: savedProfile },
			{ name: "saved-dashboard-uncompressed", gzip: false, profile: savedProfile }
		];
	}
	if (ONLY) cases = cases.filter((c) => ONLY.includes(c.name));

	const summary: Record<string, unknown> = {
		date: new Date().toISOString(),
		lighthouse: JSON.parse(readFileSync(join(ROOT, "node_modules/lighthouse/package.json"), "utf8"))
			.version,
		chromium: chromium
			.executablePath()
			.split("/")
			.find((p) => p.startsWith("chromium")),
		throttling: THROTTLING,
		target: ORIGIN ? "origin" : "fakes",
		runs: RUNS,
		machine: {
			cpu: cpus()[0]?.model,
			cores: cpus().length,
			memoryGB: Math.round(totalmem() / 2 ** 30)
		},
		mapChunk,
		cases: {} as Record<string, unknown>
	};
	const rows: string[] = [];
	try {
		for (const c of cases) {
			if (server && c.gzip !== null) server.gzip = c.gzip;
			const template = await c.profile();
			const runs: Metrics[] = [];
			const details: unknown[] = [];
			for (let run = 1; run <= RUNS; run++) {
				const profile = profileFor(template);
				const chrome = await launchChrome(profile, flags);
				try {
					const result = await lighthouse(url, {
						port: chrome.port,
						output: "json",
						logLevel: "error",
						onlyCategories: ["performance"],
						// Each run has its own profile copy: a fresh one (first visit) or the saved
						// dashboard's, whose storage Lighthouse would otherwise clear.
						disableStorageReset: true,
						throttlingMethod: THROTTLING
					});
					if (!result) throw new Error("Lighthouse returned no result");
					writeFileSync(join(out, `${c.name}-run${run}.json`), result.report as string);
					const lhr = result.lhr;
					if (lhr.runtimeError) throw new Error(`Lighthouse: ${lhr.runtimeError.message}`);
					const m = metricsOf(lhr, mapChunk);
					if (ORIGIN && !summary.version) summary.version = await buildVersion(lhr);
					runs.push(m);
					details.push({
						run,
						benchmarkIndex: lhr.environment.benchmarkIndex,
						metrics: m,
						whereTimeGoes: whereTimeGoes(lhr, mapChunk),
						lowAudits: lowAudits(lhr),
						warnings: lhr.runWarnings
					});
					console.log(
						`${c.name} run ${run}: score ${m.score}, LCP ${s(m.lcp)}, TBT ${Math.round(m.tbt)} ms, CLS ${m.cls.toFixed(3)}`
					);
				} finally {
					await stopChrome(chrome.process);
					rmSync(profile, { recursive: true, force: true });
				}
			}
			const med = (k: keyof Metrics) => median(runs.map((r) => r[k] ?? NaN));
			const medians = Object.fromEntries(
				(Object.keys(runs[0]) as (keyof Metrics)[]).map((k) => [k, med(k)])
			);
			(summary.cases as Record<string, unknown>)[c.name] = { medians, runs: details };
			rows.push(
				`| ${c.name} | ${med("score")} | ${s(med("fcp"))} | ${s(med("lcp"))} | ${Math.round(med("tbt"))} ms | ${med("cls").toFixed(3)} | ${s(med("si"))} | ${kb(med("totalBytes"))} | ${kb(med("scriptBytes"))} | ${kb(med("mapChunkBytes"))} |`
			);
		}
	} finally {
		if (server) {
			summary.unmatchedApiRequests = server.unmatched;
			summary.mapTilerNotFound = [...new Set(server.mapTiler.notFound)];
			await server.close();
		}
		for (const t of templates) rmSync(t, { recursive: true, force: true });
	}
	const table = [
		`Lighthouse ${summary.lighthouse}, ${THROTTLING} throttling, mobile preset, median of ${RUNS}`,
		"",
		"| Case | Score | FCP | LCP | TBT | CLS | Speed Index | Total bytes | Script bytes | Map chunk |",
		"| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
		...rows
	].join("\n");
	writeFileSync(join(out, "summary.json"), JSON.stringify(summary, null, "\t"));
	writeFileSync(join(out, "summary.md"), table + "\n");
	console.log(`\n${table}\n\nResults: ${out}`);
	if (server) expect(summary.unmatchedApiRequests, "API requests with no fake").toEqual([]);
});
