/**
 * An in-memory `RemoteDocuments` that behaves like sjvair.com's `documents/` endpoints
 * (`camp/api/v2/documents/`): the same refusal codes, statuses, and check order. For unit tests
 * and, later, Playwright, so it imports nothing from `$lib` at runtime.
 *
 * Not modelled: the snapshot storage cap.
 */
import type { RefusalCode } from "$lib/api/documents";
import {
	RemoteRefusal,
	RemoteUnavailable,
	type RemoteChange,
	type RemoteDocument,
	type RemoteDocuments,
	type RemoteMeta,
	type RemoteSnapshot,
	type RemoteSnapshotMeta,
	type SaveInput,
	type SharedRemoteDocument,
	type SnapshotInput,
	type SnapshotReason,
	type StaleBase
} from "./remote";

export type FakeRemote = RemoteDocuments & {
	/** Every call throws `RemoteUnavailable` while set. */
	offline: boolean;
	/** The signed-in account (`null`: signed out, every call is `unauthorized`). */
	signedInAs: string | null;
	blockedBuilds: Set<string>;
	/** Live (not trashed) documents per account; 50 like the server. */
	maxDocuments: number;
	/**
	 * One entry per call: `"list"`, `"list <since>"`, `"get <id>"`, `"changes <id> <since>"`,
	 * `"save <id>"`, `"keepSnapshot <id>"`, `"share <id>"`, `"unshare <id>"`, `"shared <token>"`,
	 * `"sharedChanges <token> <since>"`, `"credit <id>"`, `"getProfile"`, `"setProfile"`,
	 * `"listSnapshots <id>"`, `"getSnapshot <id> <n>"`, `"delete <id>"`.
	 */
	requests: string[];
	/**
	 * Fault injection: each call takes the first entry (in order, one per call) right after it is
	 * recorded in `requests`, and throws `RemoteRefusal` with that code and status instead of
	 * answering, e.g. `{ code: "unknown", status: 503 }` or `{ code: "rate_limited", status: 429 }`.
	 */
	refuseNext: Array<{ code: RefusalCode; status: number }>;
	/** Permanently deletes a document, as the trash purge or another device would. */
	purge(id: string): void;
	/** Makes `id` belong to another account (creating it there when missing). */
	ownerOf(id: string, accountId: string): void;
	/** The document's snapshots, oldest first (all of them, whatever their age). */
	snapshots(id: string): Array<StoredSnapshot>;
	/** Drops the document's whole change log, as if it were trimmed long ago. */
	trimLog(id: string): void;
	/** Staff turns sharing off for one document: its link stops opening and it can't share. */
	disableSharing(id: string): void;
	/** Staff blocks an account from sharing: its links stop opening and it can't share. */
	blockSharing(accountId: string): void;
};

export type FakeRemoteOptions = {
	accountId: string;
	/** Versions of change log kept per document (default 500, like the server). */
	logLimit?: number;
	/** Saves and kept snapshots per account per minute before `rate_limited` (default 120). */
	savesPerMinute?: number;
	now?: () => Date;
};

/** The server's limits (sjvair.com `DOCUMENTS_*` settings). */
const MAX_BODY = 1_000_000;
const MAX_CHANGES = 2_000_000;
const MAX_STORAGE = 25 * 1024 * 1024;
const CURSOR_OVERLAP_MS = 10_000;
/** `DocumentProfile.display_name`'s `max_length`. */
const MAX_DISPLAY_NAME = 60;
const RESERVED_IDS = new Set(["profile", "export", "shared"]);
/** `DOCUMENTS_SNAPSHOT_DAYS`: snapshots older than this are neither listed nor readable. */
const SNAPSHOT_DAYS = 30;
const DAY_MS = 86_400_000;
const ID = /^[A-Za-z0-9_-]{1,64}$/;

type StoredSnapshot = {
	id: number;
	version: number;
	schemaVersion: number;
	name: string | null;
	reason: SnapshotReason;
	body: unknown;
	createdAt: string;
};

type Stored = {
	owner: string;
	doc: RemoteDocument;
	size: number;
	/** The changes each version's save carried. */
	log: Map<number, Array<{ schemaVersion: number; change: unknown }>>;
	snapshots: StoredSnapshot[];
	/** Staff turned sharing off for this document. */
	sharingDisabled: boolean;
};

/** A copy as JSON would carry it (the wire never shares objects). */
function wire<T>(value: T): T {
	return value === undefined ? value : (JSON.parse(JSON.stringify(value)) as T);
}

