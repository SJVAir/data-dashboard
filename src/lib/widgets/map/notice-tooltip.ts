import { createRawSnippet, mount, unmount, type Snippet } from "svelte";
import type { NoticeFeatureProperties } from "./data/notices";
import NoticeCard from "./NoticeCard.svelte";

/** A notices marker's card, as the points plugin's tooltip snippet (see `noticeTooltips`). */
export type NoticeTooltip = (
	props: NoticeFeatureProperties,
	onNow: boolean,
	interactive: boolean
) => Snippet | undefined;

/**
 * The notices markers' cards, as the points plugin's tooltip snippets (mounted outside the map's
 * component tree, as map-sdk's own cards are), for one plugin. `props` are a marker's source
 * properties, so `notices` is the array itself, not MapLibre's JSON string of it. The notices of
 * one marker share their section and county. `interactive` is false for the hover tooltip, which
 * takes no pointer or focus: the card is then a static summary.
 *
 * map-sdk asks for the content again whenever it finds the card's feature again: when Tab moves
 * focus from the feature list into the pinned card (the list clears its focused key), and on every
 * notices fetch, which makes new properties for the same marker. A new snippet would mount the card
 * again, detaching whatever had focus in it and closing an open notice. So one marker in one form
 * keeps one snippet while its card is mounted, and the card reads the marker's notices from
 * `current` (its latest properties by refKey, reactively), so a refetch updates it in place.
 */
export function noticeTooltips(
	current: (refKey: string) => NoticeFeatureProperties | undefined
): NoticeTooltip {
	const made = new Map<string, Snippet>();
	return (props, onNow, interactive) => {
		if (!props.notices[0]) return undefined;
		const refKey = props.refKey;
		const key = `${refKey}|${onNow}|${interactive}`;
		const known = made.get(key);
		if (known) return known;
		// The marker as last seen with notices: it stays while map-sdk closes a card whose
		// marker has left the data.
		let last = props;
		const latest = () => {
			const now = current(refKey);
			if (now?.notices[0]) last = now;
			return last;
		};
		let mounted = 0;
		const snippet = createRawSnippet(() => ({
			render: () => "<div></div>",
			setup(target) {
				mounted++;
				const card = mount(NoticeCard, {
					target,
					props: {
						get notices() {
							return latest().notices;
						},
						get section() {
							return latest().notices[0].section;
						},
						get county() {
							return latest().notices[0].county;
						},
						onNow,
						interactive
					}
				});
				return () => {
					void unmount(card);
					// Closed: the next card for this marker starts afresh.
					if (--mounted === 0) made.delete(key);
				};
			}
		}));
		made.set(key, snippet);
		return snippet;
	};
}
