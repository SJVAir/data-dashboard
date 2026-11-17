import { createRawSnippet, mount, unmount, type Snippet } from "svelte";
import type { FeatureListItem } from "@sjvair/map-sdk";
import type { Scale } from "@sjvair/map-sdk/data";
import type { UseProps } from "./data/use";
import SectionCard from "./SectionCard.svelte";
import TownshipCard from "./TownshipCard.svelte";
import type { UseFigure } from "./use-card";
import type { UsePeriod } from "./use-period";

/** What the use cards read: fixed for one set of plugins, but for the getters. */
export type UseTooltipContext = {
	/** A township's or section's latest properties, by refKey (reactively). */
	current: (refKey: string) => UseProps | undefined;
	/** The scale a level's features are drawn with (reactively); null while it resolves. */
	scale: (props: UseProps) => Scale | null;
	figure: string;
	period: UsePeriod;
	figures: UseFigure[];
	/** The active filters' names (reactively), or null with none. */
	filtersLine: () => string | null;
	/** "Show square miles" on a township. */
	onshow: (refKey: string) => void;
	/** "Zoom in" on a township. */
	onzoom: (item: FeatureListItem) => void;
};

/** A township's or section's card, as the shapes and lens plugins' tooltip snippet. */
export type UseTooltip = (
	item: FeatureListItem,
	props: UseProps,
	interactive: boolean
) => Snippet | undefined;

/**
 * The use plugins' cards, as their tooltip snippets (mounted outside the map's component tree,
 * as `noticeTooltips`'). `interactive` is false for the hover tooltip, which takes no pointer or
 * focus: the card is then a static summary.
 *
 * map-sdk asks for the content again whenever it finds the card's feature again (Tab into the
 * pinned card, and every refetch, which makes new properties for the same feature). A new
 * snippet would mount the card again and drop its focus, so one feature in one form keeps one
 * snippet while its card is mounted, and the card reads the feature's latest properties from
 * `current` by refKey, so a refetch updates it in place.
 */
export function useTooltips(context: UseTooltipContext): UseTooltip {
	const made = new Map<string, Snippet>();
	return (item, props, interactive) => {
		const refKey = props.refKey;
		const key = `${refKey}|${interactive}`;
		const known = made.get(key);
		if (known) return known;
		// The feature as last seen: it stays while map-sdk closes a card whose feature has left
		// the data.
		let last = props;
		const latest = () => {
			const now = context.current(refKey);
			if (now) last = now;
			return last;
		};
		let mounted = 0;
		const snippet = createRawSnippet(() => ({
			render: () => "<div></div>",
			setup(target) {
				mounted++;
				const shared = {
					get props() {
						return latest();
					},
					get scale() {
						return context.scale(latest());
					},
					get filtersLine() {
						return context.filtersLine();
					},
					figure: context.figure,
					figures: context.figures,
					period: context.period,
					interactive
				};
				// The township card adds its buttons; a spread would read the getters once.
				const card =
					props.level === "township"
						? mount(TownshipCard, {
								target,
								props: Object.defineProperties(
									{
										onshow: () => context.onshow(refKey),
										onzoom: () => context.onzoom(item)
									},
									Object.getOwnPropertyDescriptors(shared)
								) as typeof shared & { onshow: () => void; onzoom: () => void }
							})
						: mount(SectionCard, { target, props: shared });
				return () => {
					void unmount(card);
					// Closed: the next card for this feature starts afresh.
					if (--mounted === 0) made.delete(key);
				};
			}
		}));
		made.set(key, snippet);
		return snippet;
	};
}
