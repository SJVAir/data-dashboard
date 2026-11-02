import type { LockAccess } from "../types";

type Mode = "exclusive" | "shared";
type Waiter = { mode: Mode; grant: () => void };
type Queue = { exclusive: boolean; shared: number; waiting: Waiter[] };

/**
 * An in-process lock queue per name (first come, first served; shared holders together, like
 * Web Locks). Also the memory platform's.
 */
export function createQueueLocks(): LockAccess {
	const queues = new Map<string, Queue>();

	const free = (q: Queue) => !q.exclusive && q.shared === 0;
	const take = (q: Queue, mode: Mode) => {
		if (mode === "exclusive") q.exclusive = true;
		else q.shared++;
	};
	/** Grants the waiters at the front that can go now. */
	const grantNext = (name: string, q: Queue) => {
		while (q.waiting.length > 0) {
			const next = q.waiting[0];
			if (next.mode === "exclusive" ? !free(q) : q.exclusive) break;
			q.waiting.shift();
			take(q, next.mode);
			next.grant();
		}
		if (free(q) && q.waiting.length === 0 && queues.get(name) === q) queues.delete(name);
	};

	const acquire = (
		name: string,
		mode: Mode,
		signal?: AbortSignal
	): Promise<(() => void) | null> => {
		let q = queues.get(name);
		if (!q) queues.set(name, (q = { exclusive: false, shared: 0, waiting: [] }));
		const queue = q;
		const release = () => {
			if (mode === "exclusive") queue.exclusive = false;
			else queue.shared--;
			grantNext(name, queue);
		};
		if (signal?.aborted) {
			grantNext(name, queue);
			return Promise.resolve(null);
		}
		const now = mode === "exclusive" ? free(queue) : !queue.exclusive;
		if (now && queue.waiting.length === 0) {
			take(queue, mode);
			return Promise.resolve(release);
		}
		return new Promise((resolve) => {
			const waiter: Waiter = {
				mode,
				grant: () => {
					signal?.removeEventListener("abort", onAbort);
					resolve(release);
				}
			};
			const onAbort = () => {
				const i = queue.waiting.indexOf(waiter);
				if (i >= 0) queue.waiting.splice(i, 1);
				grantNext(name, queue);
				resolve(null);
			};
			signal?.addEventListener("abort", onAbort, { once: true });
			queue.waiting.push(waiter);
		});
	};

	return {
		async run(name, fn) {
			const release = (await acquire(name, "exclusive"))!;
			try {
				return await fn();
			} finally {
				release();
			}
		},
		async tryRun(name, fn) {
			if (queues.has(name)) return false;
			const release = (await acquire(name, "exclusive"))!;
			try {
				await fn();
				return true;
			} finally {
				release();
			}
		},
		async hold(name, signal, onGranted, opts) {
			const release = await acquire(name, opts?.shared ? "shared" : "exclusive", signal);
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
		},
		// A queue is dropped once nobody holds or waits for it.
		held: async (name) => queues.has(name)
	};
}

/** Web Locks (`navigator.locks`); falls back to an in-process queue where it's missing. */
export function createWebLocks(nav: { locks?: LockManager } = navigator): LockAccess {
	const locks = nav.locks;
	if (!locks) return createQueueLocks();
	return {
		run: (name, fn) => locks.request(name, () => fn()),
		tryRun: (name, fn) =>
			locks.request(name, { ifAvailable: true }, async (lock) => {
				if (!lock) return false;
				await fn();
				return true;
			}),
		async hold(name, signal, onGranted, opts) {
			const mode = opts?.shared ? "shared" : "exclusive";
			try {
				await locks.request(name, { signal, mode }, () => {
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
		},
		async held(name) {
			const { held = [], pending = [] } = await locks.query();
			return [...held, ...pending].some((lock) => lock.name === name);
		}
	};
}
