import type { IDBPDatabase } from "idb";
import {
	LOG_LIMIT,
	assertCommitPrecondition,
	docVersion,
	logCovers,
	trimFloor,
	type CommitResult,
	type KeptOriginal,
	type LogEntry,
	type Platform,
	type ResetAccess,
	type SpaceId
} from "../types";
import { getUserDetails } from "@sjvair/sdk/account/details";
import { createWebActivity } from "./activity";
import { createWebLocks } from "./locks";
import { createWebOnline } from "./online";
import { createWebClipboard } from "./clipboard";
import { createWebErrors, listenForCspViolations } from "./errors";
import { createWebFiles } from "./files";
import { createWebIdentity } from "./identity";
import { createWebPersistence } from "./persistence";
import { openWorkspaceDB, type OpenOptions, type WorkspaceDB } from "./db";
import { createWebJournal, createWebJournalSpaces } from "./journal";
import type { SyncRecord } from "$lib/sync/types";
import { createReopening } from "./reopen";
import { BUILD_ID } from "$lib/safety/build-id";

const logRange = (space: SpaceId, docId: string, from = 0) =>
	IDBKeyRange.bound([space, docId, from], [space, docId, Number.MAX_SAFE_INTEGER]);

function strip(row: LogEntry & { space: SpaceId }): LogEntry {
	const { docId, version, change, tabId, schemaVersion } = row;
	return { docId, version, change, tabId, schemaVersion };
}

function unwrapRecord(row: { space: SpaceId; id: string } & SyncRecord): SyncRecord {
	const { docId, serverVersion, syncedThrough, confirmedAt, inFlight, hold } = row;
	return { docId, serverVersion, syncedThrough, confirmedAt, inFlight, hold };
}

/** Every key in `space`: arrays sort after strings and numbers, so `[space, []]` ends it. */
const spaceRange = (space: SpaceId) => IDBKeyRange.bound([space], [space, []]);

const STORES = ["documents", "changeLog", "preferences", "originals", "syncQueue"] as const;

function unwrap(row: { space: SpaceId } & KeptOriginal): KeptOriginal {
	const { id, raw, keptAt, fromSchemaVersion } = row;
	return { id, raw, keptAt, fromSchemaVersion };
}

type Run = <T>(operation: (db: IDBPDatabase<WorkspaceDB>) => Promise<T>) => Promise<T>;

const KEY_PREFIX = "sjvair-workspace:";
const GENERATION_KEY = `${KEY_PREFIX}generation`;

/**
 * The generation lives in `localStorage` so every tab sees a reset. `clearAll` writes the new one
 * first, synchronously, so other tabs stop saving before the slower erasing finishes.
 */
function createWebReset(run: Run): ResetAccess {
	let fallback: string | undefined;
	return {
		generation() {
			try {
				let value = localStorage.getItem(GENERATION_KEY);
				if (value === null) {
					value = crypto.randomUUID();
					localStorage.setItem(GENERATION_KEY, value);
				}
				return value;
			} catch {
				return (fallback ??= crypto.randomUUID());
			}
		},
		async clearAll() {
			const next = crypto.randomUUID();
			fallback = next;
			try {
				localStorage.setItem(GENERATION_KEY, next);
			} catch {
				// Blocked storage: this tab still knows the new generation.
			}
			await run(async (db) => {
				const tx = db.transaction([...STORES], "readwrite");
				// Every promise is settled, so a failing transaction leaves no rejection unhandled.
				const results = await Promise.allSettled([
					...STORES.map(async (name) => tx.objectStore(name).clear()),
					tx.done
				]);
				const failed = results.find((r) => r.status === "rejected");
				if (failed) throw failed.reason;
			});
			try {
				const doomed: string[] = [];
				for (let i = 0; i < localStorage.length; i++) {
					const key = localStorage.key(i);
					if (key !== null && key.startsWith(KEY_PREFIX) && key !== GENERATION_KEY) {
						doomed.push(key);
					}
				}
				for (const key of doomed) localStorage.removeItem(key);
			} catch {
				// Blocked storage: there is nothing to remove.
			}
		}
	};
}

