import { applyChange, appliedChange } from "$lib/changes/apply";
import type { Change } from "$lib/changes/types";
import { UndoStack } from "$lib/changes/undo";
import { loadDashboard } from "$lib/documents/load";
import { CURRENT_SCHEMA_VERSION, type Dashboard } from "$lib/documents/schema";
import type { CommitResult, LogEntry, Platform, SpaceId } from "$lib/platform/types";

export type SaveStatus = "saved" | "saving" | "error";
export type Conflict = { pairs: Array<[Change, Change]> };
export type ReadOnly = false | "newer" | "invalid";

export type DocumentSessionOptions = {
	platform: Platform;
	space: SpaceId;
	doc: Dashboard;
	readOnly?: ReadOnly;
	tabId: string;
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

/**
 * One open dashboard. Every edit goes through `apply`/`undo`/`redo`: the document updates at
 * once, and the applied changes are committed (with their change-log entries) after
 * `debounceMs` of quiet, or on `pagehide` / the page becoming hidden.
 *
 * `doc.version` is always the stored version this tab's document is based on; `#pending`
 * holds the applied changes on top of it that aren't stored yet.
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

		if (typeof window !== "undefined") {
			this.#listen(window, "pagehide", () => void this.flush());
		}
		if (typeof document !== "undefined") {
			const doc = document;
			this.#listen(doc, "visibilitychange", () => {
				if (doc.visibilityState === "hidden") void this.flush();
			});
		}
	}

	/** Open a stored dashboard; `null` when `id` isn't stored. */
	static async open(
		platform: Platform,
		space: SpaceId,
		id: string,
		tabId: string,
		options: Pick<DocumentSessionOptions, "debounceMs" | "now"> = {}
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
		this.#commits = this.#commits.then(() => this.#commitPending());
		return this.#commits;
	}

	dispose(): void {
		for (const { target, type, fn } of this.#listeners) target.removeEventListener(type, fn);
		this.#listeners = [];
		void this.flush();
	}

	/**
	 * Bring this tab up to the stored version after a refused commit. Cross-tab sync fills
	 * this in; until then pending changes simply stay pending.
	 */
	protected async catchUp(): Promise<void> {}

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
