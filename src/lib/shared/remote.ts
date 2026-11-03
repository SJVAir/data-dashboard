import type { RemoteDocuments } from "$lib/sync/remote";

let remote: Promise<RemoteDocuments> | null = null;

/** The documents remote, loaded on demand; works signed out. One per page load. */
export function sharedRemote(): Promise<RemoteDocuments> {
	remote ??= import("$lib/sync/remote-sdk").then(
		({ createSdkRemote }) => createSdkRemote(),
		(error: unknown) => {
			// A chunk that won't load: the next call tries again.
			remote = null;
			throw error;
		}
	);
	return remote;
}
