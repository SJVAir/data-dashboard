import { describe, expect, it, vi } from "vitest";
import { z } from "$lib/zod";
import type { Migration } from "$lib/documents/load";
import { CURRENT_SCHEMA_VERSION, type Dashboard } from "$lib/documents/schema";
import { createMemoryPlatform } from "$lib/platform/memory";
import type { AppContext } from "$lib/store/app.svelte";
import { DocumentSession } from "$lib/store/document-session.svelte";
import { MAX_DOCUMENT_CHARS } from "$lib/sharing/envelope";
import { uploadDocument } from "$lib/sync/upload";
import { NOW, SPACE, makeDoc, setupSync, storeDoc, title, widget } from "$lib/sync/test-support";
import { SyncWorker } from "$lib/sync/worker.svelte";
import { RemoteRefusal, RemoteUnavailable } from "$lib/sync/remote";
import { listEarlierVersions, restoreEarlierVersion } from "./restore-version";

vi.mock("$lib/safety/report", () => ({ report: vi.fn() }));

const OLD = CURRENT_SCHEMA_VERSION - 1;

const upgrade: Migration[] = [
	{
		from: OLD,
		to: CURRENT_SCHEMA_VERSION,
		schema: z.unknown(),
		migrate: (raw) => ({ ...(raw as object), schemaVersion: CURRENT_SCHEMA_VERSION }),
		migrateChange: (change) => change
	}
];

const original = {
	...makeDoc("d1"),
	schemaVersion: OLD,
	name: "Original",
	body: { widgets: [widget("a"), widget("b", { x: 6, y: 0, w: 6, h: 4 })] }
};

async function open(platform: ReturnType<typeof createMemoryPlatform>, chain?: Migration[]) {
	return (await DocumentSession.open(platform, SPACE, "d1", "tab-1", {
		debounceMs: 60_000,
		now: () => NOW,
		chain
	}))!;
}

/** A signed-in space with `d1` uploaded and open, and a worker over the fake server. */
async function account() {
	const setup = await setupSync();
	await storeDoc(setup.platform, { ...makeDoc("d1"), name: "Current" });
	expect(await uploadDocument(setup.ctx, "d1")).toBe("saved");
	const worker = new SyncWorker(setup.ctx);
	const app = { platform: setup.platform, space: SPACE, sync: worker } as unknown as AppContext;
	const session = await open(setup.platform);
	/** Seeds a server snapshot with this content at `schemaVersion`. */
	const seed = async (name: string, schemaVersion = CURRENT_SCHEMA_VERSION) => {
		const server = await setup.fake.get("d1");
		await setup.fake.keepSnapshot("d1", {
			baseVersion: server.version,
			schemaVersion,
			name,
			body: { widgets: [widget("z")] },
			accountId: setup.ctx.accountId,
			buildId: "other-build"
		});
		return setup.fake.snapshots("d1").at(-1)!.id;
	};
	return { ...setup, app, session, worker, seed };
}

