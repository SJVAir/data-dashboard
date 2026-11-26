import { onDestroy, untrack } from "svelte";
import { getQueryClient } from "$lib/data";
import { LiveQuery } from "$lib/data/live-query.svelte";
import type { Layer, PlaceRef, WidgetDataConfig } from "$lib/data/schema";
import { placeName } from "$lib/places/bar-name";
import { formatList, formatNumber } from "$lib/format";
import { m } from "$lib/paraglide/messages.js";
import { drawnMonitors, nowInput } from "../shared/input";
import type { PlaceViewer } from "../shared/viewer";
import { placeLabel } from "../title";
import { setGeneratedTitle } from "../titles.svelte";

/** What the title reads from the tile; each field read on its own. */
export interface MapTitleInput {
	readonly widgetId: string;
	readonly data: WidgetDataConfig;
	/** The layer the Where's name is looked up for (a stand-in with no pollutant). */
	readonly layer: Layer | undefined;
	/** What the Map shows: its pollutant's label, else its other layers' (`mapShowsLabel`). */
	readonly entryLabel: string | undefined;
	/** The Map draws its monitors (it has a pollutant): a lone searched monitor can name it. */
	readonly monitorsShown: boolean;
	readonly idle: boolean;
	readonly supported: boolean;
}

/**
 * What a Map with no pollutant shows, for its title: its layers' names (smoke and fire, spray
 * notices, pesticide use, the fill's region type), joined as a list; undefined with none.
 */
export function mapShowsLabel(names: (string | undefined)[]): string | undefined {
	const shown = names.filter((n): n is string => !!n);
	return shown.length ? formatList(shown) : undefined;
}

/** A Where place named without fetching data: an area or a school (a point needs its region). */
function namedByLookup(place: PlaceRef | undefined): place is Extract<PlaceRef, NamedKind> {
	return place?.kind === "region" || place?.kind === "location";
}
type NamedKind = { kind: "region" } | { kind: "location" };

/**
 * The generated title: what the Map shows (`entryLabel`) with the one place's label, or with no
 * Where the one searched monitor's, or how many places (or searched monitors); with no Where and
 * nothing to count, what it shows alone. A Map with a pollutant names its place from
 * the "now" lookup of the Where alone (not its monitors). A Map with no pollutant names an area
 * or a school by looking its name up (`placeName`, no data fetched), and a point by the "now"
 * lookup (only it gives the viewer-aware region name); until or unless that name is known, it is
 * titled by what it shows alone, so its map always has a name. Call it while a component
 * initialises (it adds effects).
 */
export function syncMapTitle(input: MapTitleInput, viewer: PlaceViewer): void {
	const titleQuery = new LiveQuery(getQueryClient(), null);
	titleQuery.setPolling(false);
	onDestroy(() => titleQuery.destroy());
	const count = $derived.by(() => {
		if (!input.layer) return 0;
		const where = input.data.selection?.ids.length ?? (input.data.place ? 1 : 0);
		if (where > 0 || !input.monitorsShown) return where;
		// No Where: searched monitors alone are counted as places, as a Chart's lines are (ticked
		// types draw nothing with no Where).
		const { monitors, types } = drawnMonitors(input.data);
		return types.length === 0 && monitors.length > 1 ? monitors.length : 0;
	});
	/** A no-pollutant Map's one area or school, named by lookup rather than by a data request. */
	const lookedUp = $derived(
		!input.monitorsShown && count === 1 && namedByLookup(input.data.place)
			? input.data.place
			: undefined
	);
	/** What names the tile: its one Where place (its layer's monitors left out), else its monitor. */
	const named = $derived.by(() => {
		const { layer, data } = input;
		if (!layer || lookedUp) return null;
		if (count === 1) {
			// eslint-disable-next-line @typescript-eslint/no-unused-vars -- left out of the lookup
			const { monitors, monitorTypes, ...where } = layer;
			return nowInput(data, where);
		}
		// The one monitor the Map draws (ticked types draw nothing with no Where).
		const drawn = drawnMonitors(data);
		const lone = drawn.types.length === 0 && drawn.monitors.length === 1;
		return count === 0 && input.monitorsShown && lone ? nowInput(data, layer) : null;
	});
	$effect(() => {
		titleQuery.set(!input.idle && input.supported ? named : null);
	});
	/** The looked-up place's name: `undefined` while it loads, `null` when it can't be named. */
	let lookup = $state.raw<{ key: string; name: string | null } | undefined>();
	const lookupKey = $derived(lookedUp ? JSON.stringify(lookedUp) : null);
	$effect(() => {
		const key = lookupKey;
		const place = untrack(() => lookedUp);
		if (!key || !place || input.idle) return;
		const abort = new AbortController();
		placeName(place, abort.signal).then(
			(name) => {
				if (!abort.signal.aborted) lookup = { key, name };
			},
			() => {
				if (!abort.signal.aborted) lookup = { key, name: null };
			}
		);
		return () => abort.abort();
	});
	$effect(() => {
		const label = input.entryLabel;
		if (!label || input.idle) return;
		const titled = (place: string | null | undefined) =>
			setGeneratedTitle(
				input.widgetId,
				place
					? m.widget_map_title_generated_place({ shows: label, place })
					: m.widget_map_title_generated({ shows: label })
			);
		if (count > 1) {
			titled(m.get_data_places_count({ count: formatNumber(count), countValue: count }));
			return;
		}
		if (lookedUp) {
			titled(lookup?.key === lookupKey ? lookup.name : null);
			return;
		}
		// No Where and no lone monitor to name: what it shows alone.
		if (!named) {
			if (count === 0) titled(null);
			return;
		}
		const s = titleQuery.state;
		const place = s.status === "ready" ? s.data.places[0] : undefined;
		if (place) titled(placeLabel(place, viewer));
		// With no pollutant, a point whose region can't be named is titled by what it shows.
		else if (!input.monitorsShown) titled(null);
	});
}
