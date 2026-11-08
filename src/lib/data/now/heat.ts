import { getHeatForPlace } from "@sjvair/sdk";
import { todayPacific } from "$lib/format";
import type { AdapterContext } from "../adapters/registry";
import { isNotFound, layerTarget, placeCandidates } from "../adapters/targets";
import type { Level } from "../metadata";
import type { Layer } from "../schema";
import type { Target, UnavailableReason } from "../types";
import type { NowSource } from "./client";
import { targetKey } from "./forecast-days";

export type HeatToday = {
	level: Level | undefined;
	/** Set when the place covers more than one ZIP: the ZIP that set the highest score. */
	highest?: { zip: string; placeName: string };
} | null; // no score today

/** The target a heat request is about: a ZIP-covered place, or `null` when it has no ZIP. */
function heatTarget(target: Target): Target | null {
	if (target.kind === "all") return null;
	if (target.kind !== "fallback") return target;
	// A school or point answers for its ZIP only: a city or county would be a different place.
	const zips = target.keys.filter((k) => k.startsWith("zipcode:"));
	return zips.length ? { ...target, keys: zips.slice(0, 1) } : null;
}

/**
 * Today's CalHeatScore for a layer's place, as a now source (polled each hour). A school or point
 * uses its ZIP; a place without one is `{ unavailable: "place-unsupported" }`.
 */
export async function heatSource(
	layer: Layer,
	ctx: AdapterContext,
	now: () => Date,
	signal?: AbortSignal
): Promise<NowSource<HeatToday> | { unavailable: UnavailableReason }> {
	const target = await layerTarget(layer, ctx, signal);
	if ("unavailable" in target) return target;
	const wanted = heatTarget(target);
	if (!wanted) return { unavailable: "place-unsupported" };
	return {
		key: `heat:${targetKey(wanted)}`,
		cadence: "hour",
		fetch: async (s) => {
			const today = todayPacific(now());
			const [groups, levels] = await Promise.all([
				placeCandidates(wanted, ctx, s),
				ctx.metadata.datasetLevels("calheatscore", "heat-score", s)
			]);
			const candidate = groups[0]?.[0];
			if (!candidate) return null;
			let response: Awaited<ReturnType<typeof getHeatForPlace>>;
			try {
				response = await getHeatForPlace(candidate.ref, { date: today }, { signal: s });
			} catch (error) {
				// "No such region": nothing to say about today.
				if (isNotFound(error)) return null;
				throw error;
			}
			const day = response.days.find((d) => d.date === today);
			if (!day) return null;
			return {
				level: levels.find((l) => l.value === String(day.score)),
				...(response.zip_count > 1 && {
					highest: { zip: day.zipcode, placeName: candidate.info.name }
				})
			};
		}
	};
}
