import { applyChange, appliedChange } from "$lib/changes/apply";
import { changesOverlap } from "$lib/changes/overlap";
import { applyForced, rebase } from "$lib/changes/rebase";
import type { Change } from "$lib/changes/types";
import { UndoStack } from "$lib/changes/undo";
import { loadDashboard } from "$lib/documents/load";
import { CURRENT_SCHEMA_VERSION, type Dashboard } from "$lib/documents/schema";
import type { CommitResult, LogEntry, Platform, SpaceId } from "$lib/platform/types";
import type { TabChannel, TabMessage } from "./tab-channel";

export type SaveStatus = "saved" | "saving" | "error";
export type Conflict = { pairs: Array<[Change, Change]> };
export type ReadOnly = false | "newer" | "invalid";
export type ConflictChoice = "keep-mine" | "use-other" | "save-copy";

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
};

type Listener = { target: EventTarget; type: string; fn: () => void };

/** What other tabs stored since this tab's version, read from storage. */
type StoredState = { stored: Dashboard; theirs: Change[] | null };

/**
 * One open dashboard. Every edit goes through `apply`/`undo`/`redo`: the document updates at
 * once, and the applied changes are committed (with their change-log entries) after
 * `debounceMs` of quiet, or on `pagehide` / the page becoming hidden.
 *
 * `doc.version` is always the stored version this tab's document is based on; `#pending`
 * holds the applied changes on top of it that aren't stored yet.
 *
 * Other tabs: after each save the session posts `committed` on its channel. When another tab
 * saved (a message, a refused commit, or the page becoming visible again) it catches up from
 * the change log: fast-forward, or replay its pending changes on top (`rebase`). A true
 * overlap sets `conflict` and pauses saving until `resolveConflict`.
 */
export class DocumentSession {
	// Raw: the document is replaced, never mutated, and must stay structured-cloneable.
	doc = $state.raw() as Dashboard;
	status = $state<SaveStatus>("saved");
	readOnly = $state<ReadOnly>(false);
	conflict = $state.raw<Conflict | null>(null);

	#canUndo = $state(false);
	#canRedo = $state(false);

	readonly #platform: Platform;
	readonly #space: SpaceId;
	readonly #tabId: string;
	readonly #debounceMs: number;
	readonly #now: () => Date;
	readonly #channel: TabChannel | null;
	#unsubscribe: () => void = () => {};
	#onBeforeFirstEdit: DocumentSessionOptions["onBeforeFirstEdit"];
	#handoff: Promise<DocumentSession | null> | null = null;
	#successor: DocumentSession | null = null;

