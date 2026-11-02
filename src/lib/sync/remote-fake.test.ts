import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { setOrigin } from "@sjvair/sdk/http";
import { setPlatform } from "$lib/platform";
import { createMemoryPlatform, type MemoryPlatform } from "$lib/platform/memory";
import { RemoteRefusal, RemoteUnavailable, type SaveInput } from "./remote";
import { runRemoteContract } from "./remote-contract";
import { createFakeRemote } from "./remote-fake";
import { createSdkRemote } from "./remote-sdk";

/** A clock that moves a minute every time it is read, so cursors separate saves. */
function steppingClock(): () => Date {
	let at = Date.parse("2026-11-02T18:00:00.000Z");
	return () => new Date((at += 60_000));
}

runRemoteContract(
	"fake",
	async () => ({
		remote: createFakeRemote({ accountId: "account-1", now: steppingClock() }),
		accountId: "account-1"
	}),
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
		const seen = new WeakSet<object>();
		const text = JSON.stringify(p.errors.reports, (_key, value: unknown) => {
			if (value instanceof Error) {
				return { name: value.name, message: value.message, cause: value.cause };
			}
			if (typeof value === "object" && value !== null) {
				if (seen.has(value)) return undefined;
				seen.add(value);
			}
			return value;
		});
		expect(text).not.toContain("Secret");
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

	test("keepSnapshot waits for the next SDK release", async () => {
		const call = createSdkRemote().keepSnapshot("d", {
			baseVersion: 1,
			schemaVersion: 1,
			name: null,
			body: {},
			accountId: "a",
			buildId: "b"
		});
		await expect(call).rejects.toBeInstanceOf(RemoteUnavailable);
		await expect(call).rejects.toThrow("keepSnapshot needs @sjvair/sdk 4.8.0-beta.3");
	});
});
