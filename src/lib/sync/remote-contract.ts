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
	/** A caller with no session, on the same server as `make`'s (called after it, per case). */
	makeSignedOut: () => Promise<RemoteDocuments>,
	options: RemoteContractOptions
) {
	describe(`remote contract: ${name}`, () => {
		const created: string[] = [];
		let remote: RemoteDocuments;
		let signedOut: RemoteDocuments;
		let accountId: string;

		beforeEach(async () => {
			({ remote, accountId } = await make());
			signedOut = await makeSignedOut();
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
			if (options.fakeOnly) {
				const conflicts = (remote as FakeRemote)
					.snapshots(id)
					.filter((s) => s.reason === "conflict");
				expect(conflicts).toEqual([]);
			}

			const missing = await refusal(remote.keepSnapshot(newId(), snapshotInput()));
			expect(missing.code).toBe("not_found");
		});

		describe("sharing", () => {
			const TRASHED = "2026-11-02T00:00:00.000Z";

			/** A token no document has. */
			function unknownToken(): string {
				return `unknown-${crypto.randomUUID()}`;
			}

			test("create link, then anyone opens it", async () => {
				const id = newId();
				const { version } = await remote.save(
					id,
					input({ name: "Shared", body: { widgets: [7] } })
				);
				const token = await remote.share(id);
				expect(typeof token).toBe("string");
				expect(token.length).toBeGreaterThan(0);
				expect((await remote.get(id)).shareToken).toBe(token);

				const shared = await signedOut.shared(token);
				expect(shared).toMatchObject({
					id,
					kind: "dashboard",
					name: "Shared",
					schemaVersion: 1,
					version,
					body: { widgets: [7] },
					// The fake starts with none; the stack's account may have one set.
					displayName: (await remote.getProfile()).displayName
				});
				expect(typeof shared.updatedAt).toBe("string");
				// Nothing about the owner, the trash, or copies.
				expect(Object.keys(shared).sort()).toEqual(
					[
						"body",
						"displayName",
						"id",
						"kind",
						"name",
						"schemaVersion",
						"updatedAt",
						"version"
					].sort()
				);
			});

			test("sharing again keeps the token", async () => {
				const id = newId();
				await remote.save(id, input());
				const token = await remote.share(id);
				expect(await remote.share(id)).toBe(token);
			});

			test("list since shows a share without a version change", async () => {
				const id = newId();
				const { version } = await remote.save(id, input());
				const { cursor } = await remote.list();
				expect((await remote.get(id)).shareToken).toBeNull();
				const token = await remote.share(id);

				const listed = (await remote.list(cursor)).documents.find((d) => d.id === id);
				expect(listed).toMatchObject({ id, version, shareToken: token });
				const doc = await remote.get(id);
				expect(doc.version).toBe(version);
				expect(doc.shareToken).toBe(token);
			});

			test("stop sharing: the link stops, and a new link is different", async () => {
				const id = newId();
				const { version } = await remote.save(id, input());
				const token = await remote.share(id);
				await remote.unshare(id);

				const doc = await remote.get(id);
				expect(doc.shareToken).toBeNull();
				expect(doc.version).toBe(version);
				expect((await refusal(signedOut.shared(token))).code).toBe("not_found");

				const next = await remote.share(id);
				expect(next).not.toBe(token);
				expect((await signedOut.shared(next)).id).toBe(id);
				expect((await refusal(signedOut.shared(token))).code).toBe("not_found");
			});

			test("private, revoked, trashed, and unknown tokens answer the same not_found", async () => {
				// Private: never shared, so it has no token; try its id as one.
				const privateId = newId();
				await remote.save(privateId, input());

				const revokedId = newId();
				await remote.save(revokedId, input());
				const revoked = await remote.share(revokedId);
				await remote.unshare(revokedId);

				const trashedId = newId();
				const { version } = await remote.save(trashedId, input());
				const trashed = await remote.share(trashedId);
				await remote.save(trashedId, input({ baseVersion: version, deletedAt: TRASHED }));

				for (const token of [privateId, revoked, trashed, unknownToken()]) {
					const shared = await refusal(signedOut.shared(token));
					expect([shared.code, shared.status]).toEqual(["not_found", 404]);
					const changes = await refusal(signedOut.sharedChanges(token, 0));
					expect([changes.code, changes.status]).toEqual(["not_found", 404]);
				}
			});

			test("restoring a trashed dashboard brings the same link back", async () => {
				const id = newId();
				let { version } = await remote.save(id, input());
				const token = await remote.share(id);
				({ version } = await remote.save(id, input({ baseVersion: version, deletedAt: TRASHED })));
				expect((await refusal(signedOut.shared(token))).code).toBe("not_found");
				// Sharing a trashed dashboard is refused too.
				expect((await refusal(remote.share(id))).code).toBe("not_found");

				await remote.save(id, input({ baseVersion: version }));
				expect((await remote.get(id)).shareToken).toBe(token);
				expect((await signedOut.shared(token)).id).toBe(id);
			});

			test("shared changes: just the version, then the new document after a save", async () => {
				const id = newId();
				const first = (await remote.save(id, input())).version;
				const token = await remote.share(id);
				expect(await signedOut.sharedChanges(token, first)).toEqual({ version: first });

				const { version } = await remote.save(
					id,
					input({ baseVersion: first, body: { widgets: [1] }, changes: [change(1)] })
				);
				const changes = await signedOut.sharedChanges(token, first);
				expect(changes).toEqual({
					version,
					document: expect.objectContaining({ id, version, body: { widgets: [1] } })
				});
				expect(await signedOut.sharedChanges(token, version)).toEqual({ version });
			});

			test("a bad since on a dead link is still not_found", async () => {
				const dead = await refusal(signedOut.sharedChanges(unknownToken(), -1));
				expect([dead.code, dead.status]).toEqual(["not_found", 404]);

				const id = newId();
				await remote.save(id, input());
				const token = await remote.share(id);
				const bad = await refusal(signedOut.sharedChanges(token, -1));
				expect([bad.code, bad.status]).toEqual(["invalid", 400]);
			});

			test("credit: the owner, anyone while shared, nobody once private", async () => {
				const id = newId();
				await remote.save(id, input({ name: "Original" }));
				const { displayName } = await remote.getProfile();

				expect(await remote.credit(id)).toEqual({ name: "Original", displayName });
				expect((await refusal(signedOut.credit(id))).code).toBe("not_found");

				await remote.share(id);
				expect(await signedOut.credit(id)).toEqual({ name: "Original", displayName });

				await remote.unshare(id);
				const refused = await refusal(signedOut.credit(id));
				expect([refused.code, refused.status]).toEqual(["not_found", 404]);
				expect(await remote.credit(id)).toEqual({ name: "Original", displayName });

				expect((await refusal(signedOut.credit(newId()))).code).toBe("not_found");
			});

			test("the display name is trimmed, shown on the shared document, and cleared by empty", async () => {
				// The stack's account is shared between runs: put its name back afterwards.
				const before = (await remote.getProfile()).displayName;
				try {
					const id = newId();
					await remote.save(id, input());
					const token = await remote.share(id);

					expect(await remote.setProfile("  Ms. Rivera's class  ")).toEqual({
						displayName: "Ms. Rivera's class"
					});
					expect(await remote.getProfile()).toEqual({ displayName: "Ms. Rivera's class" });
					expect((await signedOut.shared(token)).displayName).toBe("Ms. Rivera's class");
					expect((await signedOut.credit(id)).displayName).toBe("Ms. Rivera's class");

					expect(await remote.setProfile("")).toEqual({ displayName: null });
					expect((await signedOut.shared(token)).displayName).toBeNull();
					expect(await remote.setProfile("   ")).toEqual({ displayName: null });
					await remote.setProfile("Again");
					expect(await remote.setProfile(null)).toEqual({ displayName: null });
					expect(await remote.getProfile()).toEqual({ displayName: null });
				} finally {
					await remote.setProfile(before);
				}
			});

			test("an unknown dashboard can't be shared or unshared", async () => {
				const missing = await refusal(remote.share(newId()));
				expect([missing.code, missing.status]).toEqual(["not_found", 404]);
				expect((await refusal(remote.unshare(newId()))).code).toBe("not_found");
			});
		});

		describe("recovery", () => {
			const TRASHED = "2026-11-02T00:00:00.000Z";

			test("the first save of the day keeps the version it replaces", async () => {
				const id = newId();
				const { version } = await remote.save(
					id,
					input({ name: "Before", body: { widgets: [1] } })
				);
				await remote.save(
					id,
					input({ baseVersion: version, name: "After", body: { widgets: [2] } })
				);

				const list = await remote.listSnapshots(id);
				expect(list).toHaveLength(1);
				expect(list[0]).toMatchObject({ version, schemaVersion: 1, reason: "daily" });
				expect(typeof list[0].createdAt).toBe("string");
				expect(list[0]).not.toHaveProperty("body");
				const snapshot = await remote.getSnapshot(id, list[0].id);
				expect(snapshot).toMatchObject({
					id: list[0].id,
					version,
					schemaVersion: 1,
					name: "Before",
					body: { widgets: [1] }
				});
				expect(typeof snapshot.createdAt).toBe("string");
			});

			test("a second save the same day keeps no more", async () => {
				const id = newId();
				const { version } = await remote.save(id, input());
				const second = await remote.save(
					id,
					input({ baseVersion: version, body: { widgets: [2] } })
				);
				await remote.save(id, input({ baseVersion: second.version, body: { widgets: [3] } }));
				expect(await remote.listSnapshots(id)).toHaveLength(1);
			});

			test("snapshots are listed newest first", async () => {
				const id = newId();
				const { version } = await remote.save(id, input());
				const second = await remote.save(
					id,
					input({ baseVersion: version, body: { widgets: [2] } })
				);
				await remote.save(
					id,
					input({ baseVersion: second.version, body: { widgets: [3] }, snapshot: "conflict" })
				);

				const list = await remote.listSnapshots(id);
				expect(list.map((s) => [s.version, s.reason])).toEqual([
					[second.version, "conflict"],
					[version, "daily"]
				]);
				expect(list[0].id).toBeGreaterThan(list[1].id);
			});

			test("getSnapshot of a missing snapshot is not_found", async () => {
				const id = newId();
				await remote.save(id, input());
				const error = await refusal(remote.getSnapshot(id, 2_000_000_000));
				expect([error.code, error.status]).toEqual(["not_found", 404]);
			});

			test("delete permanently purges a trashed document", async () => {
				const id = newId();
				await remote.save(id, input({ deletedAt: TRASHED }));
				const { cursor } = await remote.list();

				await remote.deletePermanently(id);

				expect((await refusal(remote.get(id))).code).toBe("gone");
				expect((await remote.list(cursor)).purged).toContain(id);
			});

			test("delete permanently refuses a live document", async () => {
				const id = newId();
				await remote.save(id, input());
				const error = await refusal(remote.deletePermanently(id));
				expect([error.code, error.status]).toEqual(["not_deleted", 409]);
				expect((await remote.get(id)).id).toBe(id);
			});

			test("delete permanently of a missing id is not_found", async () => {
				const error = await refusal(remote.deletePermanently(newId()));
				expect([error.code, error.status]).toEqual(["not_found", 404]);
			});

			test("snapshots and delete need sign-in", async () => {
				const id = newId();
				await remote.save(id, input());
				for (const call of [
					() => signedOut.listSnapshots(id),
					() => signedOut.getSnapshot(id, 1),
					() => signedOut.deletePermanently(id)
				]) {
					const error = await refusal(call());
					expect([error.code, error.status]).toEqual(["unauthorized", 401]);
				}
			});

			test("delete permanently ends a shared dashboard's link", async () => {
				const id = newId();
				const { version } = await remote.save(id, input());
				const token = await remote.share(id);
				await remote.save(id, input({ baseVersion: version, deletedAt: TRASHED }));

				await remote.deletePermanently(id);

				expect((await refusal(signedOut.shared(token))).code).toBe("not_found");
				expect((await refusal(signedOut.credit(id))).code).toBe("not_found");
			});
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

			test("a conflict snapshot doesn't count as the day's", async () => {
				const id = newId();
				const { version } = await remote.save(id, input());
				const second = await remote.save(
					id,
					input({ baseVersion: version, body: { widgets: [2] }, snapshot: "conflict" })
				);
				await remote.save(id, input({ baseVersion: second.version, body: { widgets: [3] } }));
				const list = await remote.listSnapshots(id);
				expect(list.map((s) => s.reason)).toEqual(["daily", "conflict"]);
			});

			test("delete permanently of someone else's dashboard is not_found", async () => {
				const id = newId();
				fake.ownerOf(id, "account-elsewhere");
				const error = await refusal(remote.deletePermanently(id));
				expect([error.code, error.status]).toEqual(["not_found", 404]);
				expect((await refusal(remote.listSnapshots(id))).code).toBe("not_found");
			});

			test("snapshot: conflict keeps the replaced version", async () => {
				const id = newId();
				const { version } = await remote.save(id, input({ body: { widgets: ["theirs"] } }));
				await remote.save(
					id,
					input({ baseVersion: version, body: { widgets: ["mine"] }, snapshot: "conflict" })
				);
				expect(fake.snapshots(id)).toMatchObject([
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
				expect(fake.snapshots(id)).toMatchObject([
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
				expect(fake.snapshots(id).filter((s) => s.reason === "conflict")).toHaveLength(2);
			});

			test("another account's dashboard can't be shared", async () => {
				const id = newId();
				fake.ownerOf(id, "account-elsewhere");
				const error = await refusal(remote.share(id));
				expect([error.code, error.status]).toEqual(["not_found", 404]);
				expect((await refusal(remote.unshare(id))).code).toBe("not_found");
			});

			test("a disabled link answers not_found", async () => {
				const id = newId();
				await remote.save(id, input());
				const token = await remote.share(id);
				fake.disableSharing(id);

				const shared = await refusal(signedOut.shared(token));
				expect([shared.code, shared.status]).toEqual(["not_found", 404]);
				expect((await refusal(signedOut.sharedChanges(token, 0))).code).toBe("not_found");
				expect((await refusal(signedOut.credit(id))).code).toBe("not_found");
				const share = await refusal(remote.share(id));
				expect([share.code, share.status]).toEqual(["sharing_blocked", 403]);
			});

			test("a blocked account can't share and its links stop", async () => {
				const id = newId();
				await remote.save(id, input());
				const token = await remote.share(id);
				const other = newId();
				await remote.save(other, input());
				fake.blockSharing(accountId);

				expect((await refusal(signedOut.shared(token))).code).toBe("not_found");
				const share = await refusal(remote.share(other));
				expect([share.code, share.status]).toEqual(["sharing_blocked", 403]);
				// Stopping a link still works.
				await remote.unshare(id);
				expect((await remote.get(id)).shareToken).toBeNull();
			});

			test("a display name over 60 characters is invalid", async () => {
				expect(await remote.setProfile(` ${"a".repeat(60)} `)).toEqual({
					displayName: "a".repeat(60)
				});
				const error = await refusal(remote.setProfile("a".repeat(61)));
				expect([error.code, error.status]).toEqual(["invalid", 400]);
				expect(await remote.getProfile()).toEqual({ displayName: "a".repeat(60) });
			});

			test("profile calls need sign-in", async () => {
				fake.signedInAs = null;
				for (const call of [() => remote.getProfile(), () => remote.setProfile("Name")]) {
					const error = await refusal(call());
					expect([error.code, error.status]).toEqual(["unauthorized", 401]);
				}
				for (const call of [() => remote.share("d"), () => remote.unshare("d")]) {
					expect((await refusal(call())).code).toBe("unauthorized");
				}
			});

			test("share and unshare are recorded and move updatedAt, not version", async () => {
				const id = newId();
				const saved = await remote.save(id, input());
				fake.requests.length = 0;
				const token = await remote.share(id);
				const shared = await remote.get(id);
				expect(shared.version).toBe(saved.version);
				expect(Date.parse(shared.updatedAt)).toBeGreaterThan(Date.parse(saved.updatedAt));
				await signedOut.shared(token);
				await signedOut.sharedChanges(token, 1);
				await signedOut.credit(id);
				await remote.getProfile();
				await remote.setProfile(null);
				await remote.unshare(id);
				const unshared = await remote.get(id);
				expect(Date.parse(unshared.updatedAt)).toBeGreaterThan(Date.parse(shared.updatedAt));
				expect(fake.requests).toEqual([
					`share ${id}`,
					`get ${id}`,
					`shared ${token}`,
					`sharedChanges ${token} 1`,
					`credit ${id}`,
					"getProfile",
					"setProfile",
					`unshare ${id}`,
					`get ${id}`
				]);
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
					() => remote.keepSnapshot(id, snapshotInput({ baseVersion: 1 })),
					() => remote.share(id),
					() => remote.unshare(id),
					() => signedOut.shared("token"),
					() => signedOut.sharedChanges("token", 0),
					() => signedOut.credit(id),
					() => remote.getProfile(),
					() => remote.setProfile(null)
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
