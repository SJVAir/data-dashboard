import { z } from "$lib/zod";
import { WidgetDataConfigSchema } from "$lib/data/schema";
import type { Platform, SpaceId } from "$lib/platform/types";
import { DEFAULT_LAYER, DEFAULT_RANGE } from "$lib/widgets/defaults";
import { dataTypes } from "$lib/widgets/registry";
import { ChartOptionsSchema } from "$lib/widgets/shared/overlays";
import { CHART_TYPE } from "$lib/widgets/chart";

/** Preference key (per space) for the Get data draft. Preferences stay on this device. */
export const DRAFT_KEY = "getDataDraft";

const SAVE_DELAY_MS = 500;

export const DraftSchema = z.object({
	type: z.string().max(64),
	data: WidgetDataConfigSchema,
	options: ChartOptionsSchema.optional()
});
export type Draft = z.infer<typeof DraftSchema>;

/** A Chart (or `type`) of PM2.5 in Fresno County over the last 30 days. */
export function defaultDraft(type: string = CHART_TYPE): Draft {
	return {
		type,
		data: { layers: [structuredClone(DEFAULT_LAYER)], dateRange: structuredClone(DEFAULT_RANGE) }
	};
}

const isDataType = (type: string) => dataTypes().some((t) => t.type === type);

/**
 * The stored draft, or the default when none is stored or it's invalid (bad shape, unknown
 * type). `type` (the `?type=` link) overrides the stored type when it's a data type.
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
	return type && isDataType(type) ? { ...base, type } : base;
}

let timer: ReturnType<typeof setTimeout> | undefined;

/** Saves the draft after 500 ms without another call. A failed write is dropped. */
export function saveDraft(platform: Platform, space: SpaceId, draft: Draft): void {
	clearTimeout(timer);
	const snapshot = $state.snapshot(draft);
	timer = setTimeout(() => {
		void Promise.resolve(platform.preferences.set(space, DRAFT_KEY, snapshot)).catch(() => {});
	}, SAVE_DELAY_MS);
}
