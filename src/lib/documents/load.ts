import type { z } from "$lib/zod";
import { report } from "$lib/safety/report";
import { CURRENT_SCHEMA_VERSION, DashboardSchema, type Dashboard } from "./schema";

export type Migration = {
	from: number;
	to: number;
	/** Must not mutate its input. */
	migrate(raw: unknown): unknown;
	/**
	 * Carries one pending change from `from` to `to`; `null` means it can't be carried over.
	 * Must not mutate its input.
	 */
	migrateChange(change: unknown): unknown | null;
	/** Validates the input version. */
	schema: z.ZodType;
};

export type LoadResult =
	| { status: "ok"; doc: Dashboard; upgraded: boolean }
	| { status: "read-only"; reason: "newer" | "invalid"; raw: unknown };

/** The app's migration chain (empty until the format freezes). */
export const migrations: Migration[] = [];

function readOnly(reason: "newer" | "invalid", raw: unknown): LoadResult {
	return { status: "read-only", reason, raw };
}

function readVersion(raw: unknown): number | null {
	if (typeof raw !== "object" || raw === null) return null;
	const version = (raw as { schemaVersion?: unknown }).schemaVersion;
	return typeof version === "number" && Number.isInteger(version) ? version : null;
}

/** Upgrade old documents; open newer or invalid ones read-only instead of throwing. */
export function loadDashboard(raw: unknown, chain: Migration[] = migrations): LoadResult {
	let version = readVersion(raw);
	if (version === null) return readOnly("invalid", raw);
	if (version > CURRENT_SCHEMA_VERSION) return readOnly("newer", raw);

	let current = raw;
	let upgraded = false;
	try {
		while (version !== CURRENT_SCHEMA_VERSION) {
			const step = chain.find((m) => m.from === version);
			if (!step || step.to <= step.from) return readOnly("invalid", raw);
			if (!step.schema.safeParse(current).success) return readOnly("invalid", raw);
			current = step.migrate(current);
			version = step.to;
			upgraded = true;
		}
	} catch (error) {
		// A migration that throws is a bug in the app, not a bad document.
		report(error, { operation: "migrate", fromSchemaVersion: readVersion(raw) });
		return readOnly("invalid", raw);
	}

	const parsed = DashboardSchema.safeParse(current);
	if (!parsed.success) return readOnly("invalid", raw);
	return { status: "ok", doc: parsed.data, upgraded };
}
