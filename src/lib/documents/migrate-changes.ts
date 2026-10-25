import { ChangeSchema, type Change } from "$lib/changes/types";
import { migrations, type Migration } from "./load";
import { CURRENT_SCHEMA_VERSION } from "./schema";

/**
 * Carry pending changes written in an older format up to the current one. Each change runs
 * through every step from `fromVersion`; changes a step can't carry over, and results that
 * don't validate, are dropped and counted.
 */
export function upgradeChanges(
	changes: unknown[],
	fromVersion: number,
	chain: Migration[] = migrations
): { changes: Change[]; dropped: number } {
	const upgraded: Change[] = [];
	let dropped = 0;
	for (const original of changes) {
		let current: unknown = original;
		let version = fromVersion;
		try {
			while (current !== null && version < CURRENT_SCHEMA_VERSION) {
				const step = chain.find((m) => m.from === version);
				if (!step || step.to <= step.from) {
					current = null;
					break;
				}
				current = step.migrateChange(current);
				version = step.to;
			}
		} catch {
			current = null;
		}
		const parsed = current === null ? null : ChangeSchema.safeParse(current);
		if (parsed?.success) upgraded.push(parsed.data);
		else dropped++;
	}
	return { changes: upgraded, dropped };
}
