// The open state of the dialogs loaded on demand (`LazyDialogs.svelte`, mounted in the app root).
// Their code stays out of the initial bundle: each loads on its first opening and then stays
// mounted. The `open…()` functions live here, so callers don't import the dialogs themselves.
import type { Component } from "svelte";
import type { DashboardSummary } from "$lib/documents/names";
import { loadLazy } from "$lib/safety/lazy";
import type { SwapSummary } from "$lib/sharing/points";
import type {
	AccountStatus,
	EarlierVersion,
	EarlierVersions,
	RestoreResult
} from "$lib/safety/restore-version";

/** Which of the dialogs have been asked for (and so are loaded and mounted). */
export const requested = $state({
	share: false,
	restoreVersion: false,
	clearData: false,
	privacy: false,
	existingCopy: false,
	placePicker: false,
	notifications: false,
	noteEditor: false
});

export type LazyDialog = keyof typeof requested | "moveToAccount";

/** Each dialog's code. Replaceable, so a test can make one fail to load. */
export const dialogLoaders: Record<LazyDialog, () => Promise<{ default: Component }>> = {
	share: () => import("./ShareDialog.svelte"),
	restoreVersion: () => import("./RestoreVersionDialog.svelte"),
	clearData: () => import("./ClearDataDialog.svelte"),
	privacy: () => import("./PrivacyDialog.svelte"),
	existingCopy: () => import("./ExistingCopyDialog.svelte"),
	moveToAccount: () => import("./MoveToAccountDialog.svelte"),
	placePicker: () => import("$lib/places/PlacePickerDialog.svelte"),
	notifications: () => import("./NotificationsDialog.svelte"),
	noteEditor: () => import("$lib/notes/NoteEditorDialog.svelte")
};

/** Loads made or under way, by loader (so a replaced loader loads anew). Not reactive state. */
// eslint-disable-next-line svelte/prefer-svelte-reactivity
const loads = new Map<() => Promise<{ default: Component }>, Promise<Component>>();

/**
 * Loads a dialog's component (once). A file that won't load (an older deploy's chunk) offers a
 * reload (`loadLazy`), and the request is undone so the app goes on as if it had been closed:
 * the next opening tries again, and a question in progress resolves as dismissed.
 */
export function loadDialog(key: LazyDialog): Promise<Component> {
	const loader = dialogLoaders[key];
	let load = loads.get(loader);
	if (!load) {
		load = loadLazy(loader).then(
			(module) => module.default,
			(error: unknown) => {
				loads.delete(loader);
				dismiss(key);
				throw error;
			}
		);
		loads.set(loader, load);
	}
	return load;
}

function dismiss(key: LazyDialog): void {
	switch (key) {
		case "share":
			share.open = false;
			break;
		case "restoreVersion":
			resetRestoreVersion();
			restoring.open = false;
			break;
		case "clearData":
			clearData.open = false;
			break;
		case "privacy":
			privacy.open = false;
			break;
		case "existingCopy":
			settleExistingCopy(null);
			break;
		case "placePicker":
			placePicker.open = false;
			break;
		case "notifications":
			notifications.open = false;
			break;
		case "noteEditor":
			noteEditor.open = false;
			break;
		case "moveToAccount":
			// Asked again the next time the app starts.
			return;
	}
	requested[key] = false;
}

// Share

/** A copy to send: its link and file. */
export type ShareCopy = {
	/** The copy link, or `null` when the dashboard is too big for one. */
	url: string | null;
	/** Why there is no copy link: `"read-only"` (a newer or invalid document) or `"too-big"`. */
	linkUnavailable: "too-big" | "read-only" | null;
	onDownload(): void;
};

/** A dashboard holding an exact location, once each point's region is known. */
export type SharePoints = {
	/** Each point as its region: what the copy link and file share by default. */
	swapped: ShareCopy;
	/** The exact copy, offered only after "Share my exact location instead" (each opening). */
	exact: ShareCopy;
	/** How the notice and "Use … instead" name the regions. */
	summary: SwapSummary;
	/**
	 * Live link: swaps the owner's points for their regions as one undoable edit and stores it
	 * (so the next upload carries it). `"stale"`, changing nothing, when the dashboard holds a
	 * point this lookup didn't cover (look up again).
	 */
	useRegion(): Promise<"applied" | "stale">;
};

export type ShareOptions = {
	/**
	 * The dashboard a live link shares; `null` signed out or for a read-only dashboard (the copy
	 * link and file only). The starter is copied before it's shared.
	 */
	live: { docId: string } | null;
} & (
	| (ShareCopy & { points?: null })
	| {
			/**
			 * The dashboard holds an exact location: the dialog offers no link or file until this
			 * resolves, and asks before a live link. It rejects when a region can't be looked up
			 * (Retry calls it again); `signal` aborts when the dialog closes.
			 */
			points: (signal: AbortSignal) => Promise<SharePoints>;
	  }
);

export const share = $state<{ open: boolean; opts: ShareOptions | null }>({
	open: false,
	opts: null
});

/** Opens the Share dialog. */
export function openShare(opts: ShareOptions): void {
	share.opts = opts;
	share.open = true;
	requested.share = true;
}

// Restore an earlier version

