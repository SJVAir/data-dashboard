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
	// lz-string quietly tolerates stray characters (it turns spaces into "+"), so check strictly.
	if (!PAYLOAD_ALPHABET.test(fragment.slice(LINK_PREFIX.length))) return null;
	try {
		const text = decompressFromEncodedURIComponent(fragment.slice(LINK_PREFIX.length));
		return text ? text : null;
	} catch {
		return null;
	}
}
