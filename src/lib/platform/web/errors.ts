import type { BrowserOptions, ErrorEvent, Event, StackFrame } from "@sentry/browser";
import { routePattern, scrubContext, scrubText } from "$lib/errors/scrub";
import type { ErrorReporter, ReportContext } from "../types";

/** The parts of `@sentry/browser` the reporter uses, so tests can stand in for it. */
export type SentryLike = {
	init(options: BrowserOptions): unknown;
	captureException(error: unknown, hint?: { extra?: ReportContext }): unknown;
	globalHandlersIntegration(options: { onerror: boolean; onunhandledrejection: boolean }): unknown;
};

const BUFFER_LIMIT = 10;
const SEND_LIMIT = 20;
const CSP_LIMIT = 5;

const NO_PERSONAL_DATA: BrowserOptions["dataCollection"] = {
	userInfo: false,
	cookies: false,
	httpHeaders: false,
	httpBodies: [],
	urlQueryParams: false,
	stackFrameVariables: false,
	frameContextLines: 0
};

const baseName = (file: string) => file.split(/[?#]/)[0].split("/").pop() ?? "";

function pathOf(url: string | undefined): string {
	if (url === undefined) return "";
	try {
		return new URL(url, "http://x").pathname;
	} catch {
		return "";
	}
}

function scrubFrame(frame: StackFrame): StackFrame {
	const { filename, function: fn, lineno, colno, in_app } = frame;
	const out: StackFrame = {};
	if (filename !== undefined) out.filename = baseName(filename);
	if (fn !== undefined) out.function = fn;
	if (lineno !== undefined) out.lineno = lineno;
	if (colno !== undefined) out.colno = colno;
	if (in_app !== undefined) out.in_app = in_app;
	return out;
}

/**
 * Rebuilds an event from an allowlist of fields: scrubbed messages and exception values, stack
 * frames with base file names only, the route pattern instead of the URL, the user agent (for the
 * browser and OS family), and allowed context keys. Everything else (user, tags, breadcrumbs,
 * request headers, source lines) is left behind.
 */
function scrubEvent(event: Event): Event {
	const out: Event = {
		event_id: event.event_id,
		timestamp: event.timestamp,
		platform: event.platform,
		level: event.level,
		release: event.release,
		environment: event.environment,
		sdk: event.sdk
	};
	if (event.message !== undefined) out.message = scrubText(event.message);
	if (event.exception?.values) {
		out.exception = {
			values: event.exception.values.map((value) => ({
				type: value.type,
				value: value.value === undefined ? undefined : scrubText(value.value),
				mechanism: value.mechanism && {
					type: value.mechanism.type,
					handled: value.mechanism.handled
				},
				stacktrace: value.stacktrace && {
					frames: value.stacktrace.frames?.map(scrubFrame)
				}
			}))
		};
	}
	const agent = event.request?.headers?.["User-Agent"];
	out.request = {
		url: routePattern(pathOf(event.request?.url ?? globalThis.location?.href)),
		...(agent === undefined ? {} : { headers: { "User-Agent": agent } })
	};
	if (event.contexts)
		out.contexts = scrubContext(event.contexts as ReportContext) as Event["contexts"];
	if (event.extra) out.extra = scrubContext(event.extra as ReportContext);
	return out;
}

/**
 * Error reports to Sentry, loaded on the first report so the SDK stays out of the initial bundle.
 * Without a DSN nothing is sent (development logs to the console instead).
 */
export function createWebErrors(opts: {
	dsn: string | undefined;
	release: string;
	dev: boolean;
	loadSentry?: () => Promise<SentryLike>;
}): ErrorReporter {
	const { dsn, release, dev, loadSentry = () => import("./sentry") } = opts;
	const log = (error: unknown, context?: ReportContext) => {
		if (dev) console.error(error, context);
	};
	if (!dsn) return { report: (error, context) => log(error, context) };

	let state: "idle" | "loading" | "ready" | "off" = "idle";
	let sentry: SentryLike | undefined;
	let sent = 0;
	const buffer: Array<{ error: unknown; context?: ReportContext }> = [];

	const capture = (error: unknown, context?: ReportContext) => {
		try {
			sentry!.captureException(error, { extra: scrubContext(context) });
		} catch {
			// Reporting must never break the app.
		}
	};

	const start = () => {
		state = "loading";
		// The executor runs now, and a synchronous throw becomes a rejection.
		new Promise<SentryLike>((resolve) => resolve(loadSentry()))
			.then((loaded) => {
				loaded.init({
					dsn,
					release,
					// Sentry 11's replacement for `sendDefaultPii: false`: no user fields (so no IP
					// inference), cookies, headers, bodies, query strings, local variables, or source lines.
					dataCollection: NO_PERSONAL_DATA,
					defaultIntegrations: false,
					integrations: [
						loaded.globalHandlersIntegration({ onerror: true, onunhandledrejection: true })
					] as BrowserOptions["integrations"],
					beforeBreadcrumb: () => null,
					beforeSend(event: ErrorEvent) {
						if (sent >= SEND_LIMIT) return null;
						sent++;
						return scrubEvent(event) as ErrorEvent;
					}
				});
				sentry = loaded;
				state = "ready";
				for (const { error, context } of buffer.splice(0)) capture(error, context);
			})
			.catch(() => {
				state = "off";
				buffer.length = 0;
			});
	};

	return {
		report(error, context) {
			try {
				log(error, context);
				if (state === "ready") return capture(error, context);
				if (state === "off") return;
				if (buffer.length < BUFFER_LIMIT) buffer.push({ error, context });
				if (state === "idle") start();
			} catch {
				// Reporting must never break the app.
			}
		}
	};
}

/** The host of a blocked URL, or the keyword the browser gave (`inline`, `eval`, `data`). */
function blockedHost(blockedURI: string): string {
	try {
		const url = new URL(blockedURI);
		return url.host || url.protocol.replace(/:$/, "");
	} catch {
		return /^[a-z-]+$/.test(blockedURI) ? blockedURI : "unknown";
	}
}

/**
 * Reports Content-Security-Policy violations (the directive and blocked host only), at most a few
 * per page load. Returns a function that stops listening.
 */
export function listenForCspViolations(reporter: ErrorReporter, target: EventTarget): () => void {
	let count = 0;
	const listener = (e: globalThis.Event) => {
		if (count >= CSP_LIMIT) return;
		count++;
		const { effectiveDirective, blockedURI } = e as SecurityPolicyViolationEvent;
		reporter.report(new Error("CSP violation"), {
			directive: effectiveDirective,
			blockedHost: blockedHost(blockedURI)
		});
	};
	target.addEventListener("securitypolicyviolation", listener);
	return () => target.removeEventListener("securitypolicyviolation", listener);
}
