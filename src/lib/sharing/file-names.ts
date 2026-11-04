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

function dataSlug(text: string): string {
	return text
		.normalize("NFKD")
		.replace(/\p{M}+/gu, "")
		.toLowerCase()
		.replace(/['’.]/g, "")
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, STEM_MAX)
		.replace(/-+$/g, "");
}

/**
 * `<pollutant>-<place>-<first date>-to-<last date>.csv`, slugged (lowercase ASCII letters,
 * digits, and hyphens; accents dropped, so "PM2.5" is "pm25"). Dates are Pacific `YYYY-MM-DD`.
 */
export function dataFileName(parts: {
	entryLabel: string;
	placeLabel: string;
	firstDate: string;
	lastDate: string;
}): string {
	const stem = [dataSlug(parts.entryLabel), dataSlug(parts.placeLabel)].filter(Boolean).join("-");
	return `${stem || m.file_data_stem()}-${parts.firstDate}-to-${parts.lastDate}.csv`;
}
