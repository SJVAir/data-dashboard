import { afterEach, describe, expect, it, vi } from "vitest";
import { ensureDevCsrfCookie } from "./csrf-bootstrap";

describe("ensureDevCsrfCookie", () => {
	afterEach(() => {
		vi.useRealTimers();
	});

	it("does nothing outside dev", async () => {
		const fetchFn = vi.fn();
		await ensureDevCsrfCookie({ dev: false, cookie: "", fetchFn });
		expect(fetchFn).not.toHaveBeenCalled();
	});

	it("does nothing when the csrftoken cookie exists", async () => {
		const fetchFn = vi.fn();
		await ensureDevCsrfCookie({ dev: true, cookie: "a=b; csrftoken=abc", fetchFn });
		expect(fetchFn).not.toHaveBeenCalled();
	});

	it("requests the login page once in dev without the cookie", async () => {
		const fetchFn = vi.fn().mockResolvedValue(new Response(""));
		await ensureDevCsrfCookie({ dev: true, cookie: "a=b", fetchFn });
		expect(fetchFn).toHaveBeenCalledTimes(1);
		expect(fetchFn).toHaveBeenCalledWith("/account/login/", {
			credentials: "same-origin",
			signal: expect.any(AbortSignal)
		});
	});

	it("never rejects", async () => {
		const fetchFn = vi.fn().mockRejectedValue(new Error("down"));
		await expect(ensureDevCsrfCookie({ dev: true, cookie: "", fetchFn })).resolves.toBeUndefined();
	});

	it("gives up after 3 seconds when the request never settles, and aborts it", async () => {
		vi.useFakeTimers();
		let signal: AbortSignal | undefined;
		const fetchFn = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
			signal = init?.signal ?? undefined;
			return new Promise<Response>(() => {});
		});
		let done = false;
		const run = ensureDevCsrfCookie({ dev: true, cookie: "", fetchFn }).then(() => {
			done = true;
		});
		await vi.advanceTimersByTimeAsync(2999);
		expect(done).toBe(false);
		await vi.advanceTimersByTimeAsync(1);
		await run;
		expect(done).toBe(true);
		expect(signal?.aborted).toBe(true);
	});
});
