import { afterAll, beforeEach, describe, expect, test } from "vitest";
import {
	RemoteRefusal,
	RemoteUnavailable,
	type RemoteDocuments,
	type SaveInput,
	type SnapshotInput
} from "./remote";
import type { FakeRemote } from "./remote-fake";

/** What each contract case runs against: the remote and the account it is signed in as. */
export type RemoteContractSubject = { remote: RemoteDocuments; accountId: string };

export type RemoteContractOptions = {
	/** Also run the cases only the fake can set up (`make` must then return a `FakeRemote`). */
	fakeOnly: boolean;
	/** Called once at the end with every id the cases created (the stack removes them). */
	cleanup?: (ids: string[]) => Promise<void>;
};

const BUILD = "contract-build";

async function refusal(promise: Promise<unknown>): Promise<RemoteRefusal> {
	const error = await promise.then(
		() => undefined,
		(e: unknown) => e
	);
	expect(error).toBeInstanceOf(RemoteRefusal);
	return error as RemoteRefusal;
}

/**
 * The behavior every `RemoteDocuments` shares, run against the fake (every case) and the local
 * sjvair.com stack (the cases a client can set up).
 */
export function runRemoteContract(
	name: string,
	make: () => Promise<RemoteContractSubject>,
	options: RemoteContractOptions
) {
	describe(`remote contract: ${name}`, () => {
		const created: string[] = [];
		let remote: RemoteDocuments;
		let accountId: string;

		beforeEach(async () => {
			({ remote, accountId } = await make());
		});

		afterAll(async () => {
			await options.cleanup?.(created);
		});

		/** A fresh id (the stack's account is shared between runs). */
		function newId(): string {
			const id = `contract-${crypto.randomUUID().slice(0, 12)}`;
			created.push(id);
			return id;
		}

		function input(overrides: Partial<SaveInput> = {}): SaveInput {
			return {
				schemaVersion: 1,
				name: "Contract",
				body: { widgets: [] },
				deletedAt: null,
				copiedFrom: null,
				baseVersion: null,
				changes: [],
				accountId,
				buildId: BUILD,
				snapshot: null,
				...overrides
			};
		}

		function change(n: number) {
			return { schemaVersion: 1, change: { op: "setField", to: `v${n}` } };
		}

		/** Creates a document and saves `count` more versions, one change each. */
		async function build(id: string, count: number): Promise<number> {
			let { version } = await remote.save(id, input());
			for (let n = 1; n <= count; n++) {
				({ version } = await remote.save(
					id,
					input({ baseVersion: version, body: { widgets: [n] }, changes: [change(n)] })
				));
			}
			return version;
		}

		test("create, then get and list", async () => {
			const id = newId();
			const saved = await remote.save(id, input({ name: "First" }));
			expect(saved.version).toBeGreaterThan(0);
			expect(typeof saved.updatedAt).toBe("string");

			const doc = await remote.get(id);
			expect(doc).toMatchObject({
				id,
				kind: "dashboard",
				name: "First",
				schemaVersion: 1,
				version: saved.version,
				body: { widgets: [] },
				deletedAt: null,
				copiedFrom: null
			});
			expect(typeof doc.createdAt).toBe("string");
			expect(typeof doc.updatedAt).toBe("string");

			const { documents, purged, cursor } = await remote.list();
			const meta = documents.find((d) => d.id === id);
			expect(meta).toMatchObject({ id, name: "First", version: saved.version });
			expect(meta).not.toHaveProperty("body");
			expect(Array.isArray(purged)).toBe(true);
			expect(typeof cursor).toBe("string");
		});

		test("a save on the current base bumps the version", async () => {
			const id = newId();
			const first = await remote.save(id, input());
			const second = await remote.save(
				id,
				input({ baseVersion: first.version, body: { widgets: [1] }, changes: [change(1)] })
			);
			expect(second.version).toBe(first.version + 1);
			const doc = await remote.get(id);
			expect(doc.version).toBe(second.version);
			expect(doc.body).toEqual({ widgets: [1] });
		});

		test("a stale base is refused with the changes since it and the document", async () => {
			const id = newId();
			const first = (await remote.save(id, input())).version;
			let version = first;
			for (const n of [1, 2]) {
				({ version } = await remote.save(
					id,
					input({ baseVersion: version, body: { widgets: [n] }, changes: [change(n)] })
				));
			}

			const error = await refusal(
				remote.save(id, input({ baseVersion: first, changes: [change(9)] }))
			);
			expect(error.code).toBe("stale_base");
			expect(error.status).toBe(409);
			expect(error.staleBase).toEqual({
				version,
				changes: [
					{ version: first + 1, ...change(1) },
					{ version: first + 2, ...change(2) }
				],
				document: expect.objectContaining({ id, version, body: { widgets: [2] } })
			});
		});

		test("changes since the current version is just the version", async () => {
			const id = newId();
			const first = (await remote.save(id, input())).version;
			const { version } = await remote.save(
				id,
				input({ baseVersion: first, body: { widgets: [1] }, changes: [change(1)] })
			);
			expect(await remote.changes(id, version)).toEqual({ version });
			expect(await remote.changes(id, first)).toEqual({
				version,
				changes: [{ version, ...change(1) }],
				document: expect.objectContaining({ id, version, body: { widgets: [1] } })
			});
		});

		test("list since a cursor returns only what changed", async () => {
			const before = newId();
			await remote.save(before, input());
			const { cursor } = await remote.list();
			const after = newId();
			await remote.save(after, input());

			const since = await remote.list(cursor);
			const ids = since.documents.map((d) => d.id);
			expect(ids).toContain(after);
			// The server's cursor overlaps the previous list by a few seconds, so a document saved
			// just before it may come back too; anything listed was updated at or after it.
			const at = Date.parse(cursor);
			for (const doc of since.documents) {
				expect(Date.parse(doc.updatedAt)).toBeGreaterThanOrEqual(at - 1);
			}
			const beforeDoc = await remote.get(before);
			if (Date.parse(beforeDoc.updatedAt) < at - 1) expect(ids).not.toContain(before);
		});

		test("a schema downgrade is refused", async () => {
			const id = newId();
			const { version } = await remote.save(id, input({ schemaVersion: 2 }));
			const error = await refusal(
				remote.save(id, input({ schemaVersion: 1, baseVersion: version }))
			);
			expect(error.code).toBe("schema_downgrade");
			expect(error.status).toBe(409);
			expect((await remote.get(id)).version).toBe(version);
		});

		test("a save naming another account is refused", async () => {
			const id = newId();
			const error = await refusal(remote.save(id, input({ accountId: `${accountId}-other` })));
			expect(error.code).toBe("account_mismatch");
			expect(error.status).toBe(403);
			const missing = await refusal(remote.get(id));
			expect(missing.code).toBe("not_found");
		});

		function snapshotInput(overrides: Partial<SnapshotInput> = {}): SnapshotInput {
			return {
				baseVersion: 0,
				schemaVersion: 1,
				name: "Mine",
				body: { widgets: ["mine"] },
				accountId,
				buildId: BUILD,
				...overrides
			};
		}

		test("keepSnapshot leaves the document and its version alone", async () => {
			const id = newId();
			const { version } = await remote.save(id, input({ body: { widgets: ["theirs"] } }));
			const before = await remote.get(id);
			await remote.keepSnapshot(id, snapshotInput({ baseVersion: version }));
			expect(await remote.get(id)).toEqual(before);
			expect(await remote.changes(id, version)).toEqual({ version });
		});

		test("keepSnapshot on a stale base is stale_base", async () => {
			const id = newId();
			const version = await build(id, 1);
			const error = await refusal(
				remote.keepSnapshot(id, snapshotInput({ baseVersion: version - 1 }))
			);
			expect(error.code).toBe("stale_base");
			expect(error.status).toBe(409);
			expect(error.staleBase).toEqual({
				version,
				changes: [{ version, ...change(1) }],
				document: expect.objectContaining({ id, version })
			});
			if (options.fakeOnly) expect((remote as FakeRemote).snapshots(id)).toEqual([]);

			const missing = await refusal(remote.keepSnapshot(newId(), snapshotInput()));
			expect(missing.code).toBe("not_found");
		});

		if (!options.fakeOnly) return;

		// The stack can't set these up from the client.
		describe("fake only", () => {
			let fake: FakeRemote;
			beforeEach(() => {
				fake = remote as FakeRemote;
			});

			test("a trimmed log answers null changes", async () => {
				const id = newId();
				const version = await build(id, 2);
				fake.trimLog(id);

				const stale = await refusal(remote.save(id, input({ baseVersion: version - 1 })));
				expect(stale.code).toBe("stale_base");
				expect(stale.staleBase?.changes).toBeNull();
				expect(stale.staleBase?.document.version).toBe(version);

				const changes = await remote.changes(id, version - 1);
				expect(changes).toMatchObject({ version, changes: null });
				expect("document" in changes && changes.document.body).toEqual({ widgets: [2] });
			});

			test("an id owned elsewhere is id_taken", async () => {
				const id = newId();
				fake.ownerOf(id, "account-elsewhere");
				const error = await refusal(remote.save(id, input()));
				expect(error.code).toBe("id_taken");
				expect(error.status).toBe(409);
				expect((await refusal(remote.get(id))).code).toBe("not_found");
				expect((await remote.list()).documents.map((d) => d.id)).not.toContain(id);
			});

			test("a purged id is gone and listed in purged", async () => {
				const id = newId();
				const { version } = await remote.save(id, input());
				const { cursor } = await remote.list();
				fake.purge(id);

				const listed = await remote.list(cursor);
				expect(listed.purged).toContain(id);
				expect(listed.documents.map((d) => d.id)).not.toContain(id);
				expect((await refusal(remote.get(id))).code).toBe("gone");
				expect((await refusal(remote.changes(id, version))).code).toBe("gone");
				const save = await refusal(remote.save(id, input({ baseVersion: version })));
				expect(save.code).toBe("gone");
				expect(save.status).toBe(410);
			});

			test("a blocked build is refused", async () => {
				const id = newId();
				fake.blockedBuilds.add(BUILD);
				const error = await refusal(remote.save(id, input()));
				expect(error.code).toBe("build_blocked");
				expect(error.status).toBe(409);
			});

			test("over maxDocuments is limit_documents", async () => {
				fake.maxDocuments = 2;
				await remote.save(newId(), input());
				const trashed = newId();
				await remote.save(trashed, input({ deletedAt: "2026-11-01T00:00:00.000Z" }));
				await remote.save(newId(), input());

				const error = await refusal(remote.save(newId(), input()));
				expect(error.code).toBe("limit_documents");
				expect(error.status).toBe(403);
				// Restoring from the trash counts too; trashing still works.
				const restore = await refusal(remote.save(trashed, input({ baseVersion: 1 })));
				expect(restore.code).toBe("limit_documents");
				expect(
					(await remote.save(trashed, input({ baseVersion: 1, deletedAt: "2026-11-02T00:00:00Z" })))
						.version
				).toBe(2);
			});

			test("snapshot: conflict keeps the replaced version", async () => {
				const id = newId();
				const { version } = await remote.save(id, input({ body: { widgets: ["theirs"] } }));
				await remote.save(
					id,
					input({ baseVersion: version, body: { widgets: ["mine"] }, snapshot: "conflict" })
				);
				expect(fake.snapshots(id)).toEqual([
					{ version, reason: "conflict", body: { widgets: ["theirs"] } }
				]);
			});

			test("keepSnapshot keeps the given content as a conflict snapshot and leaves the version alone", async () => {
				const id = newId();
				const { version } = await remote.save(id, input({ body: { widgets: ["theirs"] } }));
				const before = await remote.get(id);
				fake.requests.length = 0;

				await remote.keepSnapshot(id, snapshotInput({ baseVersion: version }));

				expect(fake.requests).toEqual([`keepSnapshot ${id}`]);
				expect(fake.snapshots(id)).toEqual([
					{ version, reason: "conflict", body: { widgets: ["mine"] } }
				]);
				expect(await remote.get(id)).toEqual(before);
				expect(await remote.changes(id, version)).toEqual({ version });
				// A trashed document and an older schema are accepted too.
				const trashed = await remote.save(
					id,
					input({ baseVersion: version, schemaVersion: 2, deletedAt: "2026-11-02T00:00:00Z" })
				);
				await remote.keepSnapshot(
					id,
					snapshotInput({ baseVersion: trashed.version, schemaVersion: 1 })
				);
				expect(fake.snapshots(id)).toHaveLength(3);
			});

			test("offline throws RemoteUnavailable", async () => {
				const id = newId();
				await remote.save(id, input());
				fake.offline = true;
				const calls: Array<() => Promise<unknown>> = [
					() => remote.list(),
					() => remote.get(id),
					() => remote.changes(id, 0),
					() => remote.save(id, input({ baseVersion: 1 })),
					() => remote.keepSnapshot(id, snapshotInput({ baseVersion: 1 }))
				];
				for (const call of calls) {
					await expect(call()).rejects.toBeInstanceOf(RemoteUnavailable);
				}
				fake.offline = false;
				expect((await remote.get(id)).version).toBe(1);
			});
		});
	});
}
