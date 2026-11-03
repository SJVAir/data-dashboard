/**
 * The only entry point app code imports for sync: the worker, the SDK's documents module, and
 * the rest of `src/lib/sync/` load with it, so none of them is in the initial bundle.
 */
import type { SyncContext } from "./context";
import type { SyncWorker } from "./worker.svelte";

export async function loadSyncWorker(ctx: Omit<SyncContext, "remote">): Promise<SyncWorker> {
	const [{ SyncWorker }, { createSdkRemote }] = await Promise.all([
		import("./worker.svelte"),
		import("./remote-sdk")
	]);
	// Stopping the worker aborts its requests.
	const controller = new AbortController();
	return new SyncWorker(
		{ ...ctx, remote: createSdkRemote({ signal: controller.signal }) },
		controller
	);
}
