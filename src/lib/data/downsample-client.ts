import type { Period } from "$lib/format/range";
import { downsample } from "./downsample";
import type { RawReading } from "./downsample";
import type { DownsampleRequest } from "./downsample.worker";
import type { SeriesPoint } from "./types";

type Pending = { resolve: (points: SeriesPoint[]) => void; reject: (reason: unknown) => void };
type Reply = { id: number; result?: SeriesPoint[]; error?: string };

let worker: Promise<Worker> | null = null;
let nextId = 0;
const pending = new Map<number, Pending>();

function failAll(reason: unknown) {
	for (const p of pending.values()) p.reject(reason);
	pending.clear();
	worker = null;
}

/**
 * One worker per session, created on first use. The inline build is a `blob:` URL, because
 * static files are cross-origin in production and a worker script can't load from another origin.
 */
function getWorker(): Promise<Worker> {
	worker ??= import("./downsample.worker.ts?worker&inline").then(({ default: Inline }) => {
		const w = new Inline();
		w.onmessage = (event: MessageEvent<Reply>) => {
			const { id, result, error } = event.data;
			const p = pending.get(id);
			if (!p) return; // aborted: ignore the late reply
			pending.delete(id);
			if (result) p.resolve(result);
			else p.reject(new Error(error ?? "Downsampling failed"));
		};
		w.onerror = (event) => {
			w.terminate();
			failAll(new Error(event.message || "Downsample worker failed"));
		};
		// A reply that can't be deserialized has lost its id, so no single call can be settled.
		// A listener, not `onmessageerror`: Chromium's `Worker` has no such property.
		w.addEventListener("messageerror", () => {
			w.terminate();
			failAll(new Error("Downsample worker sent a message it couldn't read"));
		});
		return w;
	});
	worker.catch((error) => failAll(error));
	return worker;
}

/** Runs `downsample` in a worker, or on the main thread where `Worker` is undefined. */
export async function downsampleInWorker(
	points: RawReading[],
	to: Period,
	openFrom?: number,
	signal?: AbortSignal
): Promise<SeriesPoint[]> {
	signal?.throwIfAborted();
	if (typeof Worker === "undefined") return downsample(points, to, openFrom);
	const w = await getWorker();
	signal?.throwIfAborted();
	const id = nextId++;
	return new Promise<SeriesPoint[]>((resolve, reject) => {
		const onAbort = () => {
			pending.delete(id);
			reject(signal?.reason);
		};
		pending.set(id, {
			resolve: (r) => {
				signal?.removeEventListener("abort", onAbort);
				resolve(r);
			},
			reject: (e) => {
				signal?.removeEventListener("abort", onAbort);
				reject(e);
			}
		});
		signal?.addEventListener("abort", onAbort, { once: true });
		const request: DownsampleRequest = { id, points, to, openFrom };
		w.postMessage(request);
	});
}
