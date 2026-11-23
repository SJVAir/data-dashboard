import { z } from "$lib/zod";
import { WidgetDataConfigSchema } from "$lib/data/schema";
import type { Platform, SpaceId } from "$lib/platform/types";
import { DEFAULT_LAYER, DEFAULT_PLACE, DEFAULT_RANGE } from "$lib/widgets/defaults";
import { dataTypes } from "$lib/widgets/registry";
import { getMetadata } from "$lib/data";
import { MAP_TYPE, MapOptionsSchema } from "$lib/widgets/map/options";
import { tickEveryTypeIfNone } from "./map";
import { ChartOptionsSchema } from "$lib/widgets/shared/overlays";
import { ThresholdsSchema } from "$lib/thresholds/schema";
import { CHART_TYPE } from "$lib/widgets/chart";

/** Preference key (per space) for the Get data draft. Preferences stay on this device. */
export const DRAFT_KEY = "getDataDraft";

const SAVE_DELAY_MS = 500;

export const DraftSchema = z.object({
	type: z.string().max(64),
	data: WidgetDataConfigSchema,
	/** A Map's options (marks, the pollutant showing), else a Chart's (the overlay's place). */
	options: z.union([MapOptionsSchema, ChartOptionsSchema]).optional(),
	/** The alert level (threshold types); none means Off. */
	thresholds: ThresholdsSchema.optional()
});
export type Draft = z.infer<typeof DraftSchema>;

/** A Chart (or `type`) of PM2.5 in Fresno County over the last 30 days. */
export function defaultDraft(type: string = CHART_TYPE): Draft {
	return {
		type,
		data: {
			place: structuredClone(DEFAULT_PLACE),
			layers: [structuredClone(DEFAULT_LAYER)],
			dateRange: structuredClone(DEFAULT_RANGE)
		}
	};
}

const isDataType = (type: string) => dataTypes().some((t) => t.type === type);

/**
 * The stored draft, or the default when none is stored or it's invalid (bad shape, unknown
 * type). `type` (the `?type=` link) overrides the stored type when it's a data type; a Map made
 * that way from another type's draft ticks every monitor type (`tickEveryTypeIfNone`).
 */
export async function loadDraft(platform: Platform, space: SpaceId, type?: string): Promise<Draft> {
	let stored: Draft | undefined;
	try {
		const parsed = DraftSchema.safeParse(await platform.preferences.get(space, DRAFT_KEY));
		if (parsed.success && isDataType(parsed.data.type)) stored = parsed.data;
	} catch {
		// Storage blocked: start from the default.
	}
	const base = stored ?? defaultDraft();
	if (!type || !isDataType(type)) return base;
	const opened: Draft = { ...base, type };
	// A `?type=map` link over another type's draft is a new Map: every monitor type ticked.
	if (type === MAP_TYPE && base.type !== MAP_TYPE) {
		const catalog = await getMetadata()
			.catalog()
			.catch(() => "unavailable" as const);
		if (catalog !== "unavailable") {
			opened.data = structuredClone(opened.data);
			tickEveryTypeIfNone(opened.data, catalog);
		}
	}
	return opened;
}

let timer: ReturnType<typeof setTimeout> | undefined;
/** The write the timer will run, so `flushDraft` can run it early. */
let pendingWrite: (() => void) | undefined;

/** Saves the draft after 500 ms without another call. A failed write is dropped. */
export function saveDraft(platform: Platform, space: SpaceId, draft: Draft): void {
	clearTimeout(timer);
	const snapshot = $state.snapshot(draft);
	pendingWrite = () => {
		pendingWrite = undefined;
		void Promise.resolve(platform.preferences.set(space, DRAFT_KEY, snapshot)).catch(() => {});
	};
	timer = setTimeout(pendingWrite, SAVE_DELAY_MS);
}

/** Writes a pending draft save now (leaving the view, or the page being hidden). */
export function flushDraft(): void {
	clearTimeout(timer);
	pendingWrite?.();
}
