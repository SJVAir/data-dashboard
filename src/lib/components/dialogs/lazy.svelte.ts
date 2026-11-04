// The open state of the dialogs loaded on demand (`LazyDialogs.svelte`, mounted in the app root).
// Their code stays out of the initial bundle: each loads on its first opening and then stays
// mounted. The `open…()` functions live here, so callers don't import the dialogs themselves.
import type { DashboardSummary } from "$lib/documents/names";
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
	existingCopy: false
});

// Share

export type ShareOptions = {
	/** The copy link, or `null` when the dashboard is too big for one. */
	url: string | null;
	/** Why there is no copy link: `"read-only"` (a newer or invalid document) or `"too-big"`. */
	linkUnavailable: "too-big" | "read-only" | null;
	onDownload(): void;
	/**
	 * The dashboard a live link shares; `null` signed out, for the starter, or for a read-only
	 * dashboard (the copy link and file only).
	 */
	live: { docId: string } | null;
};

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
