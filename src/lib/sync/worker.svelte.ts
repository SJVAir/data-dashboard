/**
 * The sync worker of one tab: uploads this tab's commits (at most one save per document every
 * 2 s, at once when the tab is hidden, retried with backoff and on `online`), and polls the
 * server from one visible tab per browser (the holder of a Web Lock it gives up when hidden).
 *
 * `ctx.channel` must be the app's echoing channel (`withLocalEcho`): the worker hears this
 * tab's own `committed` messages through it, and sessions in this tab hear the worker's.
 */
import { report } from "$lib/safety/report";
import { RETRY_DELAYS_MS } from "$lib/store/document-session.svelte";
import type { TabMessage } from "$lib/store/tab-channel";
import type { SyncContext } from "./context";
import { emptyRecord, readLocal } from "./local";
import { finishMoves } from "./move";
import { pointsHeld } from "./points";
import { fetchMissing, pollList } from "./pull";
import {
	RemoteRefusal,
	RemoteUnavailable,
	type RemoteDocuments,
	type RemoteSnapshot,
	type RemoteSnapshotMeta
} from "./remote";
import { resolveHold, type RemoteChoice } from "./resolve";
import { shareDocument, unshareDocument, type ShareOptions, type ShareResult } from "./share";
import { SYNC_TAB, type SyncHold } from "./types";
import { deletePermanently, type DeleteResult } from "./trash";
import { uploadDocument, type UploadResult } from "./upload";
import { keepBeforeRestore, serverVersion, serverVersions } from "./versions";

export type DocSyncState = {
	state: "synced" | "pending" | "held";
	hold: SyncHold | null;
	confirmedAt: string | null;
	onServer: boolean;
	/** The share link's token while it's on, else `null`. */
	shareToken: string | null;
	/** The owner chose "Share my exact location" for that link. */
	shareExact: boolean;
};

/** At most one save per document this often while editing. */
export const SAVE_INTERVAL_MS = 2_000;
/** The poller lists changes this often while its tab is visible. */
export const POLL_INTERVAL_MS = 60_000;

const pollLock = (space: string) => `sjvair-sync-poll:${space}`;

type Scheduled = { timer: ReturnType<typeof setTimeout>; due: number };

export class SyncWorker {
	/** Each stored document's standing, refreshed on `sync` and `committed` messages. */
	states = $state.raw<Record<string, DocSyncState>>({});
	/** The last request couldn't reach the server (or the platform says it's offline). */
	offline = $state(false);
	/** The server refused this build: no uploads until a reload (`ctx.onBlocked` is told). */
	blocked = $state(false);
	/** A save found the space's account no longer signed in: no more uploads. */
	signedOut = $state(false);
	/** Whether this tab is the browser's poller (holds the poll lock). */
	polling = $state(false);

	readonly #ctx: SyncContext;
	readonly #controller: AbortController;
	#stopped = false;
	#listeners: Array<() => void> = [];
	// Bookkeeping, not reactive state.
	/* eslint-disable svelte/prefer-svelte-reactivity */
	#scheduled = new Map<string, Scheduled>();
	#running = new Map<string, Promise<void>>();
	#again = new Set<string>();
	#lastSave = new Map<string, number>();
	#retries = new Map<string, number>();
	/** When each document's pending retry is due. */
	#retryDue = new Map<string, number>();
	/* eslint-enable svelte/prefer-svelte-reactivity */
	#lead: AbortController | null = null;
	#poll: Promise<void> | null = null;
	#pollTimer: ReturnType<typeof setTimeout> | null = null;
	#refreshing = false;
	#refreshAgain = false;

	/** `controller` is aborted on `stop`; pass the one whose signal the remote's requests use. */
	constructor(ctx: SyncContext, controller = new AbortController()) {
		this.#controller = controller;
		this.#ctx = { ...ctx, remote: this.#tracked(ctx.remote) };
	}