	readonly #undoStack = new UndoStack();
	#pending: Change[] = [];
	#timer: ReturnType<typeof setTimeout> | null = null;
	#commits: Promise<void> = Promise.resolve();
	#listeners: Listener[] = [];

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
		if (this.#channel) this.#unsubscribe = this.#channel.subscribe((msg) => this.#onMessage(msg));

		if (typeof window !== "undefined") {
			this.#listen(window, "pagehide", () => void this.flush());
			// Restored from the back/forward cache: other tabs may have saved meanwhile.
			this.#listen(window, "pageshow", () => void this.#requestCatchUp());
		}
		if (typeof document !== "undefined") {
			const doc = document;
			this.#listen(doc, "visibilitychange", () => {
				if (doc.visibilityState === "hidden") void this.flush();
				else void this.#requestCatchUp();
			});
		}
	}

	/** Open a stored dashboard; `null` when `id` isn't stored. */
	static async open(
		platform: Platform,
		space: SpaceId,
		id: string,
		tabId: string,
		options: Pick<DocumentSessionOptions, "channel" | "debounceMs" | "now"> = {}
	): Promise<DocumentSession | null> {
		const raw = await platform.documents.get(space, id);
		if (raw === undefined) return null;
		const loaded = loadDashboard(raw);
		const common = { ...options, platform, space, tabId };
		if (loaded.status === "ok") return new DocumentSession({ ...common, doc: loaded.doc });
		// Read-only: shown as stored, never edited or saved.
		return new DocumentSession({ ...common, doc: raw as Dashboard, readOnly: loaded.reason });
	}

	get canUndo(): boolean {
		return this.#canUndo;
	}

	get canRedo(): boolean {
		return this.#canRedo;
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
		for (const { target, type, fn } of this.#listeners) target.removeEventListener(type, fn);
		this.#listeners = [];
		this.#unsubscribe();
		void this.flush();
	}

	/**
	 * Bring this tab up to the stored version, which another tab moved on. With no pending
	 * changes it fast-forwards; otherwise the pending changes are replayed on top of the stored
	 * document and committed, or a true overlap sets `conflict`. If the log no longer reaches
	 * back to this tab's version, the pending changes are replayed without overlap checks.
	 */
	protected async catchUp(): Promise<void> {
		const state = await this.#readStored();
		// From here on nothing awaits until the commit, so `#pending` is complete.
		if (!state) return this.#keepPending();
		const { stored, theirs } = state;
		const mine = this.#pending.slice();
		if (mine.length === 0) {
			this.conflict = null;
			this.doc = stored;
			this.status = "saved";
			return;
		}
		if (theirs !== null) {
			const result = rebase(stored, theirs, mine);
			if (result.kind === "conflict") {
				this.conflict = { pairs: result.pairs };
				this.#clearTimer();
				this.status = "error";
				return;
			}
			return this.#adopt(result.doc, result.changes);
		}
		const { doc, applied } = applyForced(stored, mine);
		return this.#adopt(doc, applied);
	}

	async #resolve(choice: ConflictChoice): Promise<string | null> {
		if (!this.conflict) return null;
		const state = await this.#readStored();
		if (!state) throw new Error(`Dashboard ${this.doc.id} can't be read`);
		const { stored } = state;
		const mine = this.#pending.slice();

		if (choice === "keep-mine") {
			// Their deletes of widgets I changed are undone, so my changes to them stand.
			const theirs = state.theirs ?? [];
			const restores = theirs.flatMap((t): Change[] =>
				t.op === "removeWidget" && mine.some((m) => changesOverlap(m, t))
					? [{ op: "addWidget", target: t.target, widget: t.widget, index: t.index }]
					: []
			);
			const { doc, applied } = applyForced(stored, [...restores, ...mine]);
			this.conflict = null;
			await this.#adopt(doc, applied);
			return null;
		}

		this.#undoStack.clear();
		this.#syncUndoState();
		if (choice === "use-other") {
			this.conflict = null;
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
		const created = await this.#platform.documents.commit(this.#space, {
			docId: copy.id,
			baseVersion: null,
			doc: copy,
			entries: []
		});
		if (!created.ok) throw new Error(`Dashboard ${copy.id} already exists`);
		this.conflict = null;
		// Edits made while the copy was saved go on top of the stored original.
		const later = applyForced(stored, this.#pending.slice(mine.length));
		await this.#adopt(later.doc, later.applied);
		return copy.id;
	}

	/** The stored document and, when the log still covers it, the changes since `doc.version`. */
	async #readStored(): Promise<StoredState | null> {
		const base = this.doc.version;
		const raw = await this.#platform.documents.get(this.#space, this.doc.id);
		if (raw === undefined) return null;
		const loaded = loadDashboard(raw);
		if (loaded.status !== "ok") return null;
		const stored = loaded.doc;
		const log = await this.#platform.documents.readLog(this.#space, stored.id, base);
		if (log === "trimmed") return { stored, theirs: null };
		// Entries past the stored version were saved after the read; the next catch-up gets them.
		const entries = log.filter((e) => e.version <= stored.version);
		const complete =
			entries.length === stored.version - base &&
			entries.every((e, i) => e.version === base + i + 1);
		return { stored, theirs: complete ? entries.map((e) => e.change) : null };
	}

	/** Show `doc` (based on the stored version) with `pending` on top of it, and save them. */
	async #adopt(doc: Dashboard, pending: Change[]): Promise<void> {
		this.doc = doc;
		this.#pending = pending;
		this.#clearTimer();
		if (pending.length === 0) this.status = "saved";
		else await this.#commitPending();
	}

	/** Storage couldn't be read (or holds something this tab can't load): keep everything. */
	#keepPending(): void {
		this.status = this.#pending.length > 0 ? "error" : "saved";
	}

	#onMessage(msg: TabMessage): void {
		if (msg.space !== this.#space || msg.docId !== this.doc.id || msg.tabId === this.#tabId) return;
		if (msg.version > this.doc.version) void this.#requestCatchUp();
	}

	#requestCatchUp(): Promise<unknown> {
		if (this.readOnly || this.#successor || this.#onBeforeFirstEdit) return Promise.resolve();
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

	#handOff(change: Change): void {
		if (!this.#handoff) {
			const hook = this.#onBeforeFirstEdit!;
			this.#onBeforeFirstEdit = undefined;
			this.#handoff = hook(change).then(
				(successor) => {
					this.#successor = successor;
					// Nobody took the edit: the next edit tries again.
					if (!successor) this.#resetHandoff(hook);
					return successor;
				},
				() => {
					this.#resetHandoff(hook);
					this.status = "error";
					return null;
				}
			);
			return;
		}
		// An edit made while the hook runs follows the first one.
		void this.#handoff.then((successor) => successor?.apply(change));
	}

	#resetHandoff(hook: NonNullable<DocumentSessionOptions["onBeforeFirstEdit"]>): void {
		this.#handoff = null;
		this.#onBeforeFirstEdit = hook;
	}

	async #commitPending(): Promise<void> {
		const batch = this.#pending.slice();
		if (batch.length === 0) return;
		if (this.conflict) {
			// Saving waits for the conflict to be resolved.
			this.status = "error";
			return;
		}
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
		} catch {
			// Keep the in-memory document and its pending changes; the next save retries.
			this.status = "error";
			return;
		}

		if (!result.ok) {
			await this.catchUp();
			return;
		}
		// Edits made during the commit stay pending on top of the new stored version.
		this.#pending = this.#pending.slice(batch.length);
		this.doc = { ...this.doc, version, updatedAt };
		this.status = this.#pending.length > 0 ? "saving" : "saved";
		this.#channel?.post({
			type: "committed",
			space: this.#space,
			docId: this.doc.id,
			version,
			tabId: this.#tabId
		});
	}

	#schedule(): void {
		this.#clearTimer();
		this.#timer = setTimeout(() => void this.flush(), this.#debounceMs);
	}

	#clearTimer(): void {
		if (this.#timer !== null) clearTimeout(this.#timer);
		this.#timer = null;
	}

	#syncUndoState(): void {
		this.#canUndo = this.#undoStack.canUndo;
		this.#canRedo = this.#undoStack.canRedo;
	}

	#listen(target: EventTarget, type: string, fn: () => void): void {
		target.addEventListener(type, fn);
		this.#listeners.push({ target, type, fn });
	}
}
