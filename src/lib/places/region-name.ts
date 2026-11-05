import type { RegionResolver } from "$lib/data/adapters/registry";

/**
 * A region's display name ("ZIP 93721") for a message; its code when the region can't be
 * resolved (unknown, unsupported, the lookup failed, or `signal` aborted).
 */
export async function regionName(
	regions: RegionResolver,
	region: { type: string; code: string },
	signal?: AbortSignal
): Promise<string> {
	const found = await regions.resolve(region.type, region.code, signal).catch(() => null);
	return found && found !== "unsupported" ? found.name : region.code;
}
