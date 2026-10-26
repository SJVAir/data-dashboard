import type { DashboardSummary } from "$lib/documents/names";
import { todayPacific } from "$lib/format";
import type { Platform, Protection, SpaceId } from "$lib/platform/types";

/** Preference key (per space) for the backup reminder's state. */
export const REMINDER_KEY = "backupReminder";

export type ReminderPrefs = {
	lastBackupAt?: string;
	lastShownAt?: string;
	/** "Don't remind me again". */
	off?: boolean;
	/** The person refused the browser's storage-protection prompt. */
	persistRefused?: boolean;
};

/** Merges `patch` into the stored reminder state. */
export async function updateReminderPrefs(
	platform: Platform,
	space: SpaceId,
	patch: ReminderPrefs
): Promise<void> {
	const stored = await platform.preferences.get<ReminderPrefs>(space, REMINDER_KEY);
	const base = typeof stored === "object" && stored !== null ? stored : {};
	await platform.preferences.set(space, REMINDER_KEY, { ...base, ...patch });
}

export const REMINDER_INTERVAL_MS = 14 * 24 * 60 * 60 * 1000;

/**
 * Whether to show the backup reminder: only when storage isn't protected, never on the first
 * Pacific day of the space's first dashboard, only when something changed since the last
 * backup, and at most once every 14 days.
 */
export function shouldShowReminder(input: {
	protection: Protection;
	dashboards: DashboardSummary[];
	prefs: ReminderPrefs;
	now: Date;
}): boolean {
	const { protection, dashboards, prefs, now } = input;
	if (protection === "protected" || prefs.off || dashboards.length === 0) return false;

	const first = dashboards.reduce(
		(a, b) => (b.createdAt < a ? b.createdAt : a),
		dashboards[0].createdAt
	);
	if (todayPacific(now) <= todayPacific(new Date(first))) return false;

	// An unreadable backup time counts as no backup.
	const backedUp = prefs.lastBackupAt ? new Date(prefs.lastBackupAt).getTime() : NaN;
	if (
		!Number.isNaN(backedUp) &&
		!dashboards.some((d) => new Date(d.updatedAt).getTime() > backedUp)
	) {
		return false;
	}
	if (prefs.lastShownAt !== undefined) {
		// An unreadable shown time counts as "just now", so a corrupt value can't nag every load.
		const shown = new Date(prefs.lastShownAt).getTime();
		if (Number.isNaN(shown) || now.getTime() - shown < REMINDER_INTERVAL_MS) return false;
	}
	return true;
}
