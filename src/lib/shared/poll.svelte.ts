/**
 * A live share link's document, kept current: loaded once, then asked about every 60 seconds
 * while the page is visible (at once when it becomes visible or comes back online), never while
 * hidden. Every `not_found` is the same "no longer available" view: it never says why.
 *
 * Nothing from the shared document goes into an error report: failures here aren't reported.
 */
import { loadDashboard } from "$lib/documents/load";
import type { Dashboard } from "$lib/documents/schema";
import { platform } from "$lib/platform";
import { updateNotice } from "$lib/safety/update-notice.svelte";
import { MAX_DOCUMENT_CHARS } from "$lib/sharing/envelope";
import { RemoteRefusal, type RemoteDocuments, type SharedRemoteDocument } from "$lib/sync/remote";

export const SHARED_POLL_MS = 60_000;

export type SharedView =
	| { kind: "loading" }
	| { kind: "shown"; doc: Dashboard; version: number; sourceId: string; displayName: string | null }
	| { kind: "unavailable" } // any not_found: one page for every reason
	| { kind: "newer" }
	| { kind: "invalid" } // invalid or over MAX_DOCUMENT_CHARS
	| { kind: "offline" }; // first load couldn't reach the server

/** The view for a shared document: validated and size-checked before anything renders. */
function viewOf(shared: SharedRemoteDocument, now: () => Date): SharedView {
	const { kind, schemaVersion, id, name, body } = shared;
	const updatedAt = typeof shared.updatedAt === "string" ? shared.updatedAt : now().toISOString();
	const raw = { kind, schemaVersion, id, name, body, version: 0, createdAt: updatedAt, updatedAt };
	if (JSON.stringify(raw).length > MAX_DOCUMENT_CHARS) return { kind: "invalid" };
	const loaded = loadDashboard(raw);
	if (loaded.status === "read-only") {
		return loaded.reason === "newer" ? { kind: "newer" } : { kind: "invalid" };
	}
	return {
		kind: "shown",
		doc: loaded.doc,
		version: shared.version,
		sourceId: shared.id,
		displayName: shared.displayName
	};
}

const clock = (): Date => new Date();

const isNotFound = (error: unknown) => error instanceof RemoteRefusal && error.code === "not_found";

export class SharedDocumentView {
	view = $state.raw<SharedView>({ kind: "loading" });

	#remote: RemoteDocuments;
	#token: string;
	#now: () => Date;
	#timer: ReturnType<typeof setTimeout> | null = null;
	#offs: Array<() => void> = [];
	#started = false;
	#stopped = false;
	#busy = false;

	constructor(remote: RemoteDocuments, token: string, now?: () => Date) {
		this.#remote = remote;
		this.#token = token;
		this.#now = now ?? clock;
	}

	/** Loads the document, then polls every 60 s while visible; at once on visible / online. */
	start(): void {
		if (this.#started || this.#stopped) return;
		this.#started = true;
		const { activity, online } = platform();
		this.#offs = [
			activity.onChange((visible) => {
				if (visible) void this.#tick();
				else this.#clearTimer();
			}),
			online.onChange((isOnline) => {
				if (isOnline && activity.visible()) void this.#tick();
			})
		];
		void this.#tick();
	}

	stop(): void {
		this.#stopped = true;
		this.#clearTimer();
		for (const off of this.#offs.splice(0)) off();
	}

	/** From the offline page: try the first load again. */
	async retry(): Promise<void> {
		if (this.view.kind !== "offline") return;
		this.view = { kind: "loading" };
		await this.#tick();
	}

	#clearTimer(): void {
		if (this.#timer !== null) clearTimeout(this.#timer);
		this.#timer = null;
	}

	/** Whether there's anything left to ask: a dead link, or one this build can't show, isn't. */
	get #live(): boolean {
		const kind = this.view.kind;
		return !this.#stopped && (kind === "loading" || kind === "shown" || kind === "offline");
	}

	#schedule(): void {
		this.#clearTimer();
		if (!this.#live || !platform().activity.visible()) return;
		this.#timer = setTimeout(() => void this.#tick(), SHARED_POLL_MS);
	}

	async #tick(): Promise<void> {
		if (this.#busy || !this.#live) return;
		this.#busy = true;
		this.#clearTimer();
		try {
			const view = this.view;
			if (view.kind === "shown") await this.#poll(view.version);
			else await this.#load();
		} finally {
			this.#busy = false;
			this.#schedule();
		}
	}

	async #load(): Promise<void> {
		try {
			const shared = await this.#remote.shared(this.#token);
			if (!this.#stopped) this.#show(shared);
		} catch (error) {
			if (this.#stopped) return;
			// Any other failure: the server couldn't be reached (or answered with nothing usable).
			this.view = isNotFound(error) ? { kind: "unavailable" } : { kind: "offline" };
		}
	}

	async #poll(since: number): Promise<void> {
		try {
			const answer = await this.#remote.sharedChanges(this.#token, since);
			if (this.#stopped || !("document" in answer)) return;
			this.#show(answer.document);
		} catch (error) {
			// Unreachable or refused for now: the shown version stays, and the next poll tries again.
			if (!this.#stopped && isNotFound(error)) this.view = { kind: "unavailable" };
		}
	}

	#show(shared: SharedRemoteDocument): void {
		const next = viewOf(shared, this.#now);
		if (next.kind === "newer") updateNotice.show("newer-data");
		this.view = next;
	}
}