export async function createWebPlatform(options: OpenOptions = {}): Promise<Platform> {
	const connection = await createReopening((hooks) =>
		openWorkspaceDB({
			...options,
			onVersionChange() {
				// Another tab is upgrading: this connection closes and must stay closed.
				hooks.onVersionChange();
				options.onVersionChange?.();
			}
		})
	);
	const run: Run = connection.run;
	const journalSpaces = createWebJournalSpaces();
	const errors = createWebErrors({
		dsn: import.meta.env.VITE_SENTRY_DSN,
		release: BUILD_ID,
		dev: import.meta.env.DEV
	});
	listenForCspViolations(errors, document);
	const activity = createWebActivity();
	const online = createWebOnline(window, navigator);
	const identity = createWebIdentity({
		blockText: () => document.getElementById("sjvair-identity")?.textContent ?? null,
		cookie: () => document.cookie,
		fetchUser: (signal) => getUserDetails(undefined, { signal }),
		postLogout: (csrfToken) =>
			fetch("/account/logout/", {
				method: "POST",
				credentials: "same-origin",
				redirect: "manual",
				headers: { "X-CSRFToken": csrfToken }
			}),
		activity,
		online,
		errors,
		now: () => Date.now()
	});

	return {
		documents: {
			list: (space) =>
				run(async (db) => {
					const rows = await db.getAll(
						"documents",
						IDBKeyRange.bound([space, ""], [space, "\uffff"])
					);
					return rows.map((r) => r.doc);
				}),
			get: (space, id) => run(async (db) => (await db.get("documents", [space, id]))?.doc),
			commit: async (space, input): Promise<CommitResult> => {
				assertCommitPrecondition(input);
				return run(async (db) => {
					const tx = db.transaction(["documents", "changeLog", "syncQueue"], "readwrite");
					const docs = tx.objectStore("documents");
					const log = tx.objectStore("changeLog");
					const records = tx.objectStore("syncQueue");
					const existing = await docs.get([space, input.docId]);
					const current = existing ? docVersion(existing.doc) : 0;
					if (input.baseVersion === null ? existing : !existing || current !== input.baseVersion) {
						await tx.done;
						return { ok: false, currentVersion: current };
					}
					await docs.put({ space, id: input.docId, doc: input.doc });
					let record = input.sync;
					if (record) await records.put({ ...record, space, id: input.docId });
					else record = await records.get([space, input.docId]);
					for (const entry of input.entries) await log.put({ ...entry, space });
					const keys = await log.getAllKeys(logRange(space, input.docId));
					const floor = trimFloor(record);
					let drop = 0;
					while (drop < keys.length - LOG_LIMIT && keys[drop][2] <= floor) drop++;
					for (const k of keys.slice(0, drop)) await log.delete(k);
					await tx.done;
					return { ok: true };
				});
			},
			readLog: (space, docId, afterVersion) =>
				run(async (db) => {
					const tx = db.transaction("changeLog", "readonly");
					const [first] = await tx.store.getAllKeys(logRange(space, docId), 1);
					if (!logCovers(first?.[2], afterVersion)) return "trimmed" as const;
					const rows = await tx.store.getAll(logRange(space, docId, afterVersion + 1));
					return rows.map(strip);
				}),
			remove: (space, id) =>
				run(async (db) => {
					const tx = db.transaction(
						["documents", "changeLog", "originals", "syncQueue"],
						"readwrite"
					);
					await Promise.all([
						tx.objectStore("documents").delete([space, id]),
						tx.objectStore("changeLog").delete(logRange(space, id)),
						tx.objectStore("originals").delete([space, id]),
						tx.objectStore("syncQueue").delete([space, id]),
						tx.done
					]);
				})
		},
		sync: {
			get: (space, docId) =>
				run(async (db) => {
					const row = await db.get("syncQueue", [space, docId]);
					return row === undefined ? undefined : unwrapRecord(row);
				}),
			list: (space) =>
				run(async (db) => (await db.getAll("syncQueue", spaceRange(space))).map(unwrapRecord)),
			put: (space, record) =>
				run(async (db) => {
					await db.put("syncQueue", { ...record, space, id: record.docId });
				})
		},
		spaces: {
			list: async () => {
				const found = new Set<SpaceId>(
					await run(async (db) => {
						const spaces: SpaceId[] = [];
						const tx = db.transaction([...STORES], "readonly");
						for (const name of STORES) {
							let cursor = await tx.objectStore(name).openKeyCursor();
							while (cursor) {
								const space = cursor.key[0];
								spaces.push(space);
								// Skip the rest of this space.
								cursor = await cursor.continue([space, []] as unknown as typeof cursor.key);
							}
						}
						await tx.done;
						return spaces;
					})
				);
				for (const space of journalSpaces.list()) found.add(space);
				return [...found];
			},
			remove: async (space) => {
				await run(async (db) => {
					const tx = db.transaction([...STORES], "readwrite");
					await Promise.all([
						...STORES.map((name) => tx.objectStore(name).delete(spaceRange(space))),
						tx.done
					]);
				});
				journalSpaces.remove(space);
			},
			move: async (from, to, ids) => {
				if (from === to) return;
				await run(async (db) => {
					const tx = db.transaction(
						["documents", "changeLog", "originals", "syncQueue"],
						"readwrite"
					);
					const docs = tx.objectStore("documents");
					const log = tx.objectStore("changeLog");
					const originals = tx.objectStore("originals");
					const records = tx.objectStore("syncQueue");
					for (const id of ids) {
						const [doc, entries, original, record] = await Promise.all([
							docs.get([from, id]),
							log.getAll(logRange(from, id)),
							originals.get([from, id]),
							records.get([from, id])
						]);
						// Whatever `to` held under this id is replaced.
						await Promise.all([
							docs.delete([to, id]),
							log.delete(logRange(to, id)),
							originals.delete([to, id]),
							records.delete([to, id]),
							docs.delete([from, id]),
							log.delete(logRange(from, id)),
							originals.delete([from, id]),
							records.delete([from, id])
						]);
						if (doc) await docs.put({ ...doc, space: to });
						for (const entry of entries) await log.put({ ...entry, space: to });
						if (original) await originals.put({ ...original, space: to });
						if (record) await records.put({ ...record, space: to });
					}
					await tx.done;
				});
				journalSpaces.move(from, to, ids);
			}
		},
		originals: {
			get: (space, id) =>
				run(async (db) => {
					const row = await db.get("originals", [space, id]);
					return row === undefined ? undefined : unwrap(row);
				}),
			put: (space, original) =>
				run(async (db) => {
					await db.put("originals", { ...original, space });
				}),
			list: (space) =>
				run(async (db) => {
					const rows = await db.getAll(
						"originals",
						IDBKeyRange.bound([space, ""], [space, "\uffff"])
					);
					return rows.map(unwrap);
				}),
			remove: (space, id) =>
				run(async (db) => {
					await db.delete("originals", [space, id]);
				})
		},
		preferences: {
			get: <T>(space: SpaceId, key: string) =>
				run(async (db) => (await db.get("preferences", [space, key]))?.value as T | undefined),
			set: (space, key, value) =>
				run(async (db) => {
					await db.put("preferences", { space, key, value });
				})
		},
		journal: createWebJournal(),
		identity,
		activity,
		online,
		locks: createWebLocks(),
		clipboard: createWebClipboard(),
		files: createWebFiles(),
		persistence: createWebPersistence(),
		reset: createWebReset(run),
		errors
	};
}
