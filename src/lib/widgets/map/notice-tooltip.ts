import { createRawSnippet, mount, unmount, type Snippet } from "svelte";
import type { NoticeFeatureProperties } from "./data/notices";
import NoticeCard from "./NoticeCard.svelte";

/**
 * A notices marker's card, as the points plugin's tooltip snippet (mounted outside the map's
 * component tree, as map-sdk's own cards are). `props` are the marker's source properties, so
 * `notices` is the array itself, not MapLibre's JSON string of it. The notices of one marker
 * share their section and county.
 */
export function noticeTooltip(props: NoticeFeatureProperties, onNow: boolean): Snippet | undefined {
	const first = props.notices[0];
	if (!first) return undefined;
	return createRawSnippet(() => ({
		render: () => "<div></div>",
		setup(target) {
			const card = mount(NoticeCard, {
				target,
				props: {
					notices: props.notices,
					section: first.section,
					county: first.county,
					onNow
				}
			});
			return () => void unmount(card);
		}
	}));
}
