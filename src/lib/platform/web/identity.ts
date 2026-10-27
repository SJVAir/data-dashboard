import {
	accountUserSchema,
	parseIdentityBlock,
	sameIdentity,
	type Identity
} from "$lib/account/identity";
import type {
	ActivitySource,
	ErrorReporter,
	IdentityCause,
	IdentitySource,
	OnlineSource
} from "../types";

/** The shortest gap between re-checks when the app comes back into view. */
const RECHECK_THROTTLE_MS = 30_000;
/** How long a re-check waits for the server before giving up. */
const RECHECK_TIMEOUT_MS = 10_000;

export type WebIdentityDeps = {
	/** The page's `sjvair-identity` block, or null when there is none. */
	blockText(): string | null;
	cookie(): string;
	/**
	 * The session account response. Rejects on a non-2xx with the status at `cause.result.status`
	 * (the SDK's JSON error) or `cause.status` (a non-JSON response).
	 */
	fetchUser(signal: AbortSignal): Promise<unknown>;
	postLogout(csrfToken: string): Promise<Response>;
	activity: ActivitySource;
	online: OnlineSource;
	errors: ErrorReporter;
	now(): number;
};

function readCookie(cookies: string, name: string): string {
	for (const part of cookies.split(";")) {
		const [key, ...rest] = part.trim().split("=");
		if (key === name) {
			try {
				return decodeURIComponent(rest.join("="));
			} catch {
				return rest.join("=");
			}
		}
	}
	return "";
}

function statusOf(error: unknown): unknown {
	const cause = (error as { cause?: { status?: unknown; result?: { status?: unknown } } } | null)
		?.cause;
	return cause?.result?.status ?? cause?.status;
}

/** Rejects once `signal` aborts, so a request that ignores its signal can't hang a re-check. */
function whenAborted(signal: AbortSignal): Promise<never> {
	return new Promise((_, reject) => {
		signal.addEventListener("abort", () => reject(signal.reason), { once: true });
	});
}

/**
 * Who is signed in on the web: the page's identity block on load (or one request when there is
 * none), then session-cookie re-checks when the app comes back into view or online.
 */
export function createWebIdentity(deps: WebIdentityDeps): IdentitySource {
	let identity: Identity = { state: "unknown" };
	const listeners = new Set<(identity: Identity, cause: IdentityCause) => void>();
	let started = false;
	let lastCheck: number | undefined;
	let inFlight: Promise<void> | undefined;
	/** Bumped by anything newer than a request in flight, whose answer is then dropped. */
	let generation = 0;

	function set(next: Identity, cause: IdentityCause) {
		if (sameIdentity(identity, next)) return;
		identity = next;
		for (const cb of [...listeners]) cb(identity, cause);
	}

	async function ask(): Promise<void> {
		const asked = generation;
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), RECHECK_TIMEOUT_MS);
		let next: Identity | undefined;
		try {
			const body = await Promise.race([
				deps.fetchUser(controller.signal),
				whenAborted(controller.signal)
			]);
			const parsed = accountUserSchema.safeParse(body);
			if (parsed.success) {
				next = { state: "signed-in", user: parsed.data };
			} else {
				// The issues can echo field values, so only the fact is reported.
				deps.errors.report(new Error("The account response failed validation"), {
					operation: "identity"
				});
			}
		} catch (error) {
			const status = statusOf(error);
			if (status === 401 || status === 403) next = { state: "signed-out" };
			// Anything else (offline, timeout, 5xx) says nothing about who is signed in.
		} finally {
			clearTimeout(timer);
		}
		if (next && asked === generation) {
			set(next, identity.state === "unknown" ? "load" : "recheck");
		}
	}

	function recheck(opts: { force?: boolean } = {}): Promise<void> {
		if (inFlight) return inFlight;
		const now = deps.now();
		if (!opts.force && lastCheck !== undefined && now - lastCheck < RECHECK_THROTTLE_MS) {
			return Promise.resolve();
		}
		lastCheck = now;
		inFlight = ask().finally(() => {
			inFlight = undefined;
		});
		return inFlight;
	}

	return {
		currentSpace: async () => "anonymous",
		authMode: "cookie",
		current: () => identity,
		onChange(cb) {
			listeners.add(cb);
			return () => listeners.delete(cb);
		},
		start() {
			if (started) return;
			started = true;
			const text = deps.blockText();
			if (text === null) {
				void recheck({ force: true });
			} else {
				// The block is the server's answer as of this page load.
				lastCheck = deps.now();
				const { identity: read, unreadable } = parseIdentityBlock(text);
				if (unreadable) {
					deps.errors.report(new Error("The identity block is unreadable"), {
						operation: "identity"
					});
				}
				set(read, "load");
			}
			deps.activity.onChange((visible) => {
				if (visible) void recheck();
			});
			deps.online.onChange((online) => {
				if (online) void recheck({ force: true });
			});
		},
		recheck,
		accept(next) {
			if (next.state === "unknown") return;
			generation++;
			set(next, "tab");
		},
		async signOut() {
			let ok: boolean;
			try {
				const response = await deps.postLogout(readCookie(deps.cookie(), "csrftoken"));
				// The logout redirects; in dev its target isn't served, so the redirect is enough.
				ok = response.type === "opaqueredirect" || response.ok;
			} catch {
				ok = false;
			}
			if (ok) {
				generation++;
				set({ state: "signed-out" }, "sign-out");
			} else {
				// It may have gone through anyway.
				void recheck({ force: true });
			}
			return ok;
		},
		signInUrl: (returnPath) => `/account/login/?next=${encodeURIComponent(returnPath)}`,
		accountUrl: () => "/account/"
	};
}
