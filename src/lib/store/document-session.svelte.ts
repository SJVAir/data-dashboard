import { applyChange, appliedChange } from "$lib/changes/apply";
import { changesOverlap } from "$lib/changes/overlap";
import { applyForced, rebase } from "$lib/changes/rebase";
import type { Change } from "$lib/changes/types";
import { UndoStack } from "$lib/changes/undo";
import { loadDashboard, migrations, type Migration } from "$lib/documents/load";
import { upgradeChanges } from "$lib/documents/migrate-changes";
import { CURRENT_SCHEMA_VERSION, type Dashboard } from "$lib/documents/schema";
import type { CommitResult, LogEntry, Platform, SpaceId } from "$lib/platform/types";
import { report } from "$lib/safety/report";
import { JournalRecordSchema, LooseJournalRecordSchema, type JournalRecord } from "./journal";
import type { TabChannel, TabMessage } from "./tab-channel";

export type SaveStatus = "saved" | "saving" | "error";
export type Conflict = { pairs: Array<[Change, Change]> };
export type ReadOnly = false | "newer" | "invalid";
export type ConflictChoice = "keep-mine" | "use-other" | "save-copy";
/** Why the last save failed: storage full, or storage that couldn't be written at all. */
export type SaveErrorKind = "quota" | "unavailable";

/** Waits before retrying a failed save; the last one repeats until a save succeeds. */
export const RETRY_DELAYS_MS = [1_000, 2_000, 5_000, 15_000, 60_000];

export type DocumentSessionOptions = {
	platform: Platform;
	space: SpaceId;
	doc: Dashboard;
	readOnly?: ReadOnly;
	tabId: string;
	/** Tells other tabs about this tab's saves, and hears about theirs. */
	channel?: TabChannel;
	/** Autosave quiet period. */
	debounceMs?: number;
	now?: () => Date;
	/**
	 * Called with the first edit instead of applying it here (the starter dashboard, which is
	 * never stored). It returns the session that took the edit; later edits go there too.
	 */
	onBeforeFirstEdit?: (change: Change) => Promise<DocumentSession | null>;
	/**
	 * Storage holds a document or log entry from a newer format than this app knows (another
	 * tab runs a newer version). The session suspends itself right after.
	 */
	onNeedsReload?: () => void;
	/** This browser's data was cleared (by another tab) since the session started. */
	onCleared?: () => void;
	/** The migration chain for older stored documents and changes (tests inject one). */
	chain?: Migration[];
};

type Listener = { target: EventTarget; type: string; fn: (event: Event) => void };

/**
 * What other tabs stored since a version, read from storage. `entries` and `theirs` are `null`
 * when the log no longer reaches back that far.
 */
type StoredState = { stored: Dashboard; entries: LogEntry[] | null; theirs: Change[] | null };

/** A journal record whose changes may be in an older format (`changes` not yet validated). */
type ReadRecord = { baseVersion: number; changes: unknown[]; schemaVersion: number };

/**
 * Where an open conflict's "their" changes start: the version this tab's pending changes were
 * based on, and (for a replayed journal record) the tab whose own saves aren't "theirs".
 */
type ConflictBase = { version: number; ownTab: string | null };

/**
 * One open dashboard. Every edit goes through `apply`/`undo`/`redo`: the document updates at
 * once, and the applied changes are committed (with their change-log entries) after
 * `debounceMs` of quiet, or on `pagehide` / the app becoming hidden (`platform.activity`). A
 * save that throws is retried after `RETRY_DELAYS_MS`.
 *
 * `doc.version` is always the stored version this tab's document is based on; `#pending`
 * holds the applied changes on top of it that aren't stored yet.
 *
 * Other tabs: after each save the session posts `committed` on its channel. When another tab
 * saved (a message, a refused commit, or the app becoming visible again) it catches up from
 * the change log: fast-forward, or replay its pending changes on top (`rebase`). A true
 * overlap sets `conflict` and pauses saving until `resolveConflict`.
 *
 * Reloads and closes: IndexedDB writes started as the page goes away may never finish, so on
 * `pagehide` (or the app becoming hidden) the pending changes are also written synchronously
 * to `platform.journal`. `open` replays any journal records for the dashboard (as a catch-up
 * would), and a tab's record is cleared once its changes are stored.
 *
 * `suspend` (storage is about to go away) journals and stops saving; `discard` (storage was
 * cleared) drops everything without saving or journaling.
 *
 * Format changes: `open` keeps the stored original before a document is upgraded, and
 * upgrades older journal records and log entries before replaying them. Data from a newer
 * format suspends the session (`onNeedsReload`); a changed `platform.reset.generation()` (the
 * data was cleared) stops it (`onCleared`), checked before every write and every catch-up.
 */
