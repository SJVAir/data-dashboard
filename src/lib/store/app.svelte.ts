import { getContext, setContext } from "svelte";
import { m } from "$lib/paraglide/messages.js";
import type { Platform, SpaceId } from "$lib/platform/types";
import { STARTER_ID, resolveHome, starterSession, type HomeTarget } from "$lib/starter/starter";
import { registerWidgetType } from "$lib/widgets/registry";
import { placeholderType } from "$lib/widgets/placeholder";
import { DashboardIndex } from "./dashboard-index.svelte";
import { DocumentSession } from "./document-session.svelte";
import { createTabChannel, type TabChannel, type TabMessage } from "./tab-channel";

/** Preference key: the id of the dashboard opened last in this space. */
export const LAST_OPENED_KEY = "lastOpened";

export type CurrentDashboard = { session: DocumentSession | null; isStarter: boolean };

export type AppContext = {
	platform: Platform;
	space: SpaceId;
	tabId: string;
	channel: TabChannel;
	index: DashboardIndex;
	/** Open sessions by id (one per dashboard in this tab); `STARTER_ID` gives the starter. Opening records the last-opened dashboard unless `remember` is false. */
	sessions: {
		get(id: string, opts?: { remember?: boolean }): Promise<DocumentSession | null>;
	};
	current: CurrentDashboard;
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
	debounceMs?: number;
	now?: () => Date;
};

/**
 * Also delivers this tab's own posts to this tab's subscribers (a `BroadcastChannel` never
 * does), so the index sees this tab's saves. Sessions ignore their own tab's messages.
 */
function withLocalEcho(channel: TabChannel): TabChannel {
	// Subscribers, not reactive state.
	// eslint-disable-next-line svelte/prefer-svelte-reactivity
	const local = new Set<(msg: TabMessage) => void>();
	return {
		post(msg) {
			channel.post(msg);
			for (const fn of local) queueMicrotask(() => fn(structuredClone(msg)));
		},
		subscribe(fn) {
			local.add(fn);
			const unsubscribe = channel.subscribe(fn);
			return () => {
				local.delete(fn);
				unsubscribe();
			};
		}
	};
}

class App implements AppContext {
	current = $state<CurrentDashboard>({ session: null, isStarter: false });
	resetCount = $state(0);
	readonly index: DashboardIndex;
	readonly sessions: AppContext["sessions"];

	readonly #open = new Map<string, Promise<DocumentSession | null>>();
	/** The sessions in `#open` that have finished opening, for synchronous `suspendAll`. */
	readonly #live = new Map<string, DocumentSession>();

	constructor(
		readonly platform: Platform,
		readonly space: SpaceId,
		readonly tabId: string,
		readonly channel: TabChannel,
		readonly options: AppOptions
	) {
		this.index = new DashboardIndex({ platform, space, channel, tabId, now: options.now });
		this.sessions = { get: (id, opts) => this.#get(id, opts?.remember ?? true) };
	}

	async #get(id: string, remember: boolean): Promise<DocumentSession | null> {
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
				now
			});
			const own = opening;
			void own.then((session) => {
				if (session && this.#open.get(id) === own) this.#live.set(id, session);
			});
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

	suspendAll(): void {
		for (const session of this.#live.values()) session.suspend();
		// Still opening: suspended as soon as they're open.
		for (const opening of this.#open.values()) void opening.then((session) => session?.suspend());
	}

	async resetAfterClear(): Promise<void> {
		for (const session of this.#live.values()) session.discard();
		for (const opening of this.#open.values()) void opening.then((session) => session?.discard());
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

/** Set up the app for this tab: the space, the widget types, the tab channel, and the index. */
export async function initApp(platform: Platform, options: AppOptions = {}): Promise<AppContext> {
	registerWidgetType(placeholderType);
	const space = await platform.identity.currentSpace();
	const tabId = options.tabId ?? crypto.randomUUID();
	const channel = withLocalEcho(options.channel ?? createTabChannel());
	const app = new App(platform, space, tabId, channel, { ...options, channel });
	await app.index.refresh();
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
	return own ?? app.index.names.get(session.doc.id) ?? m.dashboard_untitled();
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
