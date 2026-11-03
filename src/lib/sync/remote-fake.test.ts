import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { setOrigin } from "@sjvair/sdk/http";
import { setPlatform } from "$lib/platform";
import { createMemoryPlatform, type MemoryPlatform } from "$lib/platform/memory";
import { RemoteRefusal, RemoteUnavailable, type RemoteDocuments, type SaveInput } from "./remote";
import { runRemoteContract } from "./remote-contract";
import { createFakeRemote, type FakeRemote } from "./remote-fake";
import { createSdkRemote } from "./remote-sdk";

/** A clock that moves a minute every time it is read, so cursors separate saves. */
function steppingClock(): () => Date {
	let at = Date.parse("2026-11-02T18:00:00.000Z");
	return () => new Date((at += 60_000));
}

/**
 * Another caller on `fake`'s server with no session. The fake reads `signedInAs` as each call
 * starts (before its first await), so each call runs signed out and the session comes back.
 */
function signedOutOf(fake: FakeRemote): RemoteDocuments {
	return new Proxy(fake, {
		get(target, key) {
			const value: unknown = Reflect.get(target, key);
			if (typeof value !== "function") return value;
			return (...args: unknown[]) => {
				const was = target.signedInAs;
				target.signedInAs = null;
				try {
					return value.apply(target, args);
				} finally {
					target.signedInAs = was;
				}
			};
		}
	});
}

let current: FakeRemote;
runRemoteContract(
	"fake",
	async () => {
		current = createFakeRemote({ accountId: "account-1", now: steppingClock() });
		return { remote: current, accountId: "account-1" };
	},
	async () => signedOutOf(current),
	{ fakeOnly: true }
);

describe("createFakeRemote", () => {
	test("counts one request per call", async () => {
		const fake = createFakeRemote({ accountId: "a" });
		await fake.save("d", saveInput("a"));
		await fake.list();
		await fake.list("2026-11-02T00:00:00.000Z");
		await fake.get("d");
		await fake.changes("d", 0);
		expect(fake.requests).toEqual([
			"save d",
			"list",
			"list 2026-11-02T00:00:00.000Z",
			"get d",
			"changes d 0"
		]);
	});

	test("signed out is unauthorized", async () => {
		const fake = createFakeRemote({ accountId: "a" });
		fake.signedInAs = null;
		await expect(fake.list()).rejects.toMatchObject({ code: "unauthorized", status: 401 });
	});

	test("refuseNext answers the injected refusal once", async () => {
		const fake = createFakeRemote({ accountId: "a" });
		fake.refuseNext.push(
			{ code: "unknown", status: 503 },
			{ code: "forbidden", status: 403 },
			{ code: "rate_limited", status: 429 }
		);
		await expect(fake.list()).rejects.toMatchObject({ code: "unknown", status: 503 });
		await expect(fake.get("d")).rejects.toMatchObject({ code: "forbidden", status: 403 });
		const save = fake.save("d", saveInput("a"));
		await expect(save).rejects.toBeInstanceOf(RemoteRefusal);
		await expect(save).rejects.toMatchObject({ code: "rate_limited", status: 429 });
		expect(fake.refuseNext).toEqual([]);
		// Injected refusals write nothing, and the next call answers normally.
		expect(await fake.save("d", saveInput("a"))).toMatchObject({ version: 1 });
		expect(fake.requests).toEqual(["list", "get d", "save d", "save d"]);
	});

	test("saves and kept snapshots share the per-minute rate limit", async () => {
		let at = Date.parse("2026-11-02T18:00:00.000Z");
		const fake = createFakeRemote({ accountId: "a", savesPerMinute: 2, now: () => new Date(at) });
		const { version } = await fake.save("d", saveInput("a"));
		const snapshot = {
			baseVersion: version,
			schemaVersion: 1,
			name: null,
			body: {},
			accountId: "a",
			buildId: "build"
		};
		await fake.keepSnapshot("d", snapshot);
		await expect(fake.keepSnapshot("d", snapshot)).rejects.toMatchObject({
			code: "rate_limited",
			status: 429
		});
		await expect(fake.save("d", { ...saveInput("a"), baseVersion: version })).rejects.toMatchObject(
			{ code: "rate_limited", status: 429 }
		);
		expect(fake.snapshots("d")).toHaveLength(1);
		// Reads aren't counted, and the next minute starts over.
		expect((await fake.get("d")).version).toBe(version);
		at += 60_000;
		expect((await fake.save("d", { ...saveInput("a"), baseVersion: version })).version).toBe(2);
	});

	test("the log keeps only the last logLimit versions", async () => {
		const fake = createFakeRemote({ accountId: "a", logLimit: 2 });
		let { version } = await fake.save("d", saveInput("a"));
		for (const n of [1, 2, 3]) {
			({ version } = await fake.save("d", {
				...saveInput("a"),
				baseVersion: version,
				changes: [{ schemaVersion: 1, change: { n } }]
			}));
		}
		expect(await fake.changes("d", version - 2)).toMatchObject({ changes: [{}, {}] });
		expect(await fake.changes("d", version - 3)).toMatchObject({ changes: null });
	});
});

