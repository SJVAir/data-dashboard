import { loadDashboard } from "$lib/documents/load";
import { displayNames, type DashboardSummary } from "$lib/documents/names";
import type { ChosenPlace } from "$lib/data/schema";
import { DashboardSchema, type Dashboard } from "$lib/documents/schema";
import type { Platform, SpaceId } from "$lib/platform/types";
import { forgetDocument } from "$lib/sharing/fingerprints";
import {
	STARTER_ID,
	blankDashboard,
	copyOfStarter,
	duplicateDashboard,
	starterDashboard
} from "$lib/starter/starter";
import { pendingName } from "./journal";
import type { TabChannel, TabMessage } from "./tab-channel";

export type DashboardIndexOptions = {
	platform: Platform;
	space: SpaceId;
	/**
	 * A `committed`, `sync`, or `moved` message for the space refreshes the index: a tab's
	 * creation posts `committed`; the sync worker adding or removing a document posts `sync`.
	 */
	channel?: TabChannel;
	/** Posted with this index's creations. */
	tabId?: string;
	now?: () => Date;
};

/** The messages after which the stored dashboards may have changed. */
const REFRESHES: ReadonlySet<TabMessage["type"]> = new Set(["committed", "sync", "moved"]);

const optionalString = (value: unknown): string | undefined =>
	typeof value === "string" ? value : undefined;

/**
 * The summary of a stored document, or `null` to leave it out. Documents a newer version
 * saved are listed by their stored fields when those are readable; invalid ones are skipped (and listed in `unreadable`).
 */
function summarize(raw: unknown): DashboardSummary | null {
	const loaded = loadDashboard(raw);
	if (loaded.status === "ok") return pick(loaded.doc);
	if (loaded.reason !== "newer") return null;
	const doc = raw as Record<string, unknown>;
	const { id, createdAt, updatedAt } = doc;
	if (typeof id !== "string" || typeof createdAt !== "string" || typeof updatedAt !== "string") {
		return null;
	}
	return {
		id,
		name: typeof doc.name === "string" ? doc.name : null,
		copiedFrom: optionalString(doc.copiedFrom),
		createdAt,
		updatedAt,
		deletedAt: optionalString(doc.deletedAt)
	};
}

function pick(doc: Dashboard): DashboardSummary {
	const { id, name, copiedFrom, createdAt, updatedAt, deletedAt } = doc;
	return { id, name, copiedFrom, createdAt, updatedAt, deletedAt };
}

/**
 * This space's dashboards (not deleted), newest change first, with their display names; and
 * those in Recently deleted, newest deletion first.
 */
