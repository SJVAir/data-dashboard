import { getForecastForPlace } from "@sjvair/sdk";
import { pacificDay, todayPacific } from "$lib/format";
import { latestIssues, type Forecast } from "../adapters/forecasts";
import type { AdapterContext } from "../adapters/registry";
import { isNotFound, layerTarget, placeCandidates } from "../adapters/targets";
import { levelFor, type Level } from "../metadata";
import type { Layer } from "../schema";
import type { PlaceInfo, Target, UnavailableReason } from "../types";
import type { NowSource } from "./client";

export type ForecastDay = {
	/** `YYYY-MM-DD`, Pacific. */
	date: string;
	aqi: number;
	aqiLevel: Level | undefined;
	/** The feed's pollutant, e.g. "PM2.5". */
	pollutant: string;
	/** A status the scale knows is its level; an unknown one is the feed's own text. */
	burn: { level: Level } | { text: string } | null;
};

type Source = { name: string; url: string };

export type ForecastDays = {
	/** Today and tomorrow, whichever exist, in order. */
	days: ForecastDay[];
	/** Dates or timestamps as the feed gives them; the day itself when the feed gives none. */
	airAlert: { start: string; end: string } | null;
	/** `nearest`: the place sits outside every zone and was matched by its center. */
	zone: { name: string; nearest: boolean } | null;
	publishedAt: string | null;
	sources: { aqi: Source | null; burn: Source | null };
	/** The place the forecast answered for (named by the candidate that answered). */
	place: PlaceInfo | null;
};

/** The Pacific date a feed date or timestamp falls on. */
function dayOf(value: string): string {
	return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : todayPacific(new Date(value));
}

/** The source key for a resolved target; never a point's coordinates. */
function targetKey(target: Target): string {
	switch (target.kind) {
		case "monitors":
			return `monitors:${target.ids.join(",")}`;
		case "all":
			return "all";
		case "regions":
			return `regions:${target.keys.join(",")}`;
		default: {
			// How the place was reached shows in the result, so it belongs in the key (no coordinates).
			const via =
				target.via.kind === "location"
					? `location:${target.via.source}:${target.via.code}`
					: "point";
			return `fallback:${via}:${target.keys.join(",")}`;
		}
	}
}

function burnOf(f: Forecast, levels: Level[]): ForecastDay["burn"] {
	const level = levels.find((l) => l.value === f.burn_status);
	if (level) return { level };
	return f.burn_status_text ? { text: f.burn_status_text } : null;
}

async function loadDays(
	target: Target,
	ctx: AdapterContext,
	now: Date,
	signal: AbortSignal
): Promise<ForecastDays> {
	const today = todayPacific(now);
	const tomorrow = todayPacific(new Date(pacificDay(today, 12).getTime() + 24 * 3_600_000));
	const [groups, aqiLevels, burnLevels, aqiSource, burnSource] = await Promise.all([
		placeCandidates(target, ctx, signal),
		ctx.metadata.datasetLevels("forecasts", "aqi-forecast", signal),
		ctx.metadata.datasetLevels("forecasts", "burn-status", signal),
		ctx.metadata.scaleSource("forecasts", "aqi-forecast", signal),
		ctx.metadata.scaleSource("forecasts", "burn-status", signal)
	]);
	const empty: ForecastDays = {
		days: [],
		airAlert: null,
		zone: null,
		publishedAt: null,
		sources: { aqi: aqiSource, burn: burnSource },
		place: null
	};
	const candidates = groups[0] ?? [];
	for (const candidate of candidates) {
		let response: Awaited<ReturnType<typeof getForecastForPlace>>;
		try {
			response = await getForecastForPlace(
				candidate.ref,
				{ gte: today, lte: tomorrow },
				{ signal }
			);
		} catch (error) {
			// "No such region": a fallback tries its next key.
			if (!isNotFound(error)) throw error;
			continue;
		}
		const place: PlaceInfo =
			target.kind === "fallback" ? { ...candidate.info, via: target.via } : candidate.info;
		const issues = latestIssues(response.forecasts)
			.filter((f) => f.forecast_date === today || f.forecast_date === tomorrow)
			.sort((a, b) => a.forecast_date.localeCompare(b.forecast_date));
		const alert = issues.find((f) => {
			if (!f.air_alert) return false;
			const start = dayOf(f.air_alert_start ?? f.forecast_date);
			const end = dayOf(f.air_alert_end ?? f.forecast_date);
			return start <= tomorrow && end >= today;
		});
		return {
			days: issues.map((f) => ({
				date: f.forecast_date,
				aqi: f.aqi_value,
				aqiLevel: levelFor(aqiLevels, f.aqi_value),
				pollutant: f.pollutant,
				burn: burnOf(f, burnLevels)
			})),
			airAlert: alert
				? {
						start: alert.air_alert_start ?? alert.forecast_date,
						end: alert.air_alert_end ?? alert.forecast_date
					}
				: null,
			zone: response.zone
				? { name: response.zone.name, nearest: response.rule === "center" }
				: null,
			publishedAt: issues.reduce<string | null>(
				(latest, f) => (latest === null || f.published_at > latest ? f.published_at : latest),
				null
			),
			sources: empty.sources,
			place
		};
	}
	const last = candidates[candidates.length - 1];
	return {
		...empty,
		place: last
			? target.kind === "fallback"
				? { ...last.info, via: target.via }
				: last.info
			: null
	};
}

/**
 * Today's and tomorrow's forecast for a layer's place, as a now source (polled each hour).
 * `{ unavailable }` for the reasons a layer target gives, and for a layer with no place.
 */
export async function forecastDaysSource(
	layer: Layer,
	ctx: AdapterContext,
	now: () => Date,
	signal?: AbortSignal
): Promise<NowSource<ForecastDays> | { unavailable: UnavailableReason }> {
	const target = await layerTarget(layer, ctx, signal);
	if ("unavailable" in target) return target;
	if (target.kind === "all") return { unavailable: "place-unsupported" };
	return {
		key: `forecast-days:${targetKey(target)}`,
		cadence: "hour",
		fetch: (s) => loadDays(target, ctx, now(), s)
	};
}
