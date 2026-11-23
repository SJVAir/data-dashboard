import { CodeSchema, LIMITS } from "$lib/data/schema";
import { z } from "$lib/zod";

/**
 * A saved threshold: the level key to be told about. No entry means Off. `entryType` is set on
 * Current conditions' thresholds only (one alert level per pollutant).
 */
export const ThresholdSchema = z.object({ level: CodeSchema, entryType: CodeSchema.optional() });
export type Threshold = z.infer<typeof ThresholdSchema>;

/**
 * A widget's thresholds: at most one per pollutant layer (`LAYERS_MAX`), at most one per
 * `entryType`, and at most one without an `entryType` (every type but Current conditions).
 */
export const ThresholdsSchema = z
	.array(ThresholdSchema)
	.max(LIMITS.LAYERS_MAX)
	.refine(
		(list) => {
			const seen = new Set<string>();
			let untagged = 0;
			for (const { entryType } of list) {
				if (entryType === undefined) {
					untagged++;
					if (untagged > 1) return false;
					continue;
				}
				if (seen.has(entryType)) return false;
				seen.add(entryType);
			}
			return true;
		},
		{ message: "Duplicate entryType in thresholds (or more than one without one)" }
	);
