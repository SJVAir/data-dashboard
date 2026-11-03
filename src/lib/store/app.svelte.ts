import { getContext, setContext } from "svelte";
import { toast } from "svelte-sonner";
import { displayNames } from "$lib/documents/names";
import { m } from "$lib/paraglide/messages.js";
import type { Platform, SpaceId } from "$lib/platform/types";
import type { SyncContext } from "$lib/sync/context";
import type { SyncWorker } from "$lib/sync/worker.svelte";
import { BUILD_ID } from "$lib/safety/build-id";
import { StorageProtection } from "$lib/safety/protection.svelte";
import { purgeExpired } from "$lib/safety/purge";
import { report } from "$lib/safety/report";
import { updateNotice } from "$lib/safety/update-notice.svelte";
import { STARTER_ID, resolveHome, starterSession, type HomeTarget } from "$lib/starter/starter";
import { registerWidgetType } from "$lib/widgets/registry";
import { placeholderType } from "$lib/widgets/placeholder";
import { AccountState, type Notify } from "./account.svelte";
import { DashboardIndex } from "./dashboard-index.svelte";
import { DocumentSession } from "./document-session.svelte";
import { markDeleted, spaceFor, spaceLock, tidySpaces, unhideSpace } from "./spaces";
import { createTabChannel, withLocalEcho, type TabChannel } from "./tab-channel";

/** Preference key: the id of the dashboard opened last in this space. */
export const LAST_OPENED_KEY = "lastOpened";

export type CurrentDashboard = { session: DocumentSession | null; isStarter: boolean };

export type AppContext = {
	platform: Platform;
	space: SpaceId;
	tabId: string;
	channel: TabChannel;
	index: DashboardIndex;
	protection: StorageProtection;
	/** Who is signed in, shared with the other tabs. */
	account: AccountState;
	/** The folder holding `app.js` (and `version.json`). */
	staticBase: URL;
	/** Open sessions by id (one per dashboard in this tab); `STARTER_ID` gives the starter. Opening records the last-opened dashboard unless `remember` is false. */
	sessions: {
		get(id: string, opts?: { remember?: boolean }): Promise<DocumentSession | null>;
	};
	current: CurrentDashboard;
	/** This tab's sync worker in an account space (`null`: not syncing). */
	sync: SyncWorker | null;
	/** The sessions this tab has open (the starter's included). */
	openSessions(): DocumentSession[];
	/**
	 * Leaving this space (the app is remounted for another): stores and disposes every open
	 * session, stops the sync worker, and stops following the other tabs.
	 */
	close(): Promise<void>;
	/** Counts `resetAfterClear` calls; the root component goes to `/` when it changes. */
	readonly resetCount: number;
	/** Storage is about to go away: journal every open session's changes and stop saving. */
	suspendAll(): void;
	/**
	 * After this browser's data was cleared: drop every open session without saving, show no
	 * dashboard, and reload the index. The root component then goes to `/` (the starter).
	 */
	resetAfterClear(): Promise<void>;
};

export type AppOptions = {
	/** Defaults to the browser's channel between tabs. */
	channel?: TabChannel;
	tabId?: string;
	/** Defaults to the current page's folder. */
	staticBase?: URL;
	debounceMs?: number;
	now?: () => Date;
	/** How account changes are told to the person. Defaults to toasts. */
	notify?: Notify;
	/**
	 * Gives an account space its sync worker. Defaults to `loadSyncWorker`, loaded only then, so
	 * the anonymous space never loads the sync code; `null` starts none (tests that drive one).
	 */
	loadSync?: ((ctx: Omit<SyncContext, "remote">) => Promise<SyncWorker>) | null;
};

const loadSync = async (ctx: Omit<SyncContext, "remote">): Promise<SyncWorker> => {
	const { loadSyncWorker } = await import("$lib/sync/load");
	return loadSyncWorker(ctx);
};

