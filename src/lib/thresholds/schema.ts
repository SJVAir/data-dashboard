import { CodeSchema } from "$lib/data/schema";
import { z } from "$lib/zod";

/** A saved threshold: the level key to be told about. No entry means Off. */
export const ThresholdSchema = z.object({ level: CodeSchema });
export type Threshold = z.infer<typeof ThresholdSchema>;
