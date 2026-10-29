export const BASE = "/workspace";
export const HOME_HREF = "/workspace/";

/** The canonical form of a bare base path, else null: "/workspace" → "/workspace/". */
export function canonicalHome(pathname: string): string | null {
	return pathname === BASE ? HOME_HREF : null;
}

/**
 * For a path no route matches: the dashboard whose page a trimmed path under it goes to
 * (`/dashboards/:id/widgets` → that dashboard), else `null` for the home page.
 */
export function trimmedDashboardId(pathname: string): string | null {
	const match = /^\/dashboards\/([^/]+)\/./.exec(pathname);
	if (!match) return null;
	try {
		return decodeURIComponent(match[1]);
	} catch {
		return null;
	}
}