const toastNotify: Notify = {
	info: (message) => toast(message),
	error: (message) => toast.error(message)
};

class App implements AppContext {
	current = $state<CurrentDashboard>({ session: null, isStarter: false });
	sync = $state.raw<SyncWorker | null>(null);
	resetCount = $state(0);
	readonly index: DashboardIndex;
	readonly protection: StorageProtection;
	readonly account: AccountState;
	readonly sessions: AppContext["sessions"];
	readonly staticBase: URL;

	readonly #open = new Map<string, Promise<DocumentSession | null>>();
	/** The sessions in `#open` that have finished opening, for synchronous `suspendAll`. */
	readonly #live = new Map<string, DocumentSession>();
	/** Stops this app's channel listeners (`close`). */
	readonly #stops: Array<() => void> = [];
	/** Releases the space's lock (`close`). */
	readonly #lock = new AbortController();
	#holding: Promise<void> = Promise.resolve();
	#closed = false;

	constructor(
		readonly platform: Platform,
		readonly space: SpaceId,
		readonly tabId: string,
		readonly channel: TabChannel,
		readonly options: AppOptions
	) {
		this.index = new DashboardIndex({ platform, space, channel, tabId, now: options.now });
		this.protection = new StorageProtection(platform, space);
		this.account = new AccountState(
			platform.identity,
			channel,
			tabId,
			options.notify ?? toastNotify
		);
		this.staticBase =
			options.staticBase ?? new URL(".", globalThis.location?.href ?? "http://localhost/");
		this.sessions = { get: (id, opts) => this.#get(id, opts?.remember ?? true) };
	}

	/** Given to every session: storage moved to a newer format, or was cleared, elsewhere. */
	readonly #guards = {
		onNeedsReload: () => {
			updateNotice.show("newer-data");
			this.suspendAll();
		},
		onCleared: () => void this.resetAfterClear()
	};