export class DashboardIndex {
	items = $state.raw<DashboardSummary[]>([]);
	deleted = $state.raw<DashboardSummary[]>([]);
	/** One pass over live and deleted together, so a dashboard keeps its name when deleted. */
	#allNames = $derived(displayNames([...this.items, ...this.deleted], STARTER_ID));
	names = $derived(this.#allNames);
	deletedNames = $derived(this.#allNames);
	/** Invalid stored documents that have an id (so can be removed), with their `updatedAt`. */
	unreadable = $state.raw<Array<{ id: string; updatedAt?: string }>>([]);
	/** Every stored document, readable or not, including deleted ones and ones with no id. */
	storedCount = $state(0);

	readonly #platform: Platform;
	readonly #space: SpaceId;
	readonly #channel: TabChannel | null;
	readonly #tabId: string;
	readonly #now: () => Date;
	readonly #unsubscribe: () => void;
	#generation = 0;
	#latest: Promise<void> = Promise.resolve();

	constructor(opts: DashboardIndexOptions) {
		this.#platform = opts.platform;
		this.#space = opts.space;
		this.#channel = opts.channel ?? null;
		this.#tabId = opts.tabId ?? "";
		// A timestamp source, not reactive state.
		// eslint-disable-next-line svelte/prefer-svelte-reactivity
		this.#now = opts.now ?? (() => new Date());
		this.#unsubscribe =
			this.#channel?.subscribe((msg) => {
				if (!REFRESHES.has(msg.type) || !("space" in msg) || msg.space !== this.#space) return;
				void this.refresh();
			}) ?? (() => {});
	}

	/**
	 * Re-read the stored dashboards. When refreshes overlap, the latest one wins, and every
	 * caller waits for it: when this resolves, the index shows what was stored at the call.
	 */
	async refresh(): Promise<void> {
		const generation = ++this.#generation;
		const own = this.#read(generation);
		this.#latest = own;
		await own;
		for (let seen = own; this.#latest !== seen;) {
			seen = this.#latest;
			await seen;
		}
	}

	async #read(generation: number): Promise<void> {
		const raws = await this.#platform.documents.list(this.#space);
		if (generation !== this.#generation) return;
		// A rename that exists only in a journal record shows before the dashboard is opened.
		// A local lookup, not reactive state.
		// eslint-disable-next-line svelte/prefer-svelte-reactivity
		const pending = new Map<string, Array<{ record: unknown }>>();
		for (const { docId, record } of this.#platform.journal.list(this.#space)) {
			pending.set(docId, [...(pending.get(docId) ?? []), { record }]);
		}
		this.storedCount = raws.length;
		const summaries = raws.map((raw) => ({ raw, summary: summarize(raw) }));
		this.unreadable = summaries
			.filter(({ summary }) => summary === null)
			.map(({ raw }) => raw as { id?: unknown; updatedAt?: unknown } | null)
			.filter((raw) => typeof raw?.id === "string")
			.map((raw) => ({ id: raw!.id as string, updatedAt: optionalString(raw!.updatedAt) }));
		const all = summaries
			.map(({ summary }) => summary)
			.filter((d): d is DashboardSummary => d !== null)
			.map((d) => {
				const name = pendingName(pending.get(d.id) ?? []);
				return name === undefined ? d : { ...d, name };
			});
		this.items = all
			.filter((d) => d.deletedAt === undefined)
			.sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
		this.deleted = all
			.filter((d) => d.deletedAt !== undefined)
			.sort((a, b) => Date.parse(b.deletedAt!) - Date.parse(a.deletedAt!));
	}

	/** "Delete now": removes the dashboard for good, with its journal records and fingerprints. */
	async remove(id: string): Promise<void> {
		const { documents, journal } = this.#platform;
		// Restored (here or in another tab) while the person was confirming: leave it.
		const stored = await documents.get(this.#space, id);
		const deletedAt = (stored as { deletedAt?: unknown } | null | undefined)?.deletedAt;
		if (typeof deletedAt !== "string") {
			await this.refresh();
			return;
		}
		await documents.remove(this.#space, id);
		for (const { docId, tabId } of journal.list(this.#space)) {
			if (docId === id) journal.clear(this.#space, docId, tabId);
		}
		await forgetDocument(this.#platform, this.#space, id);
		this.#channel?.post({
			type: "committed",
			space: this.#space,
			docId: id,
			version: 0,
			tabId: this.#tabId
		});
		await this.refresh();
	}

	/** Deletes a dashboard that can't be opened, with its journal records and fingerprints. */
	async removeUnreadable(id: string): Promise<void> {
		const { documents, journal } = this.#platform;
		// Readable (or already gone) by now, e.g. fixed in another tab: leave it.
		const stored = await documents.get(this.#space, id);
		if (stored === undefined || summarize(stored) !== null) {
			await this.refresh();
			return;
		}
		await documents.remove(this.#space, id);
		for (const { docId, tabId } of journal.list(this.#space)) {
			if (docId === id) journal.clear(this.#space, docId, tabId);
		}
		await forgetDocument(this.#platform, this.#space, id);
		this.#channel?.post({
			type: "committed",
			space: this.#space,
			docId: id,
			version: 0,
			tabId: this.#tabId
		});
		await this.refresh();
	}

	createBlank(): Promise<string> {
		return this.#create(blankDashboard(this.#now()));
	}

	/** "New from starter": the starter at `place` (the space's chosen place). */
	createFromStarter(place: ChosenPlace): Promise<string> {
		return this.#create(copyOfStarter(this.#now(), place));
	}

	/**
	 * Copies the stored document (callers flush its session first), or the starter at
	 * `starterPlace` (required for `STARTER_ID`).
	 */
	async duplicate(id: string, starterPlace?: ChosenPlace): Promise<string> {
		let source: Dashboard;
		if (id === STARTER_ID) {
			if (!starterPlace) throw new Error("Duplicating the starter needs its place");
			source = starterDashboard(starterPlace);
		} else {
			const loaded = loadDashboard(await this.#platform.documents.get(this.#space, id));
			if (loaded.status !== "ok") throw new Error(`Dashboard ${id} can't be duplicated`);
			source = loaded.doc;
		}
		return this.#create(duplicateDashboard(source, this.#now()));
	}

	/** Stores `doc` (a new, unstored document) as a dashboard and refreshes the list. */
	createFrom(doc: Dashboard): Promise<string> {
		return this.#create(doc);
	}

	dispose(): void {
		this.#unsubscribe();
	}

	async #create(doc: Dashboard): Promise<string> {
		// Storage doesn't validate: a document that mustn't be stored (`default-place`) fails here.
		const valid = DashboardSchema.safeParse(doc);
		if (!valid.success) throw new Error(`Dashboard ${doc.id} is invalid: ${valid.error.message}`);
		const result = await this.#platform.documents.commit(this.#space, {
			docId: doc.id,
			baseVersion: null,
			doc,
			entries: []
		});
		if (!result.ok) throw new Error(`Dashboard ${doc.id} already exists`);
		this.#channel?.post({
			type: "committed",
			space: this.#space,
			docId: doc.id,
			version: doc.version,
			tabId: this.#tabId
		});
		await this.refresh();
		return doc.id;
	}
}
