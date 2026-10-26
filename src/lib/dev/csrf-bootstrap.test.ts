import { describe, expect, it, vi } from "vitest";
import { ensureDevCsrfCookie } from "./csrf-bootstrap";

describe("ensureDevCsrfCookie", () => {
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
		expect(fetchFn).toHaveBeenCalledWith("/account/login/", { credentials: "same-origin" });
	});

	it("never rejects", async () => {
		const fetchFn = vi.fn().mockRejectedValue(new Error("down"));
		await expect(ensureDevCsrfCookie({ dev: true, cookie: "", fetchFn })).resolves.toBeUndefined();
	});
});