describe("listEarlierVersions", () => {
	it("lists the local original and server snapshots newest first", async () => {
		const { app, session, platform, seed, fake } = await account();
		await platform.originals.put(SPACE, {
			id: "d1",
			raw: original,
			keptAt: "2026-10-01T00:00:00.000Z",
			fromSchemaVersion: OLD
		});
		const first = await seed("One");
		const second = await seed("Two");
		const { versions, account: status } = await listEarlierVersions(app, session);
		expect(status).toBe("ok");
		expect(versions.map((v) => (v.source === "server" ? v.id : "local"))).toEqual([
			second,
			first,
			"local"
		]);
		expect(versions[0]).toMatchObject({ source: "server", reason: "conflict" });
		expect(fake.snapshots("d1")).toHaveLength(2);
		session.dispose();
	});

	it("the anonymous space lists only the local original and asks no server", async () => {
		const platform = createMemoryPlatform();
		await platform.documents.commit("anonymous", {
			docId: "d1",
			baseVersion: null,
			doc: original as unknown as Dashboard,
			entries: []
		});
		const session = (await DocumentSession.open(platform, "anonymous", "d1", "tab-1", {
			debounceMs: 60_000,
			now: () => NOW,
			chain: upgrade
		}))!;
		const app = { platform, space: "anonymous", sync: null } as unknown as AppContext;
		const { versions, account: status } = await listEarlierVersions(app, session);
		expect(versions).toHaveLength(1);
		expect(versions[0].source).toBe("local");
		expect(status).toBe("none");
		session.dispose();
	});

	it("offline lists the local original and says the account is offline", async () => {
		const { app, session, platform, fake } = await account();
		await platform.originals.put(SPACE, {
			id: "d1",
			raw: original,
			keptAt: "2026-10-01T00:00:00.000Z",
			fromSchemaVersion: OLD
		});
		fake.offline = true;
		const { versions, account: status } = await listEarlierVersions(app, session);
		expect(versions.map((v) => v.source)).toEqual(["local"]);
		expect(status).toBe("offline");
		session.dispose();
	});

	it("a refused list because the dashboard is gone says so", async () => {
		const { app, session } = await account();
		for (const code of ["gone", "not_found"] as const) {
			const sync = {
				isInAccount: async () => true,
				versions: async () => {
					throw new RemoteRefusal(code, 404);
				}
			};
			const gone = { ...app, sync } as unknown as AppContext;
			expect((await listEarlierVersions(gone, session)).account).toBe("gone");
		}
		const down = {
			...app,
			sync: {
				isInAccount: async () => true,
				versions: async () => {
					throw new RemoteUnavailable();
				}
			}
		} as unknown as AppContext;
		expect((await listEarlierVersions(down, session)).account).toBe("offline");
		session.dispose();
	});

	it("any other refusal is unavailable, not offline", async () => {
		const { app, session } = await account();
		for (const [code, status] of [
			["unauthorized", 401],
			["rate_limited", 429],
			["forbidden", 403]
		] as const) {
			const refused = {
				...app,
				sync: {
					isInAccount: async () => true,
					versions: async () => {
						throw new RemoteRefusal(code, status);
					}
				}
			} as unknown as AppContext;
			expect((await listEarlierVersions(refused, session)).account).toBe("unavailable");
		}
		const broken = {
			...app,
			sync: {
				isInAccount: async () => true,
				versions: async () => {
					throw new TypeError("bad answer");
				}
			}
		} as unknown as AppContext;
		expect((await listEarlierVersions(broken, session)).account).toBe("unavailable");
		session.dispose();
	});

	it("never uploaded, or a first upload in flight, is none and asks no server", async () => {
		const { app, session, platform } = await account();
		const record = (await platform.sync.get(SPACE, "d1"))!;
		const versions = vi.fn();
		const run = async () => {
			const real = app.sync as unknown as { isInAccount(id: string): Promise<boolean> };
			const sync = { isInAccount: (id: string) => real.isInAccount(id), versions };
			return (await listEarlierVersions({ ...app, sync } as unknown as AppContext, session))
				.account;
		};
		await platform.sync.put(SPACE, { ...record, serverVersion: null, inFlight: null });
		expect(await run()).toBe("none");
		await platform.sync.put(SPACE, {
			...record,
			serverVersion: null,
			inFlight: { baseVersion: null, throughVersion: 1, changes: "[]" }
		});
		expect(await run()).toBe("none");
		expect(versions).not.toHaveBeenCalled();
		session.dispose();
	});

	it("leaves out the account's copy of the kept original and marks the local entry", async () => {
		const { app, session, platform } = await account();
		await platform.originals.put(SPACE, {
			id: "d1",
			raw: { ...original, version: 7 },
			keptAt: "2026-10-01T00:00:00.000Z",
			fromSchemaVersion: OLD
		});
		const meta = (id: number, reason: string, version: number, schemaVersion: number) => ({
			id,
			reason,
			version,
			schemaVersion,
			createdAt: "2026-10-01T00:00:01.000Z"
		});
		const sync = {
			isInAccount: async () => true,
			versions: async () => [
				meta(1, "schema", 7, OLD),
				meta(2, "schema", 8, OLD),
				meta(3, "daily", 7, OLD)
			]
		};
		const { versions } = await listEarlierVersions(
			{ ...app, sync } as unknown as AppContext,
			session
		);
		expect(versions.map((v) => (v.source === "server" ? v.id : "local")).sort()).toEqual([
			2,
			3,
			"local"
		]);
		expect(versions.find((v) => v.source === "local")).toMatchObject({ alsoInAccount: true });
		session.dispose();
	});
});