	async #get(id: string, remember: boolean): Promise<DocumentSession | null> {
		// Closed: its sessions are gone, and a new one would never be stored or disposed.
		if (this.#closed) return null;
		if (id === STARTER_ID) {
			if (!this.#open.has(id)) this.#open.set(id, Promise.resolve(this.#starter()));
			return this.#open.get(id)!;
		}
		let opening = this.#open.get(id);
		if (!opening) {
			const { channel, debounceMs, now } = this.options;
			opening = DocumentSession.open(this.platform, this.space, id, this.tabId, {
				channel,
				debounceMs,
				now,
				...this.#guards
			});
			const own = opening;
			void own.then(
				(session) => {
					if (session && this.#open.get(id) === own) this.#live.set(id, session);
				},
				// Told to the caller, who awaits `opening`.
				() => {}
			);
			this.#open.set(id, opening);
		}
		const session = await opening;
		if (!session) {
			// Not stored (yet): a later creation must be able to open it.
			if (this.#open.get(id) === opening) this.#open.delete(id);
			return null;
		}
		if (remember) await this.platform.preferences.set(this.space, LAST_OPENED_KEY, id);
		return session;
	}

	openSessions(): DocumentSession[] {
		return [...this.#live.values()];
	}

	/** Follows the other tabs: a clear elsewhere, and this tab's first change. */
	listen(): void {
		const { channel, tabId } = this;
		this.#stops.push(
			// Another tab cleared this browser's data: drop everything this tab has open.
			channel.subscribe((msg) => {
				if (msg.type === "cleared" && msg.tabId !== tabId) void this.resetAfterClear();
			})
		);
		// The first create or edit in this tab (its own message comes back through the echo).
		const stop = channel.subscribe((msg) => {
			if (msg.type !== "committed" || msg.tabId !== tabId) return;
			stop();
			void this.protection.requestAuto();
		});
		this.#stops.push(stop);
	}

	/**
	 * Holds the space's lock (shared with this space's other tabs) while open, so another tab's
	 * `tidySpaces` leaves the space alone. Resolves once granted: a tidy removing the space
	 * meanwhile finishes first, so nothing stored after this is removed with it.
	 */
	holdSpace(): Promise<void> {
		let grant = () => {};
		const granted = new Promise<void>((resolve) => (grant = resolve));
		this.#holding = this.platform.locks
			.hold(spaceLock(this.space), this.#lock.signal, () => grant(), { shared: true })
			.catch((error) => report(error, { operation: "space-lock" }))
			// Never granted (it failed): the app still opens.
			.finally(() => grant());
		return granted;
	}

	/** Loads and starts the account space's sync worker; a failed load leaves it local-only. */
	async startSync(load: NonNullable<AppOptions["loadSync"]>): Promise<void> {
		if (this.space === "anonymous") return;
		const now = this.options.now ?? (() => new Date());
		try {
			const worker = await load({
				platform: this.platform,
				space: this.space,
				accountId: this.space.slice("account:".length),
				channel: this.channel,
				tabId: this.tabId,
				buildId: BUILD_ID,
				now,
				onBlocked: () => updateNotice.show("build-blocked")
			});
			if (this.#closed) return;
			this.sync = worker;
			worker.start();
		} catch (error) {
			// Its dashboards still open and save here; they upload after a reload.
			report(error, { operation: "sync-load" });
		}
	}

	async close(): Promise<void> {
		this.#closed = true;
		for (const stop of this.#stops.splice(0)) stop();
		this.account.dispose();
		this.index.dispose();
		// Requests for the space being left stop here; its queue waits in storage.
		this.sync?.stop();
		// One that failed to open (told to its caller) mustn't keep the others from being stored.
		const opened = (await Promise.allSettled(this.#open.values()))
			.map((result) => (result.status === "fulfilled" ? result.value : null))
			.filter((session) => session !== null);
		const sessions = [...new Set([...this.#live.values(), ...opened])];
		this.#open.clear();
		this.#live.clear();
		this.current = { session: null, isStarter: false };
		try {
			await Promise.all(
				sessions.map(async (session) => {
					try {
						await session.flush();
					} finally {
						session.dispose();
					}
				})
			);
		} finally {
			// After the last edits are stored: the next space's tidy may then remove this one.
			this.#lock.abort();
			await this.#holding;
		}
	}

	suspendAll(): void {
		for (const session of this.#live.values()) session.suspend();
		// Still opening: suspended as soon as they're open.
		for (const opening of this.#open.values())
			void opening.then(
				(session) => session?.suspend(),
				() => {}
			);
	}

	async resetAfterClear(): Promise<void> {
		for (const session of this.#live.values()) session.discard();
		for (const opening of this.#open.values())
			void opening.then(
				(session) => session?.discard(),
				() => {}
			);
		this.#live.clear();
		this.#open.clear();
		this.current = { session: null, isStarter: false };
		this.resetCount++;
		await this.index.refresh();
	}

	#starter(): DocumentSession {
		const { debounceMs, now } = this.options;
		const resets = this.resetCount;
		const starter = starterSession({
			platform: this.platform,
			space: this.space,
			tabId: this.tabId,
			channel: this.channel,
			debounceMs,
			now,
			...this.#guards,
			onCopied: (copy) => {
				// A hand-off that finished after the data was cleared mustn't come back.
				if (this.resetCount !== resets) return copy.discard();
				const id = copy.doc.id;
				// The next visit to the starter gets a fresh one.
				this.#open.delete(STARTER_ID);
				this.#live.delete(STARTER_ID);
				this.#open.set(id, Promise.resolve(copy));
				this.#live.set(id, copy);
				this.current = { session: copy, isStarter: false };
				void this.platform.preferences.set(this.space, LAST_OPENED_KEY, id);
				void this.index.refresh();
			}
		});
		this.#live.set(STARTER_ID, starter);
		return starter;
	}
}

/** A storage error in housekeeping mustn't keep the app from opening. */
async function housekeeping(task: () => Promise<void>): Promise<void> {
	try {
		await task();
	} catch {
		// Tried again the next time the app opens.
	}
}

/**
 * Set up the app for this tab: the space (whoever is signed in), the widget types, the tab
 * channel, who is signed in, the index, and in an account space its sync worker.
 */
export async function initApp(platform: Platform, options: AppOptions = {}): Promise<AppContext> {
	registerWidgetType(placeholderType);
	// The space is whoever is signed in, known once the identity has started.
	platform.identity.start();
	const space = await platform.identity.currentSpace();
	const tabId = options.tabId ?? crypto.randomUUID();
	const channel = withLocalEcho(options.channel ?? createTabChannel());
	const app = new App(platform, space, tabId, channel, { ...options, channel });
	// A timestamp, not reactive state.
	// eslint-disable-next-line svelte/prefer-svelte-reactivity
	const now = options.now?.() ?? new Date();
	// Before anything is stored in the space.
	await app.holdSpace();
	// Its person is back: the space is in use again.
	if (space !== "anonymous") await housekeeping(() => unhideSpace(platform, space));
	// The page says an account was just deleted in this browser: its space goes now.
	const deleted = platform.identity.deletedAccount();
	if (deleted !== null && `account:${deleted}` !== space) {
		const gone = `account:${deleted}` as const;
		await housekeeping(async () => {
			if ((await platform.spaces.list()).includes(gone)) await markDeleted(platform, gone, now);
		});
	}
	// Only an identity known to be this space's may hide other spaces as signed out.
	const identity = platform.identity.current();
	const identityKnown = identity.state !== "unknown" && spaceFor(identity) === space;
	await housekeeping(() => tidySpaces(platform, space, now, { identityKnown }));
	await housekeeping(() => purgeExpired(platform, space, now));
	await app.index.refresh();
	await app.protection.refresh();
	app.listen();
	if (options.loadSync !== null) await app.startSync(options.loadSync ?? loadSync);
	return app;
}

/** Where `/workspace/` goes for this app. */
export async function homeTarget(app: AppContext): Promise<HomeTarget> {
	const lastOpened = await app.platform.preferences.get<string>(app.space, LAST_OPENED_KEY);
	return resolveHome(app.index.items, lastOpened);
}

/**
 * The current dashboard's display name: its own name as edited (before it's saved), else its
 * generated name. `null` when no dashboard is open.
 */
export function currentDashboardName(app: AppContext): string | null {
	const { session, isStarter } = app.current;
	if (!session) return null;
	if (isStarter) return m.dashboard_starter();
	// A read-only "invalid" document is the raw stored value, so check the name's type.
	const own = typeof session.doc.name === "string" ? session.doc.name : null;
	if (own !== null) return own;
	const id = session.doc.id;
	// The list holds the stored name, which trails a cleared name until the autosave (a restore
	// of an unnamed version): number this dashboard as unnamed now.
	const listed = app.index.items.find((d) => d.id === id);
	if (listed && listed.name !== null) {
		const items = app.index.items.map((d) => (d.id === id ? { ...d, name: null } : d));
		return displayNames(items, STARTER_ID).get(id) ?? m.dashboard_untitled();
	}
	return app.index.names.get(id) ?? m.dashboard_untitled();
}

/** The context key, for `mount(App, { context: new Map([[APP_CONTEXT_KEY, app]]) })`. */
export const APP_CONTEXT_KEY = Symbol("app");

/** Or call from the root component with `initApp`'s result. */
export function provideApp(app: AppContext): void {
	setContext(APP_CONTEXT_KEY, app);
}

export function useApp(): AppContext {
	const app = getContext<AppContext | undefined>(APP_CONTEXT_KEY);
	if (!app) throw new Error("useApp() called outside the app (provideApp was not called)");
	return app;
}
