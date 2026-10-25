export type OpenHooks = { onVersionChange: () => void };

/**
 * Holds a connection and runs operations on it. If the browser closed the connection under us
 * (`InvalidStateError`), it opens a new one once and retries; if that fails the error goes to
 * the caller (the session shows "couldn't save"). After the connection reports a version change — another tab is upgrading the
 * database — it never reopens, so the other tab isn't blocked.
 */
export async function createReopening<DB>(open: (hooks: OpenHooks) => Promise<DB>) {
	let stopped = false;
	// Handed to every open, the first and each reopen, so none can miss the upgrade.
	const hooks: OpenHooks = {
		onVersionChange() {
			stopped = true;
		}
	};
	let db = await open(hooks);
	return {
		async run<T>(operation: (db: DB) => Promise<T>): Promise<T> {
			try {
				return await operation(db);
			} catch (error) {
				if (stopped || !(error instanceof DOMException) || error.name !== "InvalidStateError") {
					throw error;
				}
				db = await open(hooks);
				return operation(db);
			}
		}
	};
}
