/**
 * Show as: a draft converted to another widget type, the one place the Data Portal picks which
 * conversion applies (`GetDataView`'s `switchType` and `convertToNow` call it).
 */
import type { CatalogEntry, Level } from "$lib/data/metadata";
import { MAP_TYPE } from "$lib/widgets/map/options";
import { OUTSIDE_TYPE } from "$lib/widgets/outside";
import { getWidgetType, type WidgetType } from "$lib/widgets/registry";
import { offersNow } from "$lib/widgets/time";
import type { Draft } from "./draft.svelte";
import { fromMapDraft, isMapShaped, toMapDraft } from "./map";
import { fromNowDraft, fromRangeDraft, isNowShaped, toNowDraft, type NowConversion } from "./now";

/** What a conversion reads besides the draft. */
export type ShowAsContext = {
	catalog: CatalogEntry[];
	/**
	 * The pollutants the target type offers: the Map's (the monitors meta's `available_pollutants`),
	 * or for "Can we go outside?" the ones with school guidelines. Other types offer them all.
	 */
	allowed: string[];
	/** A now type's new pollutant's scale, or `"unavailable"` (`toNowDraft`). */
	levels: Level[] | "unavailable";
	now: Date;
};

/** Whether `draft` already has now type `type`'s shape (the Map's own, for the Map). */
export function nowShaped(draft: Draft, type: WidgetType, ctx: ShowAsContext): boolean {
	return type.type === MAP_TYPE
		? isMapShaped(draft, ctx.now, ctx.catalog)
		: isNowShaped(draft, type);
}

/** The type `draft` converts from: none for a range draft already marked as a now type. */
export function sourceType(draft: Draft, ctx: ShowAsContext): WidgetType | undefined {
	const from = getWidgetType(draft.type);
	return from && offersNow(from) && !nowShaped(draft, from, ctx) ? undefined : from;
}

/**
 * `draft` as `to`: to the Map `toMapDraft`; to another now type `fromMapDraft` from a Map, else
 * `toNowDraft`; from a now type (the Map too) to a range type `fromMapDraft` or `fromNowDraft`;
 * between range types `fromRangeDraft`. `dropped` says what was left out.
 */
export function showAsDraft(draft: Draft, to: WidgetType, ctx: ShowAsContext): NowConversion {
	const { catalog, allowed, levels, now } = ctx;
	if (to.type === MAP_TYPE) return toMapDraft(draft, catalog, allowed, now);
	const offered = to.type === OUTSIDE_TYPE ? allowed : undefined;
	const fromMap = draft.type === MAP_TYPE;
	if (offersNow(to)) {
		return fromMap
			? fromMapDraft(draft, to, catalog, levels, now, offered)
			: toNowDraft(draft, to, catalog, levels, sourceType(draft, ctx), offered);
	}
	const from = getWidgetType(draft.type);
	if (from && offersNow(from)) {
		return fromMap ? fromMapDraft(draft, to, catalog, "unavailable", now) : fromNowDraft(draft, to);
	}
	return fromRangeDraft(draft, from, to, now);
}