describe("restoreEarlierVersion", () => {
	it("restoring a server snapshot replaces the content as one undoable change", async () => {
		const { app, session, seed } = await account();
		const id = await seed("Earlier");
		const result = await restoreEarlierVersion(app, session, {
			source: "server",
			at: NOW.toISOString(),
			id,
			reason: "conflict"
		});
		expect(result).toBe("restored");
		expect(session.doc.name).toBe("Earlier");
		expect(session.doc.body.widgets.map((w) => w.id)).toEqual(["z"]);
		session.undo();
		expect(session.doc.name).toBe("Current");
		expect(session.doc.body.widgets.map((w) => w.id)).toEqual(["a", "b"]);
		session.dispose();
	});

	it("restoring keeps the replaced version on the server first", async () => {
		const { app, session, seed, fake } = await account();
		session.apply(title("a", "Mine"));
		const id = await seed("Earlier");
		const before = fake.snapshots("d1").length;
		await restoreEarlierVersion(app, session, {
			source: "server",
			at: NOW.toISOString(),
			id,
			reason: "conflict"
		});
		const snapshots = fake.snapshots("d1");
		expect(snapshots).toHaveLength(before + 1);
		const newest = snapshots.at(-1)!;
		expect(newest.reason).toBe("conflict");
		expect(JSON.stringify(newest.body)).toContain("Mine");
		expect(newest.name).toBe("Current");
		session.dispose();
	});

	it("a failed keep restores nothing", async () => {
		const { app, session, seed, fake } = await account();
		const id = await seed("Earlier");
		const before = JSON.stringify(session.doc);
		fake.offline = true;
		const result = await restoreEarlierVersion(app, session, {
			source: "server",
			at: NOW.toISOString(),
			id,
			reason: "conflict"
		});
		expect(result).toBe("unreachable");
		expect(JSON.stringify(session.doc)).toBe(before);
		session.dispose();
	});

	it("a keep or fetch refused for another reason is unavailable, not unreachable", async () => {
		const { app, session, seed, fake } = await account();
		const id = await seed("Earlier");
		const before = JSON.stringify(session.doc);
		const version = { source: "server", at: NOW.toISOString(), id, reason: "conflict" } as const;
		fake.refuseNext.push({ code: "rate_limited", status: 429 });
		expect(await restoreEarlierVersion(app, session, version)).toBe("unavailable");
		const keep = app.sync!.keepBeforeRestore.bind(app.sync);
		app.sync!.keepBeforeRestore = async () => {
			throw new RemoteRefusal("forbidden", 403);
		};
		expect(await restoreEarlierVersion(app, session, version)).toBe("unavailable");
		app.sync!.keepBeforeRestore = keep;
		expect(JSON.stringify(session.doc)).toBe(before);
		session.dispose();
	});

	it("restores the local original, keeping the current version on the server", async () => {
		const { app, session, platform, fake } = await account();
		await platform.originals.put(SPACE, {
			id: "d1",
			raw: { ...original, schemaVersion: CURRENT_SCHEMA_VERSION },
			keptAt: "2026-10-01T00:00:00.000Z",
			fromSchemaVersion: OLD
		});
		const before = fake.snapshots("d1").length;
		expect(
			await restoreEarlierVersion(app, session, {
				source: "local",
				at: "2026-10-01T00:00:00.000Z",
				alsoInAccount: false
			})
		).toBe("restored");
		expect(session.doc.name).toBe("Original");
		expect(fake.snapshots("d1")).toHaveLength(before + 1);
		session.dispose();
	});

	it("an older-format snapshot is upgraded", async () => {
		const { app, session, worker } = await account();
		// The fake server refuses a snapshot below schema 1, so the worker hands back an old one.
		const id = 7;
		vi.spyOn(worker, "version").mockResolvedValue({
			id,
			version: 1,
			schemaVersion: OLD,
			name: "Old format",
			body: { widgets: [widget("z")] },
			createdAt: NOW.toISOString()
		});
		const result = await restoreEarlierVersion(
			app,
			session,
			{ source: "server", at: NOW.toISOString(), id, reason: "schema" },
			upgrade
		);
		expect(result).toBe("restored");
		expect(session.doc.name).toBe("Old format");
		expect(session.doc.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
		session.dispose();
	});

	it("a newer-format snapshot is refused as newer", async () => {
		const { app, session, seed } = await account();
		const id = await seed("From the future", CURRENT_SCHEMA_VERSION + 1);
		const before = JSON.stringify(session.doc);
		const result = await restoreEarlierVersion(app, session, {
			source: "server",
			at: NOW.toISOString(),
			id,
			reason: "schema"
		});
		expect(result).toBe("newer");
		expect(JSON.stringify(session.doc)).toBe(before);
		session.dispose();
	});

	it("an oversized snapshot is unreadable", async () => {
		const { app, session, worker } = await account();
		vi.spyOn(worker, "version").mockResolvedValue({
			id: 1,
			version: 1,
			reason: "conflict",
			schemaVersion: CURRENT_SCHEMA_VERSION,
			name: "Huge",
			body: { widgets: [widget("z")], pad: "x".repeat(MAX_DOCUMENT_CHARS) },
			createdAt: NOW.toISOString()
		} as never);
		const before = JSON.stringify(session.doc);
		const result = await restoreEarlierVersion(app, session, {
			source: "server",
			at: NOW.toISOString(),
			id: 1,
			reason: "conflict"
		});
		expect(result).toBe("unreadable");
		expect(JSON.stringify(session.doc)).toBe(before);
		session.dispose();
	});

	it("a read-only dashboard restores nothing", async () => {
		const { app, session } = await account();
		session.readOnly = "invalid";
		expect(
			await restoreEarlierVersion(app, session, {
				source: "local",
				at: NOW.toISOString(),
				alsoInAccount: false
			})
		).toBe("read-only");
		session.dispose();
	});
});
