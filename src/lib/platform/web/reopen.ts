/**
 * Holds a connection and runs operations on it. If the browser closed the connection under us
 * (`InvalidStateError`), it opens a new one once and retries; if that fails the error goes to
 * the caller (the session shows "couldn't save"). After `stop()` — another tab is upgrading the
 * database — it never reopens, so the other tab isn't blocked.
 */
export function createReopening<DB>(open: () => Promise<DB>, initial: DB) {
	let db = initial;
	let stopped = false;
	return {
		stop(): void {
			stopped = true;
		},
		async run<T>(operation: (db: DB) => Promise<T>): Promise<T> {
			try {
				return await operation(db);
			} catch (error) {
				if (stopped || !(error instanceof DOMException) || error.name !== "InvalidStateError") {
					throw error;
				}
				db = await open();
				return operation(db);
			}
		}
	};
}
