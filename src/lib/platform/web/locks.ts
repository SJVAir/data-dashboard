import type { LockAccess } from "../types";

type Waiter = { grant: () => void };

/** An in-process lock queue per name (first come, first served). Also the memory platform's. */
export function createQueueLocks(): LockAccess {
	const queues = new Map<string, { held: boolean; waiting: Waiter[] }>();

	const acquire = (name: string, signal?: AbortSignal): Promise<(() => void) | null> => {
		let q = queues.get(name);
		if (!q) queues.set(name, (q = { held: false, waiting: [] }));
		const queue = q;
		const release = () => {
			const next = queue.waiting.shift();
			if (next) next.grant();
			else {
				queue.held = false;
				if (queues.get(name) === queue) queues.delete(name);
			}
		};
		if (signal?.aborted) return Promise.resolve(null);
		if (!queue.held) {
			queue.held = true;
			return Promise.resolve(release);
		}
		return new Promise((resolve) => {
			const waiter: Waiter = {
				grant: () => {
					signal?.removeEventListener("abort", onAbort);
					resolve(release);
				}
			};
			const onAbort = () => {
				const i = queue.waiting.indexOf(waiter);
				if (i >= 0) queue.waiting.splice(i, 1);
				resolve(null);
			};
			signal?.addEventListener("abort", onAbort, { once: true });
			queue.waiting.push(waiter);
		});
	};

	return {
		async run(name, fn) {
			const release = (await acquire(name))!;
			try {
				return await fn();
			} finally {
				release();
			}
		},
		async hold(name, signal, onGranted) {
			const release = await acquire(name, signal);
			if (!release) return;
			try {
				onGranted();
				if (!signal.aborted) {
					await new Promise<void>((resolve) =>
						signal.addEventListener("abort", () => resolve(), { once: true })
					);
				}
			} finally {
				release();
			}
		}
	};
}

/** Web Locks (`navigator.locks`); falls back to an in-process queue where it's missing. */
export function createWebLocks(nav: { locks?: LockManager } = navigator): LockAccess {
	const locks = nav.locks;
	if (!locks) return createQueueLocks();
	return {
		run: (name, fn) => locks.request(name, () => fn()),
		async hold(name, signal, onGranted) {
			try {
				await locks.request(name, { signal }, () => {
					onGranted();
					return new Promise<void>((resolve) => {
						if (signal.aborted) resolve();
						else signal.addEventListener("abort", () => resolve(), { once: true });
					});
				});
			} catch (error) {
				if (error instanceof DOMException && error.name === "AbortError") return;
				throw error;
			}
		}
	};
}
