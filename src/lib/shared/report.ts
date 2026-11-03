import { CONTACT_URL } from "$lib/links";
import { BASE } from "$lib/routing";

/**
 * "Report this page" for a shared dashboard: sjvair.com's contact page with the topic set and the
 * page's path (not its full address, so it works from any origin).
 */
export function reportUrl(token: string): string {
	return `${CONTACT_URL}?topic=Report&page=${encodeURIComponent(`${BASE}/shared/${token}`)}`;
}