	/** First poll, backlog upload, poll leadership, listeners. */
	start(): void {
		const { channel, platform } = this.#ctx;
		this.offline = !platform.online.online();
		this.#listeners.push(
			channel.subscribe((msg) => this.#onMessage(msg)),
			platform.activity.onChange((visible) => (visible ? this.#seekLead() : this.#hidden())),
			platform.online.onChange((online) => {
				// Until a request says otherwise.
				this.offline = !online;
				if (!online) return;
				void this.syncAll();
				if (this.polling) void this.#pollNow();
			})
		);
		void this.#refresh();
		void (async () => {
			if (platform.activity.visible()) {
				// Every visible tab polls as it starts; a tab granted the lock meanwhile joins it.
				const first = this.#pollNow();
				this.#seekLead();
				await first;
			}
			await this.#sweep(false);
		})();
	}

	/** Aborts requests and timers, releases locks. */
	stop(): void {
		this.#stopped = true;
		this.#controller.abort();
		for (const off of this.#listeners.splice(0)) off();
		this.#cancelUploads();
		this.#dropLead();
	}

	/** Uploads everything; resolves the count still unsynced. */
	async syncAll(): Promise<number> {
		await this.#sweep(true);
		const states = await this.#readStates();
		// Fresh for the caller, who may read why some are left (an offline save posts nothing).
		if (!this.#stopped) this.states = states;
		return Object.values(states).filter((s) => s.state !== "synced").length;
	}

	/** Documents with unsynced changes or a hold. */
	async unsyncedCount(): Promise<number> {
		const states = await this.#readStates();
		return Object.values(states).filter((s) => s.state !== "synced").length;
	}

	fetchMissing(docId: string): Promise<boolean> {
		return fetchMissing(this.#ctx, docId);
	}

	/** Whether `docId` is in the account: false when never uploaded, or its first upload is unanswered. */
	async isInAccount(docId: string): Promise<boolean> {
		const record = await this.#ctx.platform.sync.get(this.#ctx.space, docId);
		return record !== null && record !== undefined && record.serverVersion !== null;
	}

	/**
	 * Whether `docId`'s upload is held for a point (`pointsHeld`): it has changes to upload, and
	 * holds a point its live link (on, without "Share my exact location") mustn't show.
	 */
	async pointsHeld(docId: string): Promise<boolean> {
		const local = await readLocal(this.#ctx, docId);
		if (typeof local === "string") return false;
		const { record, doc, unsynced } = local;
		return (unsynced.length > 0 || record.serverVersion === null) && pointsHeld(record, doc);
	}

	/** The server's snapshots of `docId`, newest first; throws as the remote does. */
	versions(docId: string): Promise<RemoteSnapshotMeta[]> {
		return serverVersions(this.#ctx, docId);
	}

	version(docId: string, snapshotId: number): Promise<RemoteSnapshot> {
		return serverVersion(this.#ctx, docId, snapshotId);
	}

	/** Keeps the current local version as a server snapshot before a restore replaces it. */
	async keepBeforeRestore(docId: string): Promise<"kept" | "not-on-server"> {
		try {
			return await keepBeforeRestore(this.#ctx, docId);
		} finally {
			// A pull or a `gone` hold may have changed the document's standing.
			this.states = await this.#readStates();
		}
	}

	/** Deletes a dashboard in Recently deleted from the account; the caller removes it locally. */
	async deletePermanently(docId: string): Promise<DeleteResult> {
		try {
			return await deletePermanently(this.#ctx, docId);
		} finally {
			this.states = await this.#readStates();
		}
	}

	/**
	 * Settles `docId`'s hold with the person's choice (throws, hold kept, on any refusal), then
	 * uploads what that left unsynced (a copy, or edits made meanwhile). Resolves the new
	 * dashboard's id for "save-copy" and "keep-as-new".
	 */
	async resolve(docId: string, choice: RemoteChoice): Promise<string | null> {
		const id = await resolveHold(this.#ctx, docId, choice);
		this.states = await this.#readStates();
		void this.#sweep(false);
		return id;
	}

	/**
	 * Uploads what's pending, then turns `docId`'s share link on (the last synced version, when
	 * an edit couldn't upload). With `opts.onlyIf`, only when the uploaded version passes it.
	 */
	async share(docId: string, opts?: ShareOptions): Promise<ShareResult> {
		const result = await shareDocument(this.#ctx, docId, opts);
		this.states = await this.#readStates();
		return result;
	}

	/** Turns `docId`'s share link off; throws `RemoteUnavailable` / `RemoteRefusal` on failure. */
	async unshare(docId: string): Promise<void> {
		await unshareDocument(this.#ctx, docId);
		this.states = await this.#readStates();
	}

	/** The account's display name on shared dashboards (`null`: none). */
	async displayName(): Promise<string | null> {
		return (await this.#ctx.remote.getProfile()).displayName;
	}

	/** Sets (or, with `null` or blank, clears) the display name; throws `RemoteRefusal("invalid")`. */
	async setDisplayName(name: string | null): Promise<string | null> {
		return (await this.#ctx.remote.setProfile(name)).displayName;
	}

	#onMessage(msg: TabMessage): void {
		if ((msg.type !== "committed" && msg.type !== "sync") || msg.space !== this.#ctx.space) return;
		void this.#refresh();
		if (msg.type !== "committed" || msg.tabId !== this.#ctx.tabId || msg.tabId === SYNC_TAB) {
			return;
		}
		this.#schedule(msg.docId, this.#commitDelay(msg.docId));
		// Refused documents are retried on the next local commit in the space (call 10).
		for (const [docId, s] of Object.entries(this.states)) {
			if (docId !== msg.docId && s.hold?.kind === "refused") {
				this.#schedule(docId, this.#commitDelay(docId));
			}
		}
	}

	/**
	 * When a commit's upload goes: at once in a hidden tab (a session commits as the tab hides,
	 * after `#hidden` ran, and the page may not come back); else after the throttle, and no
	 * sooner than a pending retry's backoff.
	 */
	#commitDelay(docId: string): number {
		if (!this.#ctx.platform.activity.visible()) return 0;
		const retry = this.#retryDue.get(docId);
		const backoff = retry === undefined ? 0 : retry - Date.now();
		return Math.max(this.#throttled(docId), backoff);
	}

	// Uploads

	#canUpload(): boolean {
		return !this.#stopped && !this.blocked && !this.signedOut;
	}

	#throttled(docId: string): number {
		const last = this.#lastSave.get(docId);
		return last === undefined ? 0 : Math.max(0, last + SAVE_INTERVAL_MS - Date.now());
	}

	/** Uploads `docId` after `delay` ms, or sooner if it's already due sooner. */
	#schedule(docId: string, delay: number): void {
		if (!this.#canUpload()) return;
		const due = Date.now() + delay;
		const current = this.#scheduled.get(docId);
		if (current && current.due <= due) return;
		if (current) clearTimeout(current.timer);
		if (delay <= 0) {
			this.#scheduled.delete(docId);
			void this.#upload(docId);
			return;
		}
		const timer = setTimeout(() => {
			this.#scheduled.delete(docId);
			void this.#upload(docId);
		}, delay);
		this.#scheduled.set(docId, { timer, due });
	}

	#cancelUploads(): void {
		for (const { timer } of this.#scheduled.values()) clearTimeout(timer);
		this.#scheduled.clear();
		this.#retryDue.clear();
	}

	/** The tab went to the background: scheduled uploads go now, and polling stops. */
	#hidden(): void {
		const ids = [...this.#scheduled.keys()];
		this.#cancelUploads();
		for (const docId of ids) void this.#upload(docId);
		this.#dropLead();
	}

	/** One upload per document at a time in this tab; one asked for meanwhile runs after it. */
	#upload(docId: string): Promise<void> {
		const running = this.#running.get(docId);
		if (running) {
			this.#again.add(docId);
			return running;
		}
		const run = this.#uploadOnce(docId).finally(() => {
			this.#running.delete(docId);
			if (this.#again.delete(docId)) this.#schedule(docId, this.#commitDelay(docId));
		});
		this.#running.set(docId, run);
		return run;
	}

	async #uploadOnce(docId: string): Promise<void> {
		if (!this.#canUpload()) return;
		this.#retryDue.delete(docId);
		const startedAt = Date.now();
		let result: UploadResult;
		try {
			result = await uploadDocument(this.#ctx, docId);
		} catch (error) {
			// Only a local storage failure throws; try again later like a failed request.
			report(error, { operation: "sync-upload" });
			result = "retry";
		}
		if (result !== "nothing") this.#lastSave.set(docId, startedAt);
		switch (result) {
			case "retry": {
				const tries = this.#retries.get(docId) ?? 0;
				this.#retries.set(docId, tries + 1);
				const delay = RETRY_DELAYS_MS[Math.min(tries, RETRY_DELAYS_MS.length - 1)];
				this.#retryDue.set(docId, Date.now() + delay);
				this.#schedule(docId, delay);
				return;
			}
			case "blocked":
				if (!this.blocked) this.#ctx.onBlocked?.();
				this.blocked = true;
				this.#cancelUploads();
				return;
			case "signed-out":
				this.signedOut = true;
				this.#cancelUploads();
				return;
			case "points":
				// Uploaded once the point is swapped (a commit schedules it), not on a timer.
				this.#retries.delete(docId);
				this.#ctx.onPointsHeld?.(docId);
				return;
			default:
				this.#retries.delete(docId);
		}
	}

	/** Moves finished, then every document with unsynced changes uploaded (one at a time). */
	async #sweep(includeRefused: boolean): Promise<void> {
		if (!this.#canUpload()) return;
		try {
			await finishMoves(this.#ctx);
			const states = await this.#readStates();
			for (const [docId, s] of Object.entries(states)) {
				if (!this.#canUpload()) return;
				if (s.state === "synced" || (s.hold?.kind === "refused" && !includeRefused)) continue;
				await this.#upload(docId);
			}
		} catch (error) {
			report(error, { operation: "sync-sweep" });
		}
	}

	// Polling

	/** Asks for the poll lock while visible; polls at once when granted, then every minute. */
	#seekLead(): void {
		const { platform, space } = this.#ctx;
		if (this.#lead || this.#stopped || !platform.activity.visible()) return;
		const lead = new AbortController();
		this.#lead = lead;
		platform.locks
			.hold(pollLock(space), lead.signal, () => {
				if (lead.signal.aborted) return;
				this.polling = true;
				void this.#pollNow();
			})
			.catch((error) => report(error, { operation: "sync-poll-lock" }))
			.finally(() => {
				if (this.#lead === lead) this.#dropLead();
			});
	}

	#dropLead(): void {
		this.#lead?.abort();
		this.#lead = null;
		this.polling = false;
		if (this.#pollTimer !== null) clearTimeout(this.#pollTimer);
		this.#pollTimer = null;
	}

	/** One poll (joining one in progress); the poller then uploads the backlog and waits a minute. */
	#pollNow(): Promise<void> {
		if (this.#poll) return this.#poll;
		// Signed out: nothing more until the app leaves this space and stops this worker.
		if (this.signedOut || this.#stopped) return Promise.resolve();
		if (this.#pollTimer !== null) clearTimeout(this.#pollTimer);
		this.#pollTimer = null;
		this.#poll = (async () => {
			try {
				await pollList(this.#ctx);
			} catch (error) {
				await this.#pollFailed(error);
			}
			if (this.polling) await this.#sweep(false);
		})().finally(() => {
			this.#poll = null;
			if (this.polling && !this.#stopped) {
				this.#pollTimer = setTimeout(() => void this.#pollNow(), POLL_INTERVAL_MS);
			}
		});
		return this.#poll;
	}

	async #pollFailed(error: unknown): Promise<void> {
		if (error instanceof RemoteUnavailable) return;
		if (error instanceof RemoteRefusal) {
			if (error.code === "unauthorized" || error.code === "account_mismatch") {
				await this.#ctx.platform.identity.recheck({ force: true }).catch(() => {});
				this.signedOut = true;
				this.#cancelUploads();
			}
			return;
		}
		report(error, { operation: "sync-poll" });
	}

	// States

	async #refresh(): Promise<void> {
		if (this.#refreshing) {
			this.#refreshAgain = true;
			return;
		}
		this.#refreshing = true;
		try {
			do {
				this.#refreshAgain = false;
				const states = await this.#readStates();
				if (this.#stopped) return;
				this.states = states;
			} while (this.#refreshAgain);
		} catch (error) {
			report(error, { operation: "sync-states" });
		} finally {
			this.#refreshing = false;
		}
	}

	async #readStates(): Promise<Record<string, DocSyncState>> {
		const { platform, space } = this.#ctx;
		const states: Record<string, DocSyncState> = {};
		for (const raw of await platform.documents.list(space)) {
			const docId = (raw as { id?: unknown } | null)?.id;
			if (typeof docId !== "string") continue;
			let unsynced = 0;
			let record = (await platform.sync.get(space, docId)) ?? emptyRecord(docId);
			try {
				const local = await readLocal(this.#ctx, docId);
				if (typeof local !== "string") {
					record = local.record;
					unsynced = local.unsynced.length;
				}
			} catch {
				// Unsynced changes the log no longer holds: still not on the server.
				unsynced = 1;
			}
			const hold = record.hold;
			const held = hold !== null && hold.kind !== "moved";
			states[docId] = {
				state: held ? "held" : unsynced > 0 || record.serverVersion === null ? "pending" : "synced",
				hold,
				confirmedAt: record.confirmedAt,
				onServer: record.serverVersion !== null,
				shareToken: record.shareToken,
				shareExact: record.shareExact
			};
		}
		return states;
	}

	/** The remote, noting whether the server answered (`offline` when it couldn't be reached). */
	#tracked(remote: RemoteDocuments): RemoteDocuments {
		const track = async <T>(call: () => Promise<T>): Promise<T> => {
			try {
				const answer = await call();
				this.offline = false;
				return answer;
			} catch (error) {
				this.offline = error instanceof RemoteUnavailable;
				throw error;
			}
		};
		return {
			list: (since) => track(() => remote.list(since)),
			get: (id) => track(() => remote.get(id)),
			changes: (id, since) => track(() => remote.changes(id, since)),
			save: (id, input) => track(() => remote.save(id, input)),
			keepSnapshot: (id, input) => track(() => remote.keepSnapshot(id, input)),
			listSnapshots: (id) => track(() => remote.listSnapshots(id)),
			getSnapshot: (id, snapshotId) => track(() => remote.getSnapshot(id, snapshotId)),
			deletePermanently: (id) => track(() => remote.deletePermanently(id)),
			share: (id) => track(() => remote.share(id)),
			unshare: (id) => track(() => remote.unshare(id)),
			shared: (token) => track(() => remote.shared(token)),
			sharedChanges: (token, since) => track(() => remote.sharedChanges(token, since)),
			credit: (id) => track(() => remote.credit(id)),
			getProfile: () => track(() => remote.getProfile()),
			setProfile: (displayName) => track(() => remote.setProfile(displayName))
		};
	}
}