export class DocumentSession {
	// Raw: the document is replaced, never mutated, and must stay structured-cloneable.
	doc = $state.raw() as Dashboard;
	status = $state<SaveStatus>("saved");
	readOnly = $state<ReadOnly>(false);
	conflict = $state.raw<Conflict | null>(null);
	/** Why the last save failed, until a save succeeds. */
	errorKind = $state<SaveErrorKind | null>(null);
	/** A kept original of this dashboard exists (from before a format upgrade). */
	hasOriginal = $state(false);
	/**
	 * Unsaved edits from before a format upgrade that couldn't be carried over at open. The page
	 * resets it to 0 once it has told the person.
	 */
	droppedEdits = $state(0);

	#canUndo = $state(false);
	#canRedo = $state(false);

	readonly #platform: Platform;
	readonly #space: SpaceId;
	readonly #tabId: string;
	readonly #debounceMs: number;
	readonly #now: () => Date;
	readonly #channel: TabChannel | null;
	readonly #chain: Migration[];
	/** `platform.reset.generation()` when the session started. */
	readonly #generation: string;
	readonly #onNeedsReload: (() => void) | undefined;
	readonly #onCleared: (() => void) | undefined;
	#conflictBase: ConflictBase | null = null;
	#unsubscribe: () => void = () => {};
	#stopActivity: () => void = () => {};
	#onBeforeFirstEdit: DocumentSessionOptions["onBeforeFirstEdit"];
	#handoff: Promise<DocumentSession | null> | null = null;
	#successor: DocumentSession | null = null;
	/**
	 * Edits not yet taken by a hand-off, oldest first: the first goes through the hook. Kept
	 * (and journaled) until a hand-off succeeds.
	 */
	#queued: Change[] = [];

	readonly #undoStack = new UndoStack();
	#pending: Change[] = [];
	#timer: ReturnType<typeof setTimeout> | null = null;
	#retryTimer: ReturnType<typeof setTimeout> | null = null;
	/** Failed saves in a row, which picks the next retry's delay. */
	#retries = 0;
	/** `dispose` ran: no more retries. */
	#closed = false;
	/** `suspend` or `discard` ran: nothing is stored or journaled any more. */
	#stopped = false;
	#commits: Promise<void> = Promise.resolve();
	#listeners: Listener[] = [];
	/** This tab wrote a journal record that may still hold changes. */
	#journaled = false;
	/** Other tabs' journal records whose changes are pending here, cleared once stored. */
	#replayed: string[] = [];

