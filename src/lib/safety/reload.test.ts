import { afterEach, expect, test, vi } from "vitest";
import { refreshEntryFiles } from "./reload";

const base = new URL("https://s.example/static/workspace/");

afterEach(() => {
	vi.useRealTimers();
});

test("requests app.js and app.css past the HTTP cache, as the page does", async () => {
	const fetchFn = vi.fn(async () => new Response("ok"));
	await refreshEntryFiles(base, fetchFn as unknown as typeof fetch);
	const calls = fetchFn.mock.calls as unknown as [URL, RequestInit][];
	const byUrl = Object.fromEntries(calls.map(([url, init]) => [String(url), init]));
	expect(byUrl).toEqual({
		"https://s.example/static/workspace/app.js": { cache: "reload" },
		// Matches the stylesheet link's request, so it refreshes the same cache entry.
		"https://s.example/static/workspace/app.css": {
			cache: "reload",
			mode: "no-cors",
			credentials: "include"
		}
	});
});

test("resolves when fetch throws synchronously", async () => {
	const fetchFn = vi.fn(() => {
		throw new TypeError("bad request");
	});
	await expect(
		refreshEntryFiles(base, fetchFn as unknown as typeof fetch)
	).resolves.toBeUndefined();
});

test("resolves when fetch rejects", async () => {
	const fetchFn = vi.fn(async () => {
		throw new TypeError("offline");
	});
	await expect(
		refreshEntryFiles(base, fetchFn as unknown as typeof fetch)
	).resolves.toBeUndefined();
});

test("gives up after 5 seconds when fetch never settles", async () => {
	vi.useFakeTimers();
	const fetchFn = vi.fn(() => new Promise<Response>(() => {}));
	let done = false;
	const run = refreshEntryFiles(base, fetchFn as unknown as typeof fetch).then(() => {
		done = true;
	});
	await vi.advanceTimersByTimeAsync(4999);
	expect(done).toBe(false);
	await vi.advanceTimersByTimeAsync(1);
	await run;
	expect(done).toBe(true);
});