/** A JSON value's size in characters, as the server counts it. */
function measure(value: unknown): number {
	return JSON.stringify(value).length;
}

function isInt(value: unknown): value is number {
	return typeof value === "number" && Number.isInteger(value);
}

function isObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFiniteJson(value: unknown): boolean {
	if (typeof value === "number") return Number.isFinite(value);
	if (Array.isArray(value)) return value.every(isFiniteJson);
	if (isObject(value)) return Object.values(value).every(isFiniteJson);
	return true;
}

function shortString(value: unknown, limit = 64): boolean {
	return typeof value === "string" && value.length <= limit;
}

function isMoment(value: unknown): boolean {
	return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

function refuse(code: RefusalCode, status: number, staleBase?: StaleBase): RemoteRefusal {
	return new RemoteRefusal(code, status, staleBase);
}

/** The `invalid` checks the server makes on a save or a kept snapshot (field names as sent). */
function invalidFields(id: string, fields: Record<string, boolean>): boolean {
	if (RESERVED_IDS.has(id) || !ID.test(id)) return true;
	return Object.values(fields).some((ok) => !ok);
}

function checkSave(id: string, input: SaveInput): boolean {
	return !invalidFields(id, {
		schema_version: isInt(input.schemaVersion) && input.schemaVersion >= 1,
		name: input.name === null || shortString(input.name, 100),
		body: isObject(input.body) && isFiniteJson(input.body),
		deleted_at: input.deletedAt === null || isMoment(input.deletedAt),
		copied_from: input.copiedFrom === null || shortString(input.copiedFrom),
		base_version:
			input.baseVersion === null || (isInt(input.baseVersion) && input.baseVersion >= 0),
		changes:
			Array.isArray(input.changes) &&
			input.changes.every(
				(c) => isInt(c.schemaVersion) && c.schemaVersion >= 1 && isObject(c.change)
			) &&
			isFiniteJson(input.changes.map((c) => c.change)),
		account_id: shortString(input.accountId),
		build_id: shortString(input.buildId),
		snapshot: input.snapshot === null || input.snapshot === "conflict"
	});
}

function checkSnapshot(id: string, input: SnapshotInput): boolean {
	return !invalidFields(id, {
		base_version: isInt(input.baseVersion) && input.baseVersion >= 0,
		schema_version: isInt(input.schemaVersion) && input.schemaVersion >= 1,
		name: input.name === null || shortString(input.name, 100),
		body: isObject(input.body) && isFiniteJson(input.body),
		account_id: shortString(input.accountId),
		build_id: shortString(input.buildId)
	});
}

const pacificDay = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles" });

/** The Pacific calendar day (`YYYY-MM-DD`) of an ISO moment. */
function dayOf(moment: string): string {
	return pacificDay.format(new Date(moment));
}

function meta(doc: RemoteDocument): RemoteMeta {
	const copy: Partial<RemoteDocument> = wire(doc);
	delete copy.body;
	return copy as RemoteMeta;
}

export function createFakeRemote(options: FakeRemoteOptions): FakeRemote {
	const logLimit = options.logLimit ?? 500;
	const savesPerMinute = options.savesPerMinute ?? 120;
	/** Saves counted per account and minute, like the server's cache counter. */
	const saveCounts = new Map<string, number>();
	const now = options.now ?? (() => new Date());
	const stored = new Map<string, Stored>();
	const purged = new Map<string, { owner: string; at: string }>();
	/** Display names per account (absent: none set). */
	const displayNames = new Map<string, string>();
	/** Accounts staff blocked from sharing. */
	const blockedSharers = new Set<string>();
	/** One counter for every snapshot's id, like the server's table. */
	let lastSnapshotId = 0;

	/** Keeps `entry`'s current content as a snapshot. */
	function keep(
		entry: Stored,
		reason: SnapshotReason,
		at: string,
		content: { version: number; schemaVersion: number; name: string | null; body: unknown }
	) {
		entry.snapshots.push({
			id: ++lastSnapshotId,
			version: content.version,
			schemaVersion: content.schemaVersion,
			name: content.name,
			reason,
			body: wire(content.body),
			createdAt: at
		});
	}

	/** The snapshots still kept (30 days), newest first. */
	function kept(entry: Stored): StoredSnapshot[] {
		const oldest = now().getTime() - SNAPSHOT_DAYS * DAY_MS;
		return entry.snapshots
			.filter((s) => Date.parse(s.createdAt) >= oldest)
			.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt) || b.id - a.id);
	}

	/** The signed-in account (or `null`), after the checks every call shares. */
	function open(request: string): string | null {
		fake.requests.push(request);
		const injected = fake.refuseNext.shift();
		if (injected) throw refuse(injected.code, injected.status);
		if (fake.offline) throw new RemoteUnavailable();
		return fake.signedInAs;
	}

	/** The signed-in account, after the checks every call shares; signed out is `unauthorized`. */
	function begin(request: string): string {
		const account = open(request);
		if (account === null) throw refuse("unauthorized", 401);
		return account;
	}

	/** The caller's document for share/unshare: anything else is `not_found` (never `gone`). */
	function mine(account: string, id: string): Stored {
		const entry = stored.get(id);
		if (!entry || entry.owner !== account) throw refuse("not_found", 404);
		return entry;
	}

	function sharingBlocked(entry: Stored): boolean {
		return entry.sharingDisabled || blockedSharers.has(entry.owner);
	}

	/** Whether a share link may open the document right now (the server's `shareable`). */
	function shareable(entry: Stored): boolean {
		return entry.doc.shareToken !== null && entry.doc.deletedAt === null && !sharingBlocked(entry);
	}

	/** The document behind a share link; any link that doesn't open is the same `not_found`. */
	function sharedEntry(token: string): Stored {
		const entry = [...stored.values()].find((s) => s.doc.shareToken === token);
		if (!entry || !shareable(entry)) throw refuse("not_found", 404);
		return entry;
	}

	function sharedDocument(entry: Stored): SharedRemoteDocument {
		const { id, kind, name, schemaVersion, version, body, updatedAt } = entry.doc;
		return wire({
			id,
			kind,
			name,
			schemaVersion,
			version,
			body,
			updatedAt,
			displayName: displayNames.get(entry.owner) ?? null
		});
	}

	/** The caller's document, or the refusal for one they can't open (`refuse_absent`). */
	function owned(account: string, id: string): Stored {
		const entry = stored.get(id);
		if (entry && entry.owner === account) return entry;
		if (purged.get(id)?.owner === account) throw refuse("gone", 410);
		throw refuse("not_found", 404);
	}

	/** Log entries after `base`, or `null` when the log doesn't reach back that far. */
	function changesSince(entry: Stored, base: number | null): RemoteChange[] | null {
		const current = entry.doc.version;
		if (base === null || base > current) return null;
		const out: RemoteChange[] = [];
		for (let version = base + 1; version <= current; version++) {
			const changes = entry.log.get(version);
			if (!changes) return null;
			for (const c of changes) out.push({ version, ...c });
		}
		return wire(out);
	}

	function stale(entry: Stored, base: number | null): RemoteRefusal {
		return refuse("stale_base", 409, {
			version: entry.doc.version,
			changes: changesSince(entry, base),
			document: wire(entry.doc)
		});
	}

	/** too_large, build_blocked, and account_mismatch, in the server's order. */
	function checkRequest(
		account: string,
		body: unknown,
		changes: unknown,
		input: { accountId: string; buildId: string }
	) {
		if (measure(body) > MAX_BODY || measure(changes) > MAX_CHANGES) {
			throw refuse("too_large", 413);
		}
		if (fake.blockedBuilds.has(input.buildId)) throw refuse("build_blocked", 409);
		if (input.accountId !== account) throw refuse("account_mismatch", 403);
		// Saves and kept snapshots share one counter; a refused call still counts, as on the server.
		const key = `${account} ${Math.floor(now().getTime() / 60_000)}`;
		const count = (saveCounts.get(key) ?? 0) + 1;
		saveCounts.set(key, count);
		if (count > savesPerMinute) throw refuse("rate_limited", 429);
	}

	function checkLimits(account: string, entry: Stored | undefined, input: SaveInput, size: number) {
		const mine = [...stored.values()].filter((s) => s.owner === account);
		const revives = entry === undefined || entry.doc.deletedAt !== null;
		if (input.deletedAt === null && revives) {
			const live = mine.filter((s) => s.doc.deletedAt === null).length;
			if (live >= fake.maxDocuments) throw refuse("limit_documents", 403);
		}
		const growth = size - (entry?.size ?? 0);
		if (growth <= 0) return;
		const total = mine.reduce((sum, s) => sum + s.size, 0);
		if (total + growth > MAX_STORAGE) throw refuse("limit_storage", 403);
	}

	const fake: FakeRemote = {
		offline: false,
		signedInAs: options.accountId,
		blockedBuilds: new Set(),
		maxDocuments: 50,
		requests: [],
		refuseNext: [],

		async list(since) {
			const account = begin(since === undefined ? "list" : `list ${since}`);
			const at = now();
			let from = -Infinity;
			if (since !== undefined) {
				from = Date.parse(since);
				if (Number.isNaN(from)) throw refuse("invalid", 400);
			}
			const documents = [...stored.values()]
				.filter((s) => s.owner === account && Date.parse(s.doc.updatedAt) >= from)
				.sort(
					(a, b) =>
						Date.parse(a.doc.createdAt) - Date.parse(b.doc.createdAt) ||
						a.doc.id.localeCompare(b.doc.id)
				)
				.map((s) => meta(s.doc));
			const gone =
				since === undefined
					? []
					: [...purged]
							.filter(([, p]) => p.owner === account && Date.parse(p.at) >= from)
							.map(([id]) => id);
			const cursor = new Date(at.getTime() - CURSOR_OVERLAP_MS).toISOString();
			return { documents, purged: gone, cursor };
		},

		async get(id) {
			const account = begin(`get ${id}`);
			return wire(owned(account, id).doc);
		},

		async changes(id, since) {
			const account = begin(`changes ${id} ${since}`);
			if (!isInt(since) || since < 0) throw refuse("invalid", 400);
			const entry = owned(account, id);
			const version = entry.doc.version;
			if (since === version) return { version };
			return { version, changes: changesSince(entry, since), document: wire(entry.doc) };
		},

		async save(id, rawInput) {
			const account = begin(`save ${id}`);
			const input = wire(rawInput);
			if (!checkSave(id, input)) throw refuse("invalid", 400);
			checkRequest(account, input.body, input.changes, input);

			const gone = purged.get(id);
			if (gone)
				throw refuse(
					gone.owner === account ? "gone" : "id_taken",
					gone.owner === account ? 410 : 409
				);
			let entry = stored.get(id);
			if (entry && entry.owner !== account) throw refuse("id_taken", 409);

			if (!entry) {
				if (input.baseVersion !== null) throw refuse("not_found", 404);
			} else {
				if (input.baseVersion === null || input.baseVersion !== entry.doc.version) {
					throw stale(entry, input.baseVersion);
				}
				if (input.schemaVersion < entry.doc.schemaVersion) {
					throw refuse("schema_downgrade", 409);
				}
			}

			const size = measure(input.body);
			checkLimits(account, entry, input, size);

			const at = now().toISOString();
			if (entry) {
				const today = dayOf(at);
				const reason: SnapshotReason | null =
					input.schemaVersion > entry.doc.schemaVersion
						? "schema"
						: input.snapshot === "conflict"
							? "conflict"
							: entry.snapshots.some((s) => s.reason !== "conflict" && dayOf(s.createdAt) === today)
								? null
								: "daily";
				if (reason) keep(entry, reason, at, entry.doc);
			} else {
				entry = {
					owner: account,
					doc: {
						id,
						kind: "dashboard",
						name: null,
						schemaVersion: input.schemaVersion,
						version: 0,
						body: null,
						deletedAt: null,
						copiedFrom: null,
						createdAt: at,
						updatedAt: at,
						shareToken: null
					},
					size: 0,
					log: new Map(),
					snapshots: [],
					sharingDisabled: false
				};
				stored.set(id, entry);
			}

			const version = entry.doc.version + 1;
			entry.doc = {
				...entry.doc,
				name: input.name,
				schemaVersion: input.schemaVersion,
				version,
				body: input.body,
				deletedAt: input.deletedAt === null ? null : new Date(input.deletedAt).toISOString(),
				copiedFrom: input.copiedFrom,
				updatedAt: at
			};
			entry.size = size;
			entry.log.set(version, input.changes);
			for (const v of entry.log.keys()) if (v <= version - logLimit) entry.log.delete(v);
			return { version, updatedAt: at };
		},

		async keepSnapshot(id, rawInput) {
			const account = begin(`keepSnapshot ${id}`);
			const input = wire(rawInput);
			if (!checkSnapshot(id, input)) throw refuse("invalid", 400);
			checkRequest(account, input.body, [], input);
			const entry = owned(account, id);
			if (input.baseVersion !== entry.doc.version) throw stale(entry, input.baseVersion);
			keep(entry, "conflict", now().toISOString(), {
				version: input.baseVersion,
				schemaVersion: input.schemaVersion,
				name: input.name,
				body: input.body
			});
		},

		async listSnapshots(id): Promise<RemoteSnapshotMeta[]> {
			const account = begin(`listSnapshots ${id}`);
			const entry = owned(account, id);
			return kept(entry).map((s) => ({
				id: s.id,
				version: s.version,
				schemaVersion: s.schemaVersion,
				reason: s.reason,
				createdAt: s.createdAt
			}));
		},

		async getSnapshot(id, snapshotId): Promise<RemoteSnapshot> {
			const account = begin(`getSnapshot ${id} ${snapshotId}`);
			const entry = owned(account, id);
			const found = kept(entry).find((s) => s.id === snapshotId);
			if (!found) throw refuse("not_found", 404);
			return wire({
				id: found.id,
				version: found.version,
				schemaVersion: found.schemaVersion,
				name: found.name,
				body: found.body,
				createdAt: found.createdAt
			});
		},

		async deletePermanently(id) {
			const account = begin(`delete ${id}`);
			const entry = owned(account, id);
			if (entry.doc.deletedAt === null) throw refuse("not_deleted", 409);
			fake.purge(id);
		},

		async share(id) {
			const account = begin(`share ${id}`);
			const entry = mine(account, id);
			if (entry.doc.deletedAt !== null) throw refuse("not_found", 404);
			if (sharingBlocked(entry)) throw refuse("sharing_blocked", 403);
			// Sharing isn't an edit: the version stays, and updatedAt moves so `list(since)` shows it.
			const shareToken = entry.doc.shareToken ?? crypto.randomUUID();
			entry.doc = { ...entry.doc, shareToken, updatedAt: now().toISOString() };
			return shareToken;
		},

		async unshare(id) {
			const account = begin(`unshare ${id}`);
			const entry = mine(account, id);
			// The token is dropped, so sharing again makes a new one.
			entry.doc = { ...entry.doc, shareToken: null, updatedAt: now().toISOString() };
		},

		async shared(token) {
			open(`shared ${token}`);
			return sharedDocument(sharedEntry(token));
		},

		async sharedChanges(token, since) {
			open(`sharedChanges ${token} ${since}`);
			// The link first, so a bad since never tells a known token from an unknown one.
			const entry = sharedEntry(token);
			if (!isInt(since) || since < 0) throw refuse("invalid", 400);
			const version = entry.doc.version;
			if (since === version) return { version };
			return { version, document: sharedDocument(entry) };
		},

		async credit(id) {
			const account = open(`credit ${id}`);
			const entry = stored.get(id);
			if (!entry || (entry.owner !== account && !shareable(entry))) {
				throw refuse("not_found", 404);
			}
			return { name: entry.doc.name, displayName: displayNames.get(entry.owner) ?? null };
		},

		async getProfile() {
			const account = begin("getProfile");
			return { displayName: displayNames.get(account) ?? null };
		},

		async setProfile(displayName) {
			const account = begin("setProfile");
			if (displayName !== null && typeof displayName !== "string") throw refuse("invalid", 400);
			const value = (displayName ?? "").trim() || null;
			if (value !== null && value.length > MAX_DISPLAY_NAME) throw refuse("invalid", 400);
			if (value === null) displayNames.delete(account);
			else displayNames.set(account, value);
			return { displayName: value };
		},

		purge(id) {
			const entry = stored.get(id);
			if (!entry) return;
			stored.delete(id);
			purged.set(id, { owner: entry.owner, at: now().toISOString() });
		},

		ownerOf(id, accountId) {
			const entry = stored.get(id);
			if (entry) {
				entry.owner = accountId;
				return;
			}
			const at = now().toISOString();
			stored.set(id, {
				owner: accountId,
				doc: {
					id,
					kind: "dashboard",
					name: null,
					schemaVersion: 1,
					version: 1,
					body: {},
					deletedAt: null,
					copiedFrom: null,
					createdAt: at,
					updatedAt: at,
					shareToken: null
				},
				size: 2,
				log: new Map([[1, []]]),
				snapshots: [],
				sharingDisabled: false
			});
		},

		snapshots(id) {
			return wire(stored.get(id)?.snapshots ?? []);
		},

		trimLog(id) {
			stored.get(id)?.log.clear();
		},

		disableSharing(id) {
			const entry = stored.get(id);
			if (entry) entry.sharingDisabled = true;
		},

		blockSharing(accountId) {
			blockedSharers.add(accountId);
		}
	};
	return fake;
}
