import { createRawSnippet, mount, unmount, type Snippet } from "svelte";
import type { NoticeFeatureProperties } from "./data/notices";
import NoticeCard from "./NoticeCard.svelte";

/** The snippets made for each marker's data, by form (see `noticeTooltip`). */
const made = new WeakMap<NoticeFeatureProperties, Map<string, Snippet>>();

/**
 * A notices marker's card, as the points plugin's tooltip snippet (mounted outside the map's
 * component tree, as map-sdk's own cards are). `props` are the marker's source properties, so
 * `notices` is the array itself, not MapLibre's JSON string of it. The notices of one marker
 * share their section and county. `interactive` is false for the hover tooltip, which takes no
 * pointer or focus: the card is then a static summary.
 *
 * map-sdk asks for the content again whenever it finds the card's feature again (e.g. when Tab
 * moves focus from the feature list into the pinned card and the list clears its focused key), and
 * a new snippet mounts the card again, detaching whatever had focus in it. So the same marker data
 * in the same form gets the same snippet back, and the card stays mounted.
 */
export function noticeTooltip(
	props: NoticeFeatureProperties,
	onNow: boolean,
	interactive: boolean
): Snippet | undefined {
	const first = props.notices[0];
	if (!first) return undefined;
	const key = `${onNow}|${interactive}`;
	let forms = made.get(props);
	if (!forms) {
		forms = new Map();
		made.set(props, forms);
	}
	const known = forms.get(key);
	if (known) return known;
	const snippet = createRawSnippet(() => ({
		render: () => "<div></div>",
		setup(target) {
			const card = mount(NoticeCard, {
				target,
				props: {
					notices: props.notices,
					section: first.section,
					county: first.county,
					onNow,
					interactive
				}
			});
			return () => void unmount(card);
		}
	}));
	forms.set(key, snippet);
	return snippet;
}
