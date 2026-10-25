import type { Platform, SpaceId } from "$lib/platform/types";

/** Preference key: fingerprint → ids of the copies this space made from that content. */
export const COPY_FINGERPRINTS_KEY = "copyFingerprints";

type Table = Record<string, string[]>;

async function read(platform: Platform, space: SpaceId): Promise<Table> {
	const value = await platform.preferences.get<unknown>(space, COPY_FINGERPRINTS_KEY);
	return typeof value === "object" && value !== null && !Array.isArray(value)
		? (value as Table)
		: {};
}

function write(platform: Platform, space: SpaceId, table: Table): Promise<void> {
	return platform.preferences.set(space, COPY_FINGERPRINTS_KEY, table);
}

const idsOf = (table: Table, fingerprint: string): string[] => {
	const ids = Object.hasOwn(table, fingerprint) ? table[fingerprint] : [];
	return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === "string") : [];
};

export async function rememberCopy(
	platform: Platform,
	space: SpaceId,
	fingerprint: string,
	docId: string
): Promise<void> {
	const table = await read(platform, space);
	const ids = idsOf(table, fingerprint);
	if (ids.includes(docId)) return;
	await write(platform, space, { ...table, [fingerprint]: [...ids, docId] });
}

export async function copiesOf(
	platform: Platform,
	space: SpaceId,
	fingerprint: string
): Promise<string[]> {
	return idsOf(await read(platform, space), fingerprint);
}

export async function fingerprintOf(
	platform: Platform,
	space: SpaceId,
	docId: string
): Promise<string | undefined> {
	const table = await read(platform, space);
	return Object.keys(table).find((fingerprint) => idsOf(table, fingerprint).includes(docId));
}

export async function forgetDocument(
	platform: Platform,
	space: SpaceId,
	docId: string
): Promise<void> {
	const table = await read(platform, space);
	const next: Table = {};
	for (const fingerprint of Object.keys(table)) {
		const ids = idsOf(table, fingerprint).filter((id) => id !== docId);
		if (ids.length > 0) next[fingerprint] = ids;
	}
	await write(platform, space, next);
}
