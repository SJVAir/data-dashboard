import { LIMITS } from "$lib/data/schema";
import type { Platform, SpaceId } from "$lib/platform/types";
import { z } from "$lib/zod";
import type { Told } from "./firing";

/** Preference key (per space and dashboard, as `thresholdTold:<id>`): "last told" by widget id. */
export const TOLD_KEY = "thresholdTold";

/** As many entries as a dashboard could watch; anything bigger isn't ours. */
const TOLD_MAX = 500;

const ToldSchema = z.object({
	level: z.string().max(LIMITS.CODE_MAX).nullable(),
	at: z.number().finite()
});
const ToldMapSchema = z
	.record(z.string().max(LIMITS.ID_MAX), ToldSchema)
	.refine((map) => Object.keys(map).length <= TOLD_MAX);

const keyFor = (docId: string) => `${TOLD_KEY}:${docId}`;

/** What this browser last told about each of a dashboard's widgets; `{}` if unset or invalid. */
export async function readTold(
	p: Pick<Platform, "preferences">,
	space: SpaceId,
	docId: string
): Promise<Record<string, Told>> {
	try {
		const parsed = ToldMapSchema.safeParse(await p.preferences.get(space, keyFor(docId)));
		return parsed.success ? parsed.data : {};
	} catch {
		return {};
	}
}

/** Stores the map, keeping only the widget ids in `keep` (those still watched). */
export async function writeTold(
	p: Pick<Platform, "preferences">,
	space: SpaceId,
	docId: string,
	map: Record<string, Told>,
	keep: Iterable<string>
): Promise<void> {
	const ids = new Set(keep);
	const pruned = Object.fromEntries(Object.entries(map).filter(([id]) => ids.has(id)));
	await p.preferences.set(space, keyFor(docId), pruned);
}
