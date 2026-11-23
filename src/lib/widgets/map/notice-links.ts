/** Only an http(s) address from the pesticides meta becomes a link; anything else is none. */
export function webHref(url: string | undefined): string | null {
	if (!url) return null;
	try {
		const { protocol } = new URL(url);
		return protocol === "https:" || protocol === "http:" ? url : null;
	} catch {
		return null;
	}
}