type RestoreState = {
	open: boolean;
	loading: boolean;
	versions: EarlierVersion[];
	account: AccountStatus;
	/** The list couldn't be made at all (a failure on this device). */
	loadFailed: boolean;
	selected: number;
	restore: ((version: EarlierVersion) => Promise<RestoreResult>) | null;
	failure: RestoreResult | null;
};

export const restoring = $state<RestoreState>({
	open: false,
	loading: false,
	versions: [],
	account: "none",
	loadFailed: false,
	selected: 0,
	restore: null,
	failure: null
});

let opening = 0;

/** Closing starts over: the next opening shows a fresh list. */
export function resetRestoreVersion(): void {
	opening++;
	restoring.versions = [];
	restoring.account = "none";
	restoring.loadFailed = false;
	restoring.selected = 0;
	restoring.restore = null;
	restoring.failure = null;
	restoring.loading = false;
}

/**
 * Opens the Restore dialog. `load` lists the earlier versions, newest first; `restore` applies the
 * chosen one and says how it went. The dialog closes only when it says `"restored"`.
 */
export function openRestoreVersion(
	load: () => Promise<EarlierVersions>,
	restore: (version: EarlierVersion) => Promise<RestoreResult>
): void {
	const mine = ++opening;
	restoring.versions = [];
	restoring.account = "none";
	restoring.loadFailed = false;
	restoring.selected = 0;
	restoring.restore = restore;
	restoring.failure = null;
	restoring.loading = true;
	restoring.open = true;
	requested.restoreVersion = true;
	load()
		.then((loaded) => {
			if (mine !== opening) return;
			restoring.versions = loaded.versions;
			restoring.account = loaded.account;
		})
		.catch(() => {
			// Listing failed on this device (the account's failures come back as a status).
			if (mine !== opening) return;
			restoring.loadFailed = true;
		})
		.finally(() => {
			if (mine === opening) restoring.loading = false;
		});
}

// Clear my data, and Your data and privacy

export const clearData = $state({ open: false });

/** Opens the "Clear my data" dialog. */
export function openClearData(): void {
	clearData.open = true;
	requested.clearData = true;
}

export const privacy = $state({ open: false });

/** Opens the "Your data and privacy" dialog. */
export function openPrivacy(): void {
	privacy.open = true;
	requested.privacy = true;
}

// A copy already made

export type ExistingCopyChoice = "open" | "new";

export const existingCopy = $state<{ open: boolean; copy: DashboardSummary | null }>({
	open: false,
	copy: null
});
let resolver: ((choice: ExistingCopyChoice | null) => void) | null = null;

/** Closes the question with the person's choice (`null`: none). */
export function settleExistingCopy(choice: ExistingCopyChoice | null): void {
	existingCopy.open = false;
	const resolve = resolver;
	resolver = null;
	resolve?.(choice);
}

/** Asks what to do about a copy already made. */
export function askExistingCopy(copy: DashboardSummary): Promise<ExistingCopyChoice | null> {
	settleExistingCopy(null);
	existingCopy.copy = copy;
	existingCopy.open = true;
	requested.existingCopy = true;
	return new Promise((resolve) => (resolver = resolve));
}

// The place picker

export const placePicker = $state<{
	open: boolean;
	/** The widget whose place it changes; `null` for the dashboard's place (its bar). */
	widgetId: string | null;
	/** Counts the openings, so each one starts fresh. */
	opening: number;
	/** What had focus when it opened (focus returns there, or to the widget when it's gone). */
	opener: HTMLElement | null;
}>({ open: false, widgetId: null, opening: 0, opener: null });

/**
 * Opens the place picker for a widget, or with `dashboardPlace` for the dashboard's "Change
 * place" bar. Done changes a widget's place in one undoable edit; the bar's place changes the
 * starter (no copy, no undo) or, on a copy, its widgets at that place (one undoable edit).
 */
export function openPlacePicker(opts: { widgetId: string } | { dashboardPlace: true }): void {
	placePicker.widgetId = "widgetId" in opts ? opts.widgetId : null;
	placePicker.opening++;
	placePicker.opener =
		typeof document !== "undefined" && document.activeElement instanceof HTMLElement
			? document.activeElement
			: null;
	placePicker.open = true;
	requested.placePicker = true;
}

// The notifications switch

export const notifications = $state<{ open: boolean; docId: string | null; opening: number }>({
	open: false,
	docId: null,
	opening: 0
});

/** Opens the notifications switch for a dashboard (a preference on this device, per dashboard). */
export function openNotifications(docId: string): void {
	notifications.docId = docId;
	notifications.opening++;
	notifications.open = true;
	requested.notifications = true;
}

// The Note editor

export const noteEditor = $state<{
	open: boolean;
	/** The Note it edits. */
	widgetId: string | null;
	/** Counts the openings, so each one starts fresh. */
	opening: number;
	/** What had focus when it opened (focus returns there, or to the widget when it's gone). */
	opener: HTMLElement | null;
}>({ open: false, widgetId: null, opening: 0, opener: null });

/** Opens the Note editor for a Note; Save writes its text in one undoable edit. */
export function openNoteEditor(opts: { widgetId: string }): void {
	noteEditor.widgetId = opts.widgetId;
	noteEditor.opening++;
	noteEditor.opener =
		typeof document !== "undefined" && document.activeElement instanceof HTMLElement
			? document.activeElement
			: null;
	noteEditor.open = true;
	requested.noteEditor = true;
}
