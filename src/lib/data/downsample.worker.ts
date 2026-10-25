import { downsample } from "./downsample";
import type { RawReading } from "./downsample";
import type { Period } from "$lib/format/range";

export type DownsampleRequest = {
	id: number;
	points: RawReading[];
	to: Period;
	openFrom?: number;
};

self.onmessage = (event: MessageEvent<DownsampleRequest>) => {
	const { id, points, to, openFrom } = event.data;
	try {
		self.postMessage({ id, result: downsample(points, to, openFrom) });
	} catch (error) {
		self.postMessage({ id, error: error instanceof Error ? error.message : String(error) });
	}
};
