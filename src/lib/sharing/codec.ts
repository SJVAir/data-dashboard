import { compressToEncodedURIComponent, decompressFromEncodedURIComponent } from "lz-string";
import { LINK_PREFIX, MAX_INCOMING_FRAGMENT } from "./envelope";

const PAYLOAD_ALPHABET = /^[A-Za-z0-9+\-$]*$/;

/** Compress envelope JSON into a URL-safe link payload. */
export function encodePayload(json: string): string {
	return LINK_PREFIX + compressToEncodedURIComponent(json);
}

/** The envelope JSON, or `null` for a wrong prefix, an oversized fragment, or bad data. */
export function decodePayload(fragment: string): string | null {
	if (fragment.length > MAX_INCOMING_FRAGMENT || !fragment.startsWith(LINK_PREFIX)) return null;
	const payload = payloadOf(fragment.slice(LINK_PREFIX.length));
	if (payload === null) return null;
	try {
		const text = decompressFromEncodedURIComponent(payload);
		return text ? text : null;
	} catch {
		return null;
	}
}

/**
 * The payload in the link alphabet, percent-decoded once if an app on the way encoded it ("$" as
 * "%24", "+" as "%2B"); `null` otherwise. lz-string quietly tolerates stray characters (it turns
 * spaces into "+"), so this checks strictly.
 */
function payloadOf(raw: string): string | null {
	if (PAYLOAD_ALPHABET.test(raw)) return raw;
	try {
		const decoded = decodeURIComponent(raw);
		return PAYLOAD_ALPHABET.test(decoded) ? decoded : null;
	} catch {
		return null;
	}
}
