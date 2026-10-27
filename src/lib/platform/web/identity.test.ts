import { afterEach, describe, expect, it, vi } from "vitest";
import type { AccountUser, Identity } from "$lib/account/identity";
import { createMemoryActivity, createMemoryOnline, type MemoryErrors } from "../memory";
import type { IdentityCause } from "../types";
import { createWebIdentity } from "./identity";

const maria: AccountUser = {
	id: "u1",
	full_name: "Maria Lopez",
	email: "maria@example.com",
	phone: "+15595550100",
	phone_verified: true,
	language: "en"
};
const signedIn = (user: AccountUser = maria): Identity => ({ state: "signed-in", user });
const block = (user: AccountUser | null) => JSON.stringify({ v: 1, user });
const httpError = (status: number) => new Error(`HTTP ${status}`, { cause: { status } });

type Options = {
	blockText?: string | null;
	fetchUser?: (signal: AbortSignal) => Promise<unknown>;
	postLogout?: (csrfToken: string) => Promise<Response>;
	cookie?: string;
};

function setup(options: Options = {}) {
	let time = 0;
	const errors: MemoryErrors = {
		reports: [],
		report(error, context) {
			errors.reports.push({ error, context });
		}
	};
	const fetchUser = vi.fn(options.fetchUser ?? (async () => maria));
	const postLogout = vi.fn(options.postLogout ?? (async () => new Response(null, { status: 200 })));
	const activity = createMemoryActivity();
	const online = createMemoryOnline();
	const source = createWebIdentity({
		blockText: () => (options.blockText === undefined ? block(maria) : options.blockText),
		cookie: () => options.cookie ?? "other=1; csrftoken=tok%3D123; last=2",
		fetchUser,
		postLogout,
		activity,
		online,
		errors,
		now: () => time
	});
	const heard: Array<[Identity, IdentityCause]> = [];
	source.onChange((identity, cause) => heard.push([identity, cause]));
	return {
		source,
		fetchUser,
		postLogout,
		activity,
		online,
		errors,
		heard,
		setNow: (t: number) => (time = t)
	};
}