	constructor(opts: DocumentSessionOptions) {
		this.doc = opts.doc;
		this.readOnly = opts.readOnly ?? false;
		this.#platform = opts.platform;
		this.#space = opts.space;
		this.#tabId = opts.tabId;
		this.#debounceMs = opts.debounceMs ?? 500;
		// A timestamp source, not reactive state.
		// eslint-disable-next-line svelte/prefer-svelte-reactivity
		this.#now = opts.now ?? (() => new Date());
		this.#onBeforeFirstEdit = opts.onBeforeFirstEdit;
		this.#channel = opts.channel ?? null;
		this.#chain = opts.chain ?? migrations;
		this.#generation = opts.platform.reset.generation();
		this.#onNeedsReload = opts.onNeedsReload;
		this.#onCleared = opts.onCleared;
		if (this.#channel) this.#unsubscribe = this.#channel.subscribe((msg) => this.#onMessage(msg));

		if (typeof window !== "undefined") {
			this.#listen(window, "pagehide", () => {
				this.#writeJournal();
				void this.flush();
			});
			// Restored from the back/forward cache: save what's left (clearing the journal), and
			// catch up, since other tabs may have saved meanwhile.
			this.#listen(window, "pageshow", (event) => {
				if ((event as PageTransitionEvent).persisted) void this.flush();
				void this.#requestCatchUp();
			});
		}
		this.#stopActivity = this.#platform.activity.onChange((visible) => {
			// Mobile browsers may kill a hidden tab without `pagehide`.
			if (!visible) {
				this.#writeJournal();
				void this.flush();
			} else void this.#requestCatchUp();
		});
	}

	/**
	 * Open a stored dashboard; `null` when `id` isn't stored. A document stored in an older
	 * format is upgraded, after keeping the stored original (once per format it came from).
	 */
	static async open(
		platform: Platform,
		space: SpaceId,
		id: string,
		tabId: string,
		options: Pick<
			DocumentSessionOptions,
			"channel" | "debounceMs" | "now" | "onNeedsReload" | "onCleared" | "chain"
		> = {}
	): Promise<DocumentSession | null> {
		const raw = await platform.documents.get(space, id);
		if (raw === undefined) return null;
		const loaded = loadDashboard(raw, options.chain);
		const common = { ...options, platform, space, tabId };
		const fromVersion = schemaVersionOf(raw);
		let session: DocumentSession;
		let keptFailed = false;
		if (loaded.status === "ok" && loaded.upgraded && fromVersion !== null) {
			const kept = await platform.originals.get(space, id);
			if (kept?.fromSchemaVersion !== fromVersion) {
				// A timestamp, not reactive state.
				// eslint-disable-next-line svelte/prefer-svelte-reactivity
				const keptAt = (options.now?.() ?? new Date()).toISOString();
				try {
					await platform.originals.put(space, { id, raw, keptAt, fromSchemaVersion: fromVersion });
				} catch (error) {
					// Nothing is saved in the new format without the original kept: read-only.
					report(error, { docId: id, fromSchemaVersion: fromVersion });
					keptFailed = true;
				}
			}
		}
		if (loaded.status === "ok" && !keptFailed) {
			session = new DocumentSession({ ...common, doc: loaded.doc });
			await session.#replayJournal();
		} else if (loaded.status === "ok") {
			session = new DocumentSession({ ...common, doc: loaded.doc, readOnly: "invalid" });
		} else {
			if (fromVersion !== null && fromVersion < CURRENT_SCHEMA_VERSION) {
				report(new Error("A stored dashboard couldn't be upgraded"), {
					docId: id,
					fromSchemaVersion: fromVersion
				});
			}
			// Read-only: shown as stored, never edited or saved.
			session = new DocumentSession({ ...common, doc: raw as Dashboard, readOnly: loaded.reason });
		}
		const original = await platform.originals.get(space, id).catch(() => undefined);
		session.hasOriginal = original !== undefined;
		return session;
	}

	get canUndo(): boolean {
		return this.#canUndo;
	}

	get canRedo(): boolean {
		return this.#canRedo;
	}

	/** Applied changes aren't stored yet (a save is waiting, running, or failing). */
	get hasPending(): boolean {
		return this.#pending.length > 0;
	}

	/** The session this one's edits land in: itself, or the copy a starter handed off to. */
	get editTarget(): DocumentSession {
		return this.#successor?.editTarget ?? this;
	}

	apply(change: Change): void {
		if (this.readOnly) return;
		if (this.#successor) {
			this.#successor.apply(change);
			return;
		}
		if (this.#onBeforeFirstEdit || this.#handoff) {
			this.#handOff(change);
			return;
		}
		const result = applyChange(this.doc, change);
		this.#record(result.doc, appliedChange(result.inverse));
		this.#undoStack.push(appliedChange(result.inverse), result.inverse);
		this.#syncUndoState();
	}

	undo(): void {
		if (this.readOnly) return;
		const result = this.#undoStack.takeUndo(this.doc);
		if (result) this.#record(result.doc, result.change);
		this.#syncUndoState();
	}

	redo(): void {
		if (this.readOnly) return;
		const result = this.#undoStack.takeRedo(this.doc);
		if (result) this.#record(result.doc, result.change);
		this.#syncUndoState();
	}

	/** Commit pending changes now. Commits run one at a time, in order. */
	flush(): Promise<void> {
		this.#clearTimer();
		this.#clearRetry();
		void this.#enqueue(() => this.#commitPending());
		return this.#commits;
	}

	/**
	 * Settle `conflict`. "keep-mine" stores this tab's changes over the other version (keeping
	 * the other tab's changes that don't overlap); "use-other" drops them; "save-copy" stores
	 * this tab's document as a new dashboard (returning its id) and shows the stored original
	 * here. Resolves `null` except for "save-copy".
	 */
	resolveConflict(choice: ConflictChoice): Promise<string | null> {
		return this.#enqueue(() => this.#resolve(choice));
	}

	dispose(): void {
		this.#closed = true;
		this.#removeListeners();
		void this.flush();
	}

	/**
	 * Storage is about to go away (another tab upgraded it): journal the pending changes now,
	 * then store and journal nothing more. The page is expected to reload.
	 */
	suspend(): void {
		if (this.#stopped) return;
		this.#writeJournal();
		this.#stop();
	}

	/** Storage was cleared: drop the pending changes without saving or journaling them. */
	discard(): void {
		this.#stop();
		this.#removeListeners();
		this.#pending = [];
		this.#queued = [];
	}

	/**
	 * Hand off the edits a starter tab left in the journal (its page went away mid-hand-off),
	 * as if they were made here; changes that no longer apply to this document are skipped.
	 * For a session with `onBeforeFirstEdit`; otherwise nothing to do (`open` replays).
	 */
	replayPending(): Promise<void> {
		const handingOff = this.#onBeforeFirstEdit || this.#handoff;
		if (this.readOnly || this.#stopped || this.#successor || !handingOff) {
			return Promise.resolve();
		}
		const { journal } = this.#platform;
		const records = journal
			.readAll(this.#space, this.doc.id)
			.filter(({ tabId, record }) => {
				if (tabId === this.#tabId || this.#replayed.includes(tabId)) return false;
				return !isNewer(record);
			})
			.flatMap(({ tabId, record }) => {
				const parsed = readRecord(record);
				if (!parsed) {
					journal.clear(this.#space, this.doc.id, tabId);
					return [];
				}
				return [{ tabId, record: parsed }];
			})
			.sort((a, b) => a.record.writtenAt.localeCompare(b.record.writtenAt));
		if (records.length === 0) return Promise.resolve();
		let doc = this.doc;
		for (const change of this.#queued) doc = applyChange(doc, change).doc;
		for (const { tabId, record } of records) {
			this.#replayed.push(tabId);
			for (const change of this.#upgradeRecordChanges(record.changes, record.schemaVersion)) {
				try {
					doc = applyChange(doc, change).doc;
					this.#queued.push(change);
				} catch {
					// Two starter tabs' records may not both apply; the first one's change stands.
				}
			}
		}
		if (this.#queued.length > 0 && !this.#handoff) this.#startHandoff();
		return this.#handoff?.then(() => {}) ?? Promise.resolve();
	}

	/**
	 * Bring this tab up to the stored version, which another tab moved on. With no pending
	 * changes it fast-forwards; otherwise the pending changes are replayed on top of the stored
	 * document and committed, or a true overlap sets `conflict`. If the log no longer reaches
	 * back to this tab's version, the pending changes are replayed without overlap checks.
	 */
	protected async catchUp(): Promise<void> {
		// During a conflict, from its base: the changes that caused it must be found again.
		const conflictBase = this.#conflictBase;
		const state = await this.#readStored(conflictBase?.version);
		// From here on nothing awaits until the commit, so `#pending` is complete.
		if (!state) return this.#keepPending();
		const { stored, entries } = state;
		const theirs =
			conflictBase && entries ? this.#theirChanges(entries, conflictBase.ownTab) : state.theirs;
		const mine = this.#pending.slice();
		if (mine.length === 0) {
			this.#settleConflict();
			this.doc = stored;
			this.status = "saved";
			this.errorKind = null;
			this.#settleJournal();
			return;
		}
		if (theirs !== null) {
			const result = rebase(stored, theirs, mine);
			if (result.kind === "conflict") {
				this.#conflictBase ??= { version: this.doc.version, ownTab: null };
				this.conflict = { pairs: result.pairs };
				this.#clearTimer();
				this.status = "error";
				return;
			}
			return this.#adopt(result.doc, result.changes);
		}
		// No telling what overlapped any more, so an open conflict no longer stands.
		this.#settleConflict();
		const { doc, applied } = applyForced(stored, mine);
		return this.#adopt(doc, applied);
	}

	async #resolve(choice: ConflictChoice): Promise<string | null> {
		if (!this.conflict) return null;
		const base = this.#conflictBase ?? { version: this.doc.version, ownTab: null };
		const state = await this.#readStored(base.version);
		if (!state) throw new Error(`Dashboard ${this.doc.id} can't be read`);
		const { stored } = state;
		const mine = this.#pending.slice();

		if (choice === "keep-mine") {
			// Their deletes of widgets I changed are undone, so my changes to them stand.
			const theirs = this.#theirChanges(state.entries ?? [], base.ownTab);
			const restores = theirs.flatMap((t): Change[] =>
				t.op === "removeWidget" && mine.some((m) => changesOverlap(m, t))
					? [{ op: "addWidget", target: t.target, widget: t.widget, index: t.index }]
					: []
			);
			const { doc, applied } = applyForced(stored, [...restores, ...mine]);
			this.#settleConflict();
			await this.#adopt(doc, applied);
			return null;
		}

		this.#undoStack.clear();
		this.#syncUndoState();
		if (choice === "use-other") {
			this.#settleConflict();
			await this.#adopt(stored, []);
			return null;
		}

		const now = this.#now().toISOString();
		const copy: Dashboard = {
			...this.doc,
			id: crypto.randomUUID(),
			copiedFrom: this.doc.id,
			version: 0,
			createdAt: now,
			updatedAt: now
		};
		if (this.#dataCleared()) return null;
		const created = await this.#platform.documents.commit(this.#space, {
			docId: copy.id,
			baseVersion: null,
			doc: copy,
			entries: []
		});
		if (!created.ok) throw new Error(`Dashboard ${copy.id} already exists`);
		this.#settleConflict();
		// Edits made while the copy was saved go on top of the stored original.
		const later = applyForced(stored, this.#pending.slice(mine.length));
		await this.#adopt(later.doc, later.applied);
		return copy.id;
	}

	/**
	 * The stored document and, when the log still covers it, the changes since `base` (older
	 * entries upgraded; ones that can't be carried over left out of `theirs`). `null` when it
	 * can't be loaded, or comes from a newer format (which suspends the session).
	 */
	async #readStored(base = this.doc.version): Promise<StoredState | null> {
		const raw = await this.#platform.documents.get(this.#space, this.doc.id);
		if (raw === undefined) return null;
		if (isNewer(raw)) return this.#needsReload();
		const loaded = loadDashboard(raw, this.#chain);
		if (loaded.status !== "ok") return null;
		const stored = loaded.doc;
		const log = await this.#platform.documents.readLog(this.#space, stored.id, base);
		if (log === "trimmed") return { stored, entries: null, theirs: null };
		// Entries past the stored version were saved after the read; the next catch-up gets them.
		const entries = log.filter((e) => e.version <= stored.version);
		if (entries.some(isNewer)) return this.#needsReload();
		const complete =
			entries.length === stored.version - base &&
			entries.every((e, i) => e.version === base + i + 1);
		if (!complete) return { stored, entries: null, theirs: null };
		return { stored, entries, theirs: this.#theirChanges(entries, null) };
	}

	/** The changes in `entries` not saved by `ownTab`, upgraded to the current format. */
	#theirChanges(entries: LogEntry[], ownTab: string | null): Change[] {
		return entries
			.filter((e) => e.tabId !== ownTab)
			.flatMap((e) =>
				e.schemaVersion < CURRENT_SCHEMA_VERSION
					? upgradeChanges([e.change], e.schemaVersion, this.#chain).changes
					: [e.change]
			);
	}

	/** Upgrade a journal record's changes, counting the ones that can't be carried over. */
	#upgradeRecordChanges(changes: unknown[], fromVersion: number): Change[] {
		if (fromVersion === CURRENT_SCHEMA_VERSION) return changes as Change[];
		const upgraded = upgradeChanges(changes, fromVersion, this.#chain);
		this.droppedEdits += upgraded.dropped;
		return upgraded.changes;
	}

	/** Storage holds data from a newer format: ask for a reload and stop saving. */
	#needsReload(): null {
		if (!this.#stopped) this.#onNeedsReload?.();
		this.suspend();
		return null;
	}

	/**
	 * This browser's data was cleared since the session started: stop saving (and journaling),
	 * and say so once. Checked before every write.
	 */
	#dataCleared(): boolean {
		if (this.#platform.reset.generation() === this.#generation) return false;
		if (!this.#stopped) {
			this.#stop();
			this.#onCleared?.();
		}
		return true;
	}

	#settleConflict(): void {
		this.conflict = null;
		this.#conflictBase = null;
	}

	/** Show `doc` (based on the stored version) with `pending` on top of it, and save them. */
	async #adopt(doc: Dashboard, pending: Change[]): Promise<void> {
		this.doc = doc;
		this.#pending = pending;
		this.#clearTimer();
		if (pending.length === 0) {
			this.status = "saved";
			this.errorKind = null;
			this.#settleJournal();
		} else await this.#commitPending();
	}

	/** Storage couldn't be read (or holds something this tab can't load): keep everything. */
	#keepPending(): void {
		this.status = this.#pending.length > 0 ? "error" : "saved";
	}

	#onMessage(msg: TabMessage): void {
		if (msg.type !== "committed") return;
		if (msg.space !== this.#space || msg.docId !== this.doc.id || msg.tabId === this.#tabId) return;
		if (msg.version > this.doc.version) void this.#requestCatchUp();
	}

	#requestCatchUp(): Promise<unknown> {
		// A tab that missed the "cleared" message mustn't keep showing what was cleared, even
		// with nothing to save (on a shared computer).
		if (this.#stopped || this.#successor || this.#dataCleared()) return Promise.resolve();
		const handingOff = this.#onBeforeFirstEdit || this.#handoff;
		if (this.readOnly || handingOff) return Promise.resolve();
		return this.#enqueue(() => this.catchUp());
	}

	/**
	 * Run `task` after every earlier commit, catch-up, and resolution. The returned promise
	 * rejects if `task` fails, but the chain never does: later saves must still run.
	 */
	#enqueue<T>(task: () => Promise<T>): Promise<T> {
		const result = this.#commits.then(task);
		this.#commits = result.then(
			() => {},
			() => {
				this.status = "error";
			}
		);
		return result;
	}

	#record(doc: Dashboard, applied: Change): void {
		this.doc = doc;
		this.#pending.push(applied);
		this.status = "saving";
		this.#schedule();
	}

	/** Edits made while the hook runs (or after it failed) wait their turn in `#queued`. */
	#handOff(change: Change): void {
		this.#queued.push(change);
		if (!this.#handoff) this.#startHandoff();
	}

	/** Offer the oldest queued edit to the hook; the rest follow it to the session it returns. */
	#startHandoff(): void {
		const hook = this.#onBeforeFirstEdit!;
		this.#onBeforeFirstEdit = undefined;
		const reset = () => {
			// Nobody took the edits: they stay queued, and the next edit tries again.
			this.#handoff = null;
			this.#onBeforeFirstEdit = hook;
		};
		this.#handoff = hook(this.#queued[0]).then(
			(successor) => {
				if (!successor) {
					reset();
					return null;
				}
				// Taken all at once, so they reach the successor before any edit made on it.
				const rest = this.#queued.slice(1);
				this.#queued = [];
				this.#successor = successor;
				this.status = "saved";
				this.#settleJournal();
				for (const change of rest) successor.apply(change);
				// Suspended during the hand-off: the copy must not save either.
				if (this.#stopped) successor.suspend();
				return successor;
			},
			() => {
				reset();
				this.status = "error";
				return null;
			}
		);
	}

	async #commitPending(): Promise<void> {
		const batch = this.#pending.slice();
		if (batch.length === 0 || this.#stopped) return;
		if (this.conflict) {
			// Saving waits for the conflict to be resolved.
			this.status = "error";
			return;
		}
		if (this.#dataCleared()) return;
		const base = this.doc.version;
		const version = base + batch.length;
		const updatedAt = this.#now().toISOString();
		const entries: LogEntry[] = batch.map((change, i) => ({
			docId: this.doc.id,
			version: base + i + 1,
			change,
			tabId: this.#tabId,
			schemaVersion: CURRENT_SCHEMA_VERSION
		}));
		this.status = "saving";

		let result: CommitResult;
		try {
			result = await this.#platform.documents.commit(this.#space, {
				docId: this.doc.id,
				baseVersion: base,
				doc: { ...this.doc, version, updatedAt },
				entries
			});
		} catch (error) {
			// Keep the in-memory document and its pending changes, and try again later.
			this.status = "error";
			this.errorKind =
				(error as { name?: unknown } | null)?.name === "QuotaExceededError"
					? "quota"
					: "unavailable";
			this.#scheduleRetry();
			return;
		}
		this.#retries = 0;
		this.errorKind = null;

		if (!result.ok) {
			try {
				await this.catchUp();
			} catch {
				// Storage couldn't be read to catch up: keep everything and try again later.
				this.status = "error";
				this.errorKind = "unavailable";
				this.#scheduleRetry();
			}
			return;
		}
		// Edits made during the commit stay pending on top of the new stored version.
		this.#pending = this.#pending.slice(batch.length);
		this.doc = { ...this.doc, version, updatedAt };
		this.status = this.#pending.length > 0 ? "saving" : "saved";
		this.#settleJournal();
		this.#channel?.post({
			type: "committed",
			space: this.#space,
			docId: this.doc.id,
			version,
			tabId: this.#tabId
		});
	}

	/**
	 * Synchronously record the pending changes (or, on a starter, the edits waiting for a
	 * hand-off), for a page that may be torn down next.
	 */
	#writeJournal(): void {
		// Only one of the two is ever non-empty: a session that hands off applies nothing itself.
		const changes = [...this.#queued, ...this.#pending];
		if (this.readOnly || this.#stopped || this.#successor || changes.length === 0) return;
		if (this.#dataCleared()) return;
		const record: JournalRecord = {
			baseVersion: this.doc.version,
			changes,
			schemaVersion: CURRENT_SCHEMA_VERSION,
			writtenAt: this.#now().toISOString()
		};
		this.#platform.journal.write(this.#space, this.doc.id, this.#tabId, record);
		this.#journaled = true;
	}

	/**
	 * After a save (or with nothing left to save): clear the replayed records, and this tab's
	 * own record, or rewrite it with what's still pending.
	 */
	#settleJournal(): void {
		// A suspended session's journal must outlive it; a replay skips what was stored.
		if (this.#stopped) return;
		const { journal } = this.#platform;
		for (const tabId of this.#replayed) journal.clear(this.#space, this.doc.id, tabId);
		this.#replayed = [];
		if (!this.#journaled) return;
		this.#journaled = false;
		journal.clear(this.#space, this.doc.id, this.#tabId);
		this.#writeJournal();
	}

	/**
	 * Replay the journal records left for this dashboard by tabs that went away: each is caught
	 * up like pending changes (stored if clean, the conflict prompt on an overlap). Invalid
	 * records are discarded, and a record whose changes are already in the log is skipped. A
	 * record from a newer schema is left for a newer version of the app to replay.
	 */
	#replayJournal(): Promise<void> {
		return this.#enqueue(async () => {
			const { journal } = this.#platform;
			for (const { tabId, record } of journal.readAll(this.#space, this.doc.id)) {
				if (tabId === this.#tabId || this.conflict || isNewer(record)) continue;
				const parsed = readRecord(record);
				if (!parsed) {
					journal.clear(this.#space, this.doc.id, tabId);
					continue;
				}
				await this.#replayRecord(tabId, parsed);
			}
		});
	}

	async #replayRecord(tabId: string, record: ReadRecord): Promise<void> {
		const { baseVersion, changes } = record;
		const state = await this.#readStored(baseVersion);
		if (!state) return;
		const { stored, entries } = state;
		const clear = () => this.#platform.journal.clear(this.#space, this.doc.id, tabId);
		if (baseVersion > stored.version) return clear();
		// The log no longer reaches back to the record's base, so there's no telling which of its
		// changes were stored before the page went away; replaying them blind could apply them
		// twice, or over newer edits without a prompt. Discarded (a rare loss: 500 saves since).
		if (entries === null) return clear();
		// The tab's own saves that finished (the page lived long enough) are the start of the
		// record; only the rest is replayed, against what other tabs stored.
		const saved = entries.filter((e) => e.tabId === tabId).length;
		// Upgraded after the cut: the saved part is counted in the record's own format.
		const mine = this.#upgradeRecordChanges(changes.slice(saved), record.schemaVersion);
		if (mine.length === 0) return clear();
		const theirs = this.#theirChanges(entries, tabId);

		this.#replayed.push(tabId);
		const result = rebase(stored, theirs, mine);
		if (result.kind === "conflict") {
			// Shown with the replayed changes on top, as a tab with unsaved edits would be. They
			// stay pending as written (not as forced onto the stored document, which drops changes
			// to widgets the other side deleted), so "keep mine" can still apply them.
			this.doc = applyForced(stored, mine).doc;
			this.#pending = mine;
			// "Keep mine" reads their changes from the record's base, not this tab's.
			this.#conflictBase = { version: baseVersion, ownTab: tabId };
			this.conflict = { pairs: result.pairs };
			this.status = "error";
			return;
		}
		return this.#adopt(result.doc, result.changes);
	}

	#schedule(): void {
		this.#clearTimer();
		this.#timer = setTimeout(() => void this.flush(), this.#debounceMs);
	}

	#clearTimer(): void {
		if (this.#timer !== null) clearTimeout(this.#timer);
		this.#timer = null;
	}

	#scheduleRetry(): void {
		this.#clearRetry();
		if (this.#closed || this.#stopped) return;
		const delay = RETRY_DELAYS_MS[Math.min(this.#retries, RETRY_DELAYS_MS.length - 1)];
		this.#retries++;
		this.#retryTimer = setTimeout(() => void this.flush(), delay);
	}

	#clearRetry(): void {
		if (this.#retryTimer !== null) clearTimeout(this.#retryTimer);
		this.#retryTimer = null;
	}

	#stop(): void {
		this.#stopped = true;
		this.#clearTimer();
		this.#clearRetry();
	}

	#removeListeners(): void {
		for (const { target, type, fn } of this.#listeners) target.removeEventListener(type, fn);
		this.#listeners = [];
		this.#unsubscribe();
		this.#stopActivity();
	}

	#syncUndoState(): void {
		this.#canUndo = this.#undoStack.canUndo;
		this.#canRedo = this.#undoStack.canRedo;
	}

	#listen(target: EventTarget, type: string, fn: (event: Event) => void): void {
		target.addEventListener(type, fn);
		this.#listeners.push({ target, type, fn });
	}
}

/** The format a stored value (document, log entry, or journal record) was written in. */
function schemaVersionOf(value: unknown): number | null {
	if (typeof value !== "object" || value === null || !("schemaVersion" in value)) return null;
	const { schemaVersion } = value;
	return typeof schemaVersion === "number" ? schemaVersion : null;
}

/** Written by a newer version of the app, which this one can't load or replay. */
function isNewer(value: unknown): boolean {
	return (schemaVersionOf(value) ?? 0) > CURRENT_SCHEMA_VERSION;
}

/**
 * A journal record in the current format (validated), or an older one (its changes validated
 * once upgraded); `null` when it's neither.
 */
function readRecord(record: unknown): (ReadRecord & { writtenAt: string }) | null {
	const current = JournalRecordSchema.safeParse(record);
	if (current.success) return current.data;
	const older = LooseJournalRecordSchema.safeParse(record);
	if (!older.success || older.data.schemaVersion === CURRENT_SCHEMA_VERSION) return null;
	return older.data;
}
