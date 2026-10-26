import { m } from "$lib/paraglide/messages.js";

const STEM_MAX = 50;

/** `<slug of the name>-<date>.json`; a name with no letters or digits falls back to "dashboard". */
export function dashboardFileName(displayName: string, today: string): string {
	const slug = displayName
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, STEM_MAX)
		.replace(/-+$/g, "");
	return `${slug || m.file_dashboard_stem()}-${today}.json`;
}

export function backupFileName(today: string): string {
	return `${m.file_backup_stem()}-${today}.json`;
}
