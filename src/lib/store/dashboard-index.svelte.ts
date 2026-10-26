import { loadDashboard } from "$lib/documents/load";
import { displayNames, type DashboardSummary } from "$lib/documents/names";
import type { Dashboard } from "$lib/documents/schema";
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
import type { TabChannel } from "./tab-channel";

export type DashboardIndexOptions = {
	platform: Platform;
	space: SpaceId;
	/** Any `committed` message refreshes the index; creating a dashboard posts one. */
	channel?: TabChannel;
	/** Posted with this index's creations. */
	tabId?: string;
	now?: () => Date;
};

const optionalString = (value: unknown): string | undefined =>
	typeof value === "string" ? value : undefined;

/**
 * The summary of a stored document, or `null` to leave it out. Documents a newer version
 * saved are listed by their stored fields when those are readable; invalid ones are skipped.
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
	names = $derived(displayNames(this.items, STARTER_ID));
	deleted = $state.raw<DashboardSummary[]>([]);
	deletedNames = $derived(displayNames(this.deleted, STARTER_ID));

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
				if (msg.type === "committed" && msg.space === this.#space) void this.refresh();
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
		const all = raws
			.map(summarize)
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

	createBlank(): Promise<string> {
		return this.#create(blankDashboard(this.#now()));
	}

	createFromStarter(): Promise<string> {
		return this.#create(copyOfStarter(this.#now()));
	}

	/** Copies the stored document (callers flush its session first), or the starter. */
	async duplicate(id: string): Promise<string> {
		let source: Dashboard;
		if (id === STARTER_ID) source = starterDashboard();
		else {
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