function saveInput(accountId: string): SaveInput {
	return {
		schemaVersion: 1,
		name: "Secret name",
		body: { secret: "Secret body" },
		deletedAt: null,
		copiedFrom: null,
		baseVersion: null,
		changes: [],
		accountId,
		buildId: "build",
		snapshot: null
	};
}

/** Every report as text, errors and their causes included. */
function reportText(p: MemoryPlatform): string {
	const seen = new WeakSet<object>();
	return JSON.stringify(p.errors.reports, (_key, value: unknown) => {
		if (value instanceof Error) {
			return { name: value.name, message: value.message, cause: value.cause };
		}
		if (typeof value === "object" && value !== null) {
			if (seen.has(value)) return undefined;
			seen.add(value);
		}
		return value;
	});
}

function respond(status: number, body: unknown) {
	vi.stubGlobal(
		"fetch",
		vi.fn(
			async () =>
				new Response(JSON.stringify(body), {
					status,
					headers: { "Content-Type": "application/json" }
				})
		)
	);
}

describe("createSdkRemote", () => {
	let p: MemoryPlatform;
	beforeEach(() => {
		setOrigin("https://sjvair.test");
		p = createMemoryPlatform();
		setPlatform(p);
	});
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	test("a reported response error carries no document body or name", async () => {
		respond(200, { data: { id: "d", name: "Secret name", body: { secret: "Secret body" } } });
		await expect(createSdkRemote().get("d")).rejects.toBeInstanceOf(RemoteUnavailable);
		// A stale_base refusal whose payload doesn't match: the refusal itself holds the document.
		respond(409, {
			errors: { detail: [{ code: "stale_base", message: "Stale." }] },
			data: { version: 2, document: { name: "Secret name", body: { secret: "Secret body" } } }
		});
		await expect(
			createSdkRemote().save("d", { ...saveInput("a"), baseVersion: 1 })
		).rejects.toBeInstanceOf(RemoteUnavailable);
		expect(p.errors.reports).toHaveLength(2);
		expect(reportText(p)).not.toContain("Secret");
	});

	test("a refusal becomes a RemoteRefusal, with the stale base parsed", async () => {
		const document = {
			id: "d",
			kind: "dashboard",
			name: null,
			schema_version: 1,
			version: 3,
			copied_from: null,
			deleted_at: null,
			created_at: "2026-11-02T00:00:00Z",
			updated_at: "2026-11-02T00:01:00Z",
			visibility: "private",
			share_token: null,
			body: { widgets: [] }
		};
		respond(409, {
			errors: { detail: [{ code: "stale_base", message: "Stale." }] },
			data: {
				version: 3,
				schema_version: 1,
				changes: [{ version: 3, schema_version: 1, change: { op: "x" } }],
				document
			}
		});
		const error = await createSdkRemote()
			.save("d", { ...saveInput("a"), baseVersion: 2 })
			.catch((e: unknown) => e);
		expect(error).toBeInstanceOf(RemoteRefusal);
		expect(error).toMatchObject({
			code: "stale_base",
			status: 409,
			staleBase: {
				version: 3,
				changes: [{ version: 3, schemaVersion: 1, change: { op: "x" } }],
				document: {
					id: "d",
					schemaVersion: 1,
					version: 3,
					deletedAt: null,
					copiedFrom: null,
					createdAt: "2026-11-02T00:00:00Z",
					updatedAt: "2026-11-02T00:01:00Z",
					body: { widgets: [] }
				}
			}
		});
	});

	test("a malformed shared response reports no name or body", async () => {
		// The version isn't a number, so the SDK's schemas refuse it (and `{ version }` too).
		respond(200, {
			data: {
				id: "d",
				kind: "dashboard",
				name: "Secret name",
				schema_version: 1,
				version: "one",
				body: { secret: "Secret body" },
				updated_at: "2026-11-02T00:00:00Z"
			}
		});
		await expect(createSdkRemote().shared("token")).rejects.toBeInstanceOf(RemoteUnavailable);
		await expect(createSdkRemote().sharedChanges("token", 0)).rejects.toBeInstanceOf(
			RemoteUnavailable
		);
		expect(p.errors.reports.map((r) => r.context)).toEqual([
			{ operation: "documents.shared" },
			{ operation: "documents.sharedChanges" }
		]);
		expect(reportText(p)).not.toContain("Secret");
	});

	test("shared calls map the wire form", async () => {
		const shared = {
			id: "d",
			kind: "dashboard",
			name: "Shared",
			schema_version: 1,
			version: 4,
			body: { widgets: [] },
			updated_at: "2026-11-02T00:00:00Z",
			display_name: null
		};
		const document = {
			id: "d",
			kind: "dashboard",
			name: "Shared",
			schemaVersion: 1,
			version: 4,
			body: { widgets: [] },
			updatedAt: "2026-11-02T00:00:00Z",
			displayName: null
		};
		respond(200, { data: shared });
		expect(await createSdkRemote().shared("t")).toEqual(document);
		expect(await createSdkRemote().sharedChanges("t", 3)).toEqual({ version: 4, document });
		respond(200, { data: { version: 4 } });
		expect(await createSdkRemote().sharedChanges("t", 4)).toEqual({ version: 4 });
		respond(200, { data: { share_token: "abc" } });
		expect(await createSdkRemote().share("d")).toBe("abc");
		respond(200, { data: { name: "Original", display_name: "Ana" } });
		expect(await createSdkRemote().credit("d")).toEqual({ name: "Original", displayName: "Ana" });
		respond(200, { data: { display_name: "Ana" } });
		expect(await createSdkRemote().getProfile()).toEqual({ displayName: "Ana" });
		expect(await createSdkRemote().setProfile("Ana")).toEqual({ displayName: "Ana" });
		const [, init] = vi.mocked(fetch).mock.calls.at(-1) as [string, RequestInit];
		expect(JSON.parse(init.body as string)).toEqual({ display_name: "Ana" });
		respond(404, { errors: { detail: [{ code: "not_found", message: "Gone." }] } });
		await expect(createSdkRemote().shared("t")).rejects.toMatchObject({
			code: "not_found",
			status: 404
		});
	});

	test("share_token is kept only while the visibility is link or public", async () => {
		const doc = {
			id: "d",
			kind: "dashboard",
			name: null,
			schema_version: 1,
			version: 1,
			copied_from: null,
			deleted_at: null,
			created_at: "2026-11-02T00:00:00Z",
			updated_at: "2026-11-02T00:00:00Z",
			body: {}
		};
		respond(200, { data: { ...doc, visibility: "link", share_token: "abc" } });
		expect((await createSdkRemote().get("d")).shareToken).toBe("abc");
		respond(200, { data: { ...doc, visibility: "public", share_token: "abc" } });
		expect((await createSdkRemote().get("d")).shareToken).toBe("abc");
		respond(200, { data: { ...doc, visibility: "private", share_token: "abc" } });
		expect((await createSdkRemote().get("d")).shareToken).toBeNull();
	});

	test("a network error becomes RemoteUnavailable", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => {
				throw new TypeError("Failed to fetch");
			})
		);
		await expect(createSdkRemote().list()).rejects.toBeInstanceOf(RemoteUnavailable);
		expect(p.errors.reports).toEqual([]);
	});

	test("keepSnapshot calls createSnapshot with the wire form", async () => {
		respond(201, {
			data: {
				id: 1,
				version: 3,
				schema_version: 1,
				name: "Mine",
				reason: "conflict",
				created_at: "2026-11-02T00:00:00Z"
			}
		});
		const input = {
			baseVersion: 3,
			schemaVersion: 1,
			name: "Mine",
			body: { widgets: ["mine"] },
			accountId: "a",
			buildId: "b"
		};
		await expect(createSdkRemote().keepSnapshot("d", input)).resolves.toBeUndefined();
		const [url, init] = vi.mocked(fetch).mock.calls[0] as [string | URL | Request, RequestInit];
		expect(String(url)).toContain("documents/d/snapshots/");
		expect(init.method).toBe("POST");
		expect(JSON.parse(init.body as string)).toEqual({
			base_version: 3,
			schema_version: 1,
			name: "Mine",
			body: { widgets: ["mine"] },
			account_id: "a",
			build_id: "b"
		});

		respond(409, {
			errors: { detail: [{ code: "stale_base", message: "Stale." }] },
			data: {
				version: 4,
				schema_version: 1,
				changes: null,
				document: {
					id: "d",
					kind: "dashboard",
					name: null,
					schema_version: 1,
					version: 4,
					copied_from: null,
					deleted_at: null,
					created_at: "2026-11-02T00:00:00Z",
					updated_at: "2026-11-02T00:01:00Z",
					visibility: "private",
					share_token: null,
					body: {}
				}
			}
		});
		const error = await createSdkRemote()
			.keepSnapshot("d", input)
			.catch((e: unknown) => e);
		expect(error).toBeInstanceOf(RemoteRefusal);
		expect(error).toMatchObject({
			code: "stale_base",
			status: 409,
			staleBase: { version: 4, changes: null, document: { id: "d", version: 4 } }
		});
	});
});
