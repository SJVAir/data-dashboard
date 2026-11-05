import { z } from "zod";
import { PlaceRefSchema, type PlaceRef } from "$lib/data/schema";
import type { Platform, SpaceId } from "$lib/platform/types";

export const RECENT_KEY = "places.recent";
export const RECENT_MAX = 8;

export type RecentRef = Exclude<PlaceRef, { kind: "point" } | { kind: "default-place" }>;

const RecentRefSchema = z.discriminatedUnion("kind", [
	PlaceRefSchema.options[0],
	PlaceRefSchema.options[1],
	PlaceRefSchema.options[2]
]);
const RecentSchema = z.array(RecentRefSchema).max(RECENT_MAX);

function same(a: RecentRef, b: RecentRef): boolean {
	if (a.kind === "monitor" && b.kind === "monitor") return a.id === b.id;
	if (a.kind === "region" && b.kind === "region") return a.type === b.type && a.code === b.code;
	if (a.kind === "location" && b.kind === "location") {
		return a.source === b.source && a.code === b.code;
	}
	return false;
}

/** The recently picked places, newest first; a stored value that fails the schema reads as empty. */
export async function readRecent(platform: Platform, space: SpaceId): Promise<RecentRef[]> {
	const stored = await platform.preferences.get<unknown>(space, RECENT_KEY);
	const parsed = RecentSchema.safeParse(stored);
	return parsed.success ? parsed.data : [];
}

/** Puts a place first, moving an earlier pick of it up; points and the default place are ignored. */
export async function addRecent(platform: Platform, space: SpaceId, ref: PlaceRef): Promise<void> {
	if (ref.kind === "point" || ref.kind === "default-place") return;
	const rest = (await readRecent(platform, space)).filter((r) => !same(r, ref));
	await platform.preferences.set(space, RECENT_KEY, [ref, ...rest].slice(0, RECENT_MAX));
}