/** Lets pending promise callbacks run. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

function cycle(activity: ReturnType<typeof createMemoryActivity>) {
	activity.setVisible(false);
	activity.setVisible(true);
}

afterEach(() => {
	vi.useRealTimers();
});

describe("createWebIdentity", () => {
	it("starts unknown, with fixed auth mode and space", async () => {
		const { source } = setup();
		expect(source.current()).toEqual({ state: "unknown" });
		expect(source.authMode).toBe("cookie");
		expect(await source.currentSpace()).toBe("anonymous");
	});

	it("a valid block signs in on load without asking the server", () => {
		const { source, fetchUser, heard, errors } = setup();
		source.start();
		expect(source.current()).toEqual(signedIn());
		expect(heard).toEqual([[signedIn(), "load"]]);
		expect(fetchUser).not.toHaveBeenCalled();
		expect(errors.reports).toEqual([]);
	});

	it("a signed-out block signs out on load", () => {
		const { source, heard } = setup({ blockText: block(null) });
		source.start();
		expect(heard).toEqual([[{ state: "signed-out" }, "load"]]);
	});

	it("start is idempotent", () => {
		const { source, heard, activity, fetchUser, setNow } = setup();
		source.start();
		source.start();
		setNow(60_000);
		cycle(activity);
		expect(heard).toHaveLength(1);
		expect(fetchUser).toHaveBeenCalledTimes(1);
	});

	it("an unreadable block signs out and reports without user data", () => {
		const text = JSON.stringify({ v: 2, user: maria });
		const { source, heard, errors, fetchUser } = setup({ blockText: text });
		source.start();
		expect(heard).toEqual([[{ state: "signed-out" }, "load"]]);
		expect(fetchUser).not.toHaveBeenCalled();
		expect(errors.reports).toHaveLength(1);
		const [{ error, context }] = errors.reports;
		expect(context).toEqual({ operation: "identity" });
		const message = (error as Error).message;
		for (const value of ["u1", "Maria", "maria@example.com", "5595550100"]) {
			expect(message).not.toContain(value);
		}
	});

	it("no block stays unknown, then the server's answer applies as the load", async () => {
		let answer!: (value: unknown) => void;
		const { source, heard, fetchUser } = setup({
			blockText: null,
			fetchUser: () => new Promise((resolve) => (answer = resolve))
		});
		source.start();
		expect(fetchUser).toHaveBeenCalledTimes(1);
		expect(source.current()).toEqual({ state: "unknown" });
		answer(maria);
		await settle();
		expect(source.current()).toEqual(signedIn());
		expect(heard).toEqual([[signedIn(), "load"]]);
	});

	it("drops fields the schema doesn't know", async () => {
		const { source } = setup({ blockText: null, fetchUser: async () => ({ ...maria, x: 1 }) });
		source.start();
		await settle();
		expect(source.current()).toEqual(signedIn());
	});

	it("401 and 403 sign out", async () => {
		for (const status of [401, 403]) {
			const { source, heard, errors } = setup({
				fetchUser: async () => {
					throw httpError(status);
				}
			});
			source.start();
			await source.recheck({ force: true });
			expect(source.current()).toEqual({ state: "signed-out" });
			expect(heard.at(-1)).toEqual([{ state: "signed-out" }, "recheck"]);
			expect(errors.reports).toEqual([]);
		}
	});

	it("5xx and network errors change nothing", async () => {
		for (const failure of [httpError(500), new TypeError("Failed to fetch")]) {
			const { source, heard, errors } = setup({
				fetchUser: async () => {
					throw failure;
				}
			});
			source.start();
			await source.recheck({ force: true });
			expect(source.current()).toEqual(signedIn());
			expect(heard).toHaveLength(1);
			expect(errors.reports).toEqual([]);
		}
	});

	it("a 200 that fails validation changes nothing", async () => {
		const { source, heard, errors } = setup({ fetchUser: async () => "<html>" });
		source.start();
		await source.recheck({ force: true });
		expect(source.current()).toEqual(signedIn());
		expect(heard).toHaveLength(1);
		expect(errors.reports).toHaveLength(1);
		expect(errors.reports[0].context).toEqual({ operation: "identity" });
	});

	it("a re-check that finds someone else fires a change; the same answer fires nothing", async () => {
		const ana = { ...maria, id: "u2", full_name: "Ana" };
		let answer: AccountUser = maria;
		const { source, heard } = setup({ fetchUser: async () => answer });
		source.start();
		await source.recheck({ force: true });
		expect(heard).toHaveLength(1);
		answer = ana;
		await source.recheck({ force: true });
		expect(heard.at(-1)).toEqual([signedIn(ana), "recheck"]);
	});

	it("becoming visible re-checks at most once per 30 seconds; force ignores that", async () => {
		const { source, activity, fetchUser, setNow } = setup();
		source.start();
		setNow(1_000);
		cycle(activity);
		expect(fetchUser).toHaveBeenCalledTimes(0);
		setNow(30_000);
		cycle(activity);
		await settle();
		expect(fetchUser).toHaveBeenCalledTimes(1);
		setNow(59_999);
		cycle(activity);
		await settle();
		expect(fetchUser).toHaveBeenCalledTimes(1);
		await source.recheck({ force: true });
		expect(fetchUser).toHaveBeenCalledTimes(2);
		setNow(89_999);
		cycle(activity);
		await settle();
		expect(fetchUser).toHaveBeenCalledTimes(3);
	});

	it("coming back online re-checks, ignoring the throttle", async () => {
		const { source, online, fetchUser } = setup();
		source.start();
		online.setOnline(false);
		expect(fetchUser).toHaveBeenCalledTimes(0);
		online.setOnline(true);
		await settle();
		expect(fetchUser).toHaveBeenCalledTimes(1);
	});

	it("two overlapping re-checks make one request", async () => {
		let answer!: (value: unknown) => void;
		const { source, fetchUser } = setup({
			fetchUser: () => new Promise((resolve) => (answer = resolve))
		});
		source.start();
		const first = source.recheck({ force: true });
		const second = source.recheck({ force: true });
		answer(maria);
		await Promise.all([first, second]);
		expect(fetchUser).toHaveBeenCalledTimes(1);
	});

	it("accept applies another tab's identity without a request", () => {
		const { source, heard, fetchUser } = setup();
		source.start();
		source.accept(signedIn({ ...maria }));
		expect(heard).toHaveLength(1);
		source.accept({ state: "signed-out" });
		expect(heard.at(-1)).toEqual([{ state: "signed-out" }, "tab"]);
		expect(fetchUser).not.toHaveBeenCalled();
	});

	it("onChange returns a function that stops listening", () => {
		const { source } = setup();
		const heard: Identity[] = [];
		const stop = source.onChange((identity) => heard.push(identity));
		stop();
		source.start();
		expect(heard).toEqual([]);
	});

	it("signOut posts with the csrftoken cookie and signs out on success", async () => {
		const responses = [
			{ type: "opaqueredirect", ok: false, status: 0 } as Response,
			new Response(null, { status: 204 })
		];
		for (const response of responses) {
			const { source, postLogout, heard } = setup({ postLogout: async () => response });
			source.start();
			expect(await source.signOut()).toBe(true);
			expect(postLogout).toHaveBeenCalledWith("tok=123");
			expect(source.current()).toEqual({ state: "signed-out" });
			expect(heard.at(-1)).toEqual([{ state: "signed-out" }, "sign-out"]);
		}
	});

	it("signOut failure keeps signed in and re-checks", async () => {
		const failures = [
			async () => new Response(null, { status: 403 }),
			async () => {
				throw new TypeError("Failed to fetch");
			}
		];
		for (const postLogout of failures) {
			const { source, fetchUser, setNow, heard } = setup({ postLogout });
			source.start();
			setNow(1_000);
			expect(await source.signOut()).toBe(false);
			await settle();
			expect(source.current()).toEqual(signedIn());
			expect(heard).toHaveLength(1);
			expect(fetchUser).toHaveBeenCalledTimes(1);
		}
	});

	it("a re-check that was in flight during a sign-out doesn't undo it", async () => {
		let answer!: (value: unknown) => void;
		const { source } = setup({ fetchUser: () => new Promise((resolve) => (answer = resolve)) });
		source.start();
		const pending = source.recheck({ force: true });
		await source.signOut();
		answer(maria);
		await pending;
		expect(source.current()).toEqual({ state: "signed-out" });
	});

	it("builds the sign-in and account URLs", () => {
		const { source } = setup();
		expect(source.signInUrl("/workspace/dashboards/a b?x=1")).toBe(
			"/account/login/?next=%2Fworkspace%2Fdashboards%2Fa%20b%3Fx%3D1"
		);
		expect(source.accountUrl()).toBe("/account/");
	});

	it("a re-check gives up after 10 seconds and changes nothing", async () => {
		vi.useFakeTimers();
		let seen: AbortSignal | undefined;
		const { source, heard, errors } = setup({
			fetchUser: (signal) => {
				seen = signal;
				return new Promise(() => {});
			}
		});
		source.start();
		const pending = source.recheck({ force: true });
		await vi.advanceTimersByTimeAsync(9_999);
		expect(seen?.aborted).toBe(false);
		await vi.advanceTimersByTimeAsync(1);
		await pending;
		expect(seen?.aborted).toBe(true);
		expect(source.current()).toEqual(signedIn());
		expect(heard).toHaveLength(1);
		expect(errors.reports).toEqual([]);
	});
});
