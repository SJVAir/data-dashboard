import { describe, expect, it, vi } from "vitest";
import type { ErrorReporter, ReportContext } from "../types";
import { createWebErrors, listenForCspViolations, type SentryLike } from "./errors";

type Options = Parameters<SentryLike["init"]>[0];
type SentEvent = Record<string, unknown>;

const PAGE_URL =
	"https://www.sjvair.com/workspace/dashboards/3f2a9c1e-1234-4abc-8def-123456789012?q=1#f";

/** Stands in for `@sentry/browser`: builds a raw event like the SDK would and runs `beforeSend`. */
function fakeSentry() {
	let options: Options | undefined;
	const inits: Options[] = [];
	const sent: SentEvent[] = [];
	const sentry: SentryLike = {
		init(o) {
			options = o;
			inits.push(o);
		},
		captureException(error, hint) {
			const err = error instanceof Error ? error : new Error(String(error));
			const event = {
				event_id: "e1",
				level: "error",
				message: err.message,
				exception: {
					values: [
						{
							type: err.name,
							value: err.message,
							stacktrace: {
								frames: [
									{
										filename: PAGE_URL,
										function: "onclick",
										lineno: 1,
										colno: 1
									},
									{
										filename: "https://sjvair.com/workspace/assets/app-abc.js?doc=ana",
										abs_path: "https://sjvair.com/workspace/assets/app-abc.js?doc=ana",
										function: "save",
										lineno: 1,
										colno: 2,
										context_line: "ana@example.org"
									}
								]
							}
						}
					]
				},
				request: {
					url: "https://sjvair.com/workspace/dashboards/3f2a9c1e-1234-4abc-8def-123456789012?q=1#f",
					headers: { Referer: "https://sjvair.com/workspace/dashboards/x", "User-Agent": "UA/1" }
				},
				extra: hint?.extra,
				user: { ip_address: "203.0.113.9", email: "ana@example.org" },
				tags: { place: "Fresno" },
				breadcrumbs: [{ message: "typed ana@example.org" }]
			};
			const out = options!.beforeSend!(event as never, {});
			if (out) sent.push(out as unknown as SentEvent);
		}
	};
	return { sentry, inits, sent };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

function deferred<T>() {
	let resolve!: (v: T) => void;
	let reject!: (e: unknown) => void;
	const promise = new Promise<T>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
}

describe("createWebErrors", () => {
	it("does nothing without a DSN", () => {
		const loadSentry = vi.fn();
		const errors = createWebErrors({ dsn: undefined, release: "r1", dev: false, loadSentry });
		expect(() => errors.report(new Error("x"), { operation: "save" })).not.toThrow();
		expect(loadSentry).not.toHaveBeenCalled();
	});

	it("logs to the console in dev without a DSN", () => {
		const spy = vi.spyOn(console, "error").mockImplementation(() => {});
		const loadSentry = vi.fn();
		createWebErrors({ dsn: undefined, release: "r1", dev: true, loadSentry }).report(
			new Error("x")
		);
		expect(spy).toHaveBeenCalled();
		expect(loadSentry).not.toHaveBeenCalled();
		spy.mockRestore();
	});

	it("buffers reports until Sentry loads, then initializes once and sends them", async () => {
		const fake = fakeSentry();
		const load = deferred<SentryLike>();
		const loadSentry = vi.fn(() => load.promise);
		const errors = createWebErrors({
			dsn: "https://k@o.ingest/1",
			release: "r1",
			dev: false,
			loadSentry
		});
		errors.report(new Error("first"));
		errors.report(new Error("second"));
		expect(loadSentry).toHaveBeenCalledTimes(1);
		load.resolve(fake.sentry);
		await tick();
		errors.report(new Error("third"));
		expect(fake.inits).toHaveLength(1);
		expect(fake.sent.map((e) => e.message)).toEqual(["first", "second", "third"]);

		const init = fake.inits[0];
		expect(init.dsn).toBe("https://k@o.ingest/1");
		expect(init.release).toBe("r1");
		expect(init.dataCollection).toEqual({
			userInfo: false,
			cookies: false,
			httpHeaders: false,
			httpBodies: [],
			urlQueryParams: false,
			stackFrameVariables: false,
			frameContextLines: 0
		});
		expect(init.defaultIntegrations).toBe(false);
		expect(init.integrations).toBeUndefined();
		expect(init.tracesSampleRate).toBeUndefined();
		expect(init.beforeBreadcrumb!({ message: "x" })).toBeNull();
	});

	it("drops reports and stops after a failed import", async () => {
		const loadSentry = vi.fn(() => Promise.reject(new Error("offline")));
		const errors = createWebErrors({
			dsn: "https://k@o.ingest/1",
			release: "r1",
			dev: false,
			loadSentry
		});
		errors.report(new Error("first"));
		await tick();
		expect(() => errors.report(new Error("later"))).not.toThrow();
		await tick();
		expect(loadSentry).toHaveBeenCalledTimes(1);
	});

	it("sends at most 20 reports per page load", async () => {
		const fake = fakeSentry();
		const errors = createWebErrors({
			dsn: "https://k@o.ingest/1",
			release: "r1",
			dev: false,
			loadSentry: async () => fake.sentry
		});
		errors.report(new Error("0"));
		await tick();
		for (let i = 1; i < 21; i++) errors.report(new Error(String(i)));
		expect(fake.sent).toHaveLength(20);
		expect(fake.sent.at(-1)!.message).toBe("19");
	});

	it("keeps at most 10 reports while Sentry loads", async () => {
		const fake = fakeSentry();
		const load = deferred<SentryLike>();
		const errors = createWebErrors({
			dsn: "https://k@o.ingest/1",
			release: "r1",
			dev: false,
			loadSentry: () => load.promise
		});
		for (let i = 0; i < 12; i++) errors.report(new Error(String(i)));
		load.resolve(fake.sentry);
		await tick();
		expect(fake.sent).toHaveLength(10);
	});

	it("never sends personal data", async () => {
		const fake = fakeSentry();
		const errors = createWebErrors({
			dsn: "https://k@o.ingest/1",
			release: "r1",
			dev: false,
			loadSentry: async () => fake.sentry
		});
		const doc = { title: "Ana's class", widgets: [{ note: "Meet at Roosevelt High" }] };
		errors.report(new Error("Failed for ana@example.org at 36.7378, -119.7871"), {
			operation: "save",
			docId: "3f2a9c1e-1234-4abc-8def-123456789012",
			document: JSON.stringify(doc),
			note: "Meet at Roosevelt High"
		} as ReportContext);
		await tick();

		expect(fake.sent).toHaveLength(1);
		const event = fake.sent[0];
		const json = JSON.stringify(event);
		for (const secret of [
			"ana@example.org",
			"36.7378",
			"-119.7871",
			"3f2a9c1e",
			"Ana's class",
			"Roosevelt",
			"203.0.113.9",
			"Fresno",
			"?q=1",
			"#f",
			"?doc=",
			"sjvair.com/workspace/assets"
		]) {
			expect(json).not.toContain(secret);
		}
		expect(event.extra).toEqual({ operation: "save" });
		expect(event.request).toEqual({ url: "/dashboards/:id" });
		expect(event.breadcrumbs).toBeUndefined();
		expect(event.user).toBeUndefined();
		const frames = (event.exception as { values: { stacktrace: { frames: unknown[] } }[] })
			.values[0].stacktrace.frames;
		expect(frames).toEqual([
			{ filename: "/dashboards/:id", function: "onclick", lineno: 1, colno: 1 },
			{ filename: "app-abc.js", function: "save", lineno: 1, colno: 2 }
		]);
	});

	it("strips personal data in beforeSend itself", async () => {
		const fake = fakeSentry();
		const errors = createWebErrors({
			dsn: "https://k@o.ingest/1",
			release: "r1",
			dev: false,
			loadSentry: async () => fake.sentry
		});
		errors.report(new Error("x"));
		await tick();
		const beforeSend = fake.inits[0].beforeSend!;
		const raw = {
			message: "Failed for ana@example.org",
			request: { url: PAGE_URL },
			extra: { docId: "3f2a9c1e-1234-4abc-8def-123456789012" },
			contexts: { place: { name: "Fresno" }, browser: { name: "Chrome" } },
			exception: {
				values: [
					{
						type: "Error",
						value: "boom",
						stacktrace: { frames: [{ filename: PAGE_URL, lineno: 3 }] }
					},
					{
						type: "Error",
						value: "elsewhere",
						stacktrace: { frames: [{ filename: "https://other.example/x/ana" }] }
					}
				]
			}
		};
		const out = beforeSend(raw as never, {}) as unknown as SentEvent;
		const json = JSON.stringify(out);
		for (const secret of ["ana@example.org", "3f2a9c1e", "docId", "Fresno", "?q=1", "#f", "ana"]) {
			expect(json).not.toContain(secret);
		}
		expect(out.extra).toEqual({});
		expect(out.contexts).toEqual({});
		expect(out.request).toEqual({ url: "/dashboards/:id" });
		const values = (out.exception as { values: { stacktrace: { frames: unknown[] } }[] }).values;
		expect(values[0].stacktrace.frames).toEqual([{ filename: "/dashboards/:id", lineno: 3 }]);
		expect(values[1].stacktrace.frames).toEqual([{ filename: "[page]" }]);
	});

	it("reports uncaught errors and rejections before any report, loading Sentry then", async () => {
		const fake = fakeSentry();
		const loadSentry = vi.fn(async () => fake.sentry);
		const target = new EventTarget();
		createWebErrors({ dsn: "https://k@o.ingest/1", release: "r1", dev: false, loadSentry, target });
		expect(loadSentry).not.toHaveBeenCalled();

		target.dispatchEvent(Object.assign(new Event("error"), { error: new Error("uncaught") }));
		target.dispatchEvent(
			Object.assign(new Event("unhandledrejection"), { reason: { title: "Ana's class" } })
		);
		await tick();
		expect(loadSentry).toHaveBeenCalledTimes(1);
		expect(fake.sent.map((e) => [e.message, e.extra])).toEqual([
			["uncaught", { kind: "uncaught" }],
			["Unhandled rejection", { kind: "unhandledrejection" }]
		]);
	});

	it("counts uncaught errors toward the 20-per-load cap", async () => {
		const fake = fakeSentry();
		const target = new EventTarget();
		createWebErrors({
			dsn: "https://k@o.ingest/1",
			release: "r1",
			dev: false,
			loadSentry: async () => fake.sentry,
			target
		});
		target.dispatchEvent(Object.assign(new Event("error"), { error: new Error("0") }));
		await tick();
		for (let i = 1; i < 25; i++) {
			target.dispatchEvent(Object.assign(new Event("error"), { error: new Error(String(i)) }));
		}
		expect(fake.sent).toHaveLength(20);
	});

	it("installs no listeners without a DSN", () => {
		const target = new EventTarget();
		const add = vi.spyOn(target, "addEventListener");
		createWebErrors({ dsn: undefined, release: "r1", dev: false, loadSentry: vi.fn(), target });
		expect(add).not.toHaveBeenCalled();
	});
});

describe("listenForCspViolations", () => {
	function recorder() {
		const reports: Array<{ error: unknown; context?: ReportContext }> = [];
		const reporter: ErrorReporter = {
			report: (error, context) => void reports.push({ error, context })
		};
		return { reporter, reports };
	}

	const violation = (directive: string, blockedURI: string) =>
		Object.assign(new Event("securitypolicyviolation"), {
			effectiveDirective: directive,
			blockedURI
		});

	it("reports only the directive and the blocked host", () => {
		const { reporter, reports } = recorder();
		const target = new EventTarget();
		listenForCspViolations(reporter, target);
		target.dispatchEvent(violation("script-src-elem", "https://evil.example.com/x.js?doc=ana"));
		target.dispatchEvent(violation("script-src-elem", "inline"));
		target.dispatchEvent(violation("script-src-elem", "data:text/javascript,alert(1)"));
		expect(reports.map((r) => r.context)).toEqual([
			{ directive: "script-src-elem", blockedHost: "evil.example.com" },
			{ directive: "script-src-elem", blockedHost: "inline" },
			{ directive: "script-src-elem", blockedHost: "data" }
		]);
		expect((reports[0].error as Error).message).toBe("CSP violation");
	});

	it("reports at most 5 violations and stops when asked", () => {
		const { reporter, reports } = recorder();
		const target = new EventTarget();
		const stop = listenForCspViolations(reporter, target);
		for (let i = 0; i < 7; i++) target.dispatchEvent(violation("img-src", "https://a.example/"));
		expect(reports).toHaveLength(5);

		const second = recorder();
		const stopSecond = listenForCspViolations(second.reporter, target);
		stopSecond();
		stop();
		target.dispatchEvent(violation("img-src", "https://a.example/"));
		expect(second.reports).toHaveLength(0);
	});
});
