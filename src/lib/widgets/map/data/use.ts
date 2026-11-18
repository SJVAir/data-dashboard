import {
	getPesticideSections,
	getPesticideTownships,
	type PesticideSectionFeature,
	type PesticideTownshipFeature,
	type PesticideUseClass,
	type PesticideUseClasses
} from "@sjvair/sdk";
import type { Bounds } from "@sjvair/map-sdk";
import { encodeRef, type MapFeatureProperties } from "@sjvair/map-sdk/data";
import type { Feature, Geometry } from "geojson";
import { toUseParams } from "$lib/data/adapters/pesticides";
import { untilAborted } from "$lib/data/metadata";
import { codesKnown, FilterGone, filterLabels } from "$lib/data/pesticide-meta";
import type { PesticideFilters } from "$lib/data/schema";
import { periodKey, type UsePeriod } from "../use-period";
import { filtersKey } from "./filters-key";
import { USE_FIELDS } from "./use-fields";
import { townshipOfSection } from "./use-geometry";
import type { UseLevel, UseScaleInfo } from "./use-scale";

/**
 * What the use layer draws: the figure, the period, the layer's filters, and the figure's label,
 * units and precision (the catalog's, for the scale's level labels).
 */
export type UseQuery = {
	figure: string;
	period: UsePeriod;
	filters: PesticideFilters;
	info: UseScaleInfo;
};

/** One township or section on the map. */
export type UseProps = MapFeatureProperties & {
	level: UseLevel;
	/** The township's PLSS id, or the section's id (for its details). */
	id: string;
	/** The county a section's use is filed under; null for a township, or when the server has none. */
	county: string | null;
	/** The township's PLSS id: its own, or the one a section is in. */
	township: string;
	/** How many sections make up a township; absent on a section. */
	sections?: number;
	lbs_chemical: number;
	acres_treated: number;
	applications: number;
};

export type UseLoaded = {
	classes: PesticideUseClasses;
	features: Feature<Geometry, UseProps>[];
};

/** The server refused the box (more sections than it serves at once): zoom in. */
export class TooLarge extends Error {
	constructor() {
		// The server's own message carries no coordinates; the request's URL does, so it's dropped.
		super("bbox too large; zoom in");
		this.name = "TooLarge";
	}
}

/**
 * The query's key: the period and the order-independent filters. Not the figure: one response
 * carries every figure.
 */
export function useQueryKey(q: UseQuery): string {
	return `${periodKey(q.period)}|${filtersKey(q.filters)}`;
}

/** The response's property holding `figure`, if the figure is one the map draws. */
export function useField(figure: string): keyof PesticideUseClasses | undefined {
	return USE_FIELDS[figure as keyof typeof USE_FIELDS];
}

/** The classes of `figure`; none (an empty scale) for a figure the map doesn't draw. */
export function useClassesOf(classes: PesticideUseClasses, figure: string): PesticideUseClass {
	const field = useField(figure);
	return field ? classes[field] : { breaks: [], min: null, colors: [] };
}

/** The same features with `value` set to `figure`'s total. */
export function withFigure(
	features: Feature<Geometry, UseProps>[],
	figure: string
): Feature<Geometry, UseProps>[] {
	const field = useField(figure);
	return features.map((f) => {
		const value = field ? f.properties[field] : null;
		return f.properties.value === value ? f : { ...f, properties: { ...f.properties, value } };
	});
}

const periodParams = (p: UsePeriod) => ({
	year: p.year,
	...(p.month !== null && { month: p.month })
});

const ref = (prefix: "township" | "section", id: string) =>
	encodeRef({ kind: "feature", id: `${prefix}:${id}` });

function townshipFeature(
	f: PesticideTownshipFeature,
	geometry: Geometry,
	figure: string
): Feature<Geometry, UseProps> {
	const p = f.properties;
	const field = useField(figure);
	return {
		type: "Feature",
		id: f.id,
		geometry,
		properties: {
			refKey: ref("township", p.id),
			name: p.name,
			value: field ? p[field] : null,
			level: "township",
			id: p.id,
			county: null,
			township: p.id,
			sections: p.sections,
			lbs_chemical: p.lbs_chemical,
			acres_treated: p.acres_treated,
			applications: p.applications
		}
	};
}

function sectionFeature(
	f: PesticideSectionFeature & { geometry: Geometry },
	figure: string
): Feature<Geometry, UseProps> {
	const p = f.properties;
	const field = useField(figure);
	return {
		type: "Feature",
		id: f.id,
		geometry: f.geometry,
		properties: {
			refKey: ref("section", p.id),
			name: p.mtrs,
			value: field ? p[field] : null,
			level: "section",
			id: p.id,
			county: p.county,
			township: townshipOfSection(p.mtrs),
			lbs_chemical: p.lbs_chemical,
			acres_treated: p.acres_treated,
			applications: p.applications
		}
	};
}

type Townships = { classes: PesticideUseClasses; features: PesticideTownshipFeature[] };

/** Every township's outline, by id: asked for once, then joined to the values-only answers. */
const outlines = new Map<string, Geometry>();
/** The townships per query key: shared while in flight, kept once answered, dropped on failure. */
const townshipRequests = new Map<string, Promise<Townships>>();
/** The sections per query and box, shared only while in flight. */
const sectionAnswers = new Map<
	string,
	Promise<{ classes: PesticideUseClasses; features: PesticideSectionFeature[] }>
>();

/** Forgets every remembered outline and request (for tests). */
export function resetUseCaches(): void {
	outlines.clear();
	townshipRequests.clear();
	sectionAnswers.clear();
}

async function askTownships(q: UseQuery): Promise<Townships> {
	const base = { ...periodParams(q.period), ...toUseParams(q.filters), classes: true as const };
	const known = outlines.size > 0;
	let answer = await getPesticideTownships(known ? { ...base, geometry: false } : base);
	// A township the remembered outlines lack (the grid was reimported): ask again with them.
	if (known && answer.features.some((f) => !f.geometry && !outlines.has(f.id))) {
		answer = await getPesticideTownships(base);
	}
	for (const f of answer.features) if (f.geometry) outlines.set(f.id, f.geometry as Geometry);
	return { classes: answer.classes, features: answer.features };
}

/**
 * Whether `error` is the server's 400 (the SDK keeps the response as the error's cause). Every 400
 * from `sections/` is read as `TooLarge` (a bbox over the server's cap), though the server also
 * answers 400 for a bad year or filter. That's safe today: the townships load first with the same
 * params and would fail on them first, so a 400 that reaches `sections/` is the bbox. The server's
 * English message isn't matched (it's wording, not a contract).
 */
function isBadRequest(error: unknown): boolean {
	const cause = error instanceof Error ? (error.cause as { result?: { status?: number } }) : null;
	return cause?.result?.status === 400;
}

/**
 * The valley's townships for `q`, with the year-wide classes. Callers at once share one request
 * per key; a caller's `signal` stops only its own wait. A failed request is dropped, so the next
 * call asks again. Only the first request ever carries outlines; later ones are joined to them.
 */
export async function townshipsFor(q: UseQuery, signal?: AbortSignal): Promise<UseLoaded> {
	const key = useQueryKey(q);
	let request = townshipRequests.get(key);
	if (!request) {
		const made = askTownships(q);
		made.catch(() => {
			if (townshipRequests.get(key) === made) townshipRequests.delete(key);
		});
		townshipRequests.set(key, made);
		request = made;
	}
	const answer = await untilAborted(request, signal);
	const features: Feature<Geometry, UseProps>[] = [];
	for (const f of answer.features) {
		const geometry = (f.geometry as Geometry | null) ?? outlines.get(f.id);
		if (geometry) features.push(townshipFeature(f, geometry, q.figure));
	}
	return { classes: answer.classes, features };
}

/**
 * The sections touching `bbox` for `q`, with the year-wide classes (the same request shared
 * while in flight). A box the server refuses as too large rejects with `TooLarge`.
 */
export async function sectionsFor(
	q: UseQuery,
	bbox: Bounds,
	signal?: AbortSignal
): Promise<UseLoaded> {
	const box: [number, number, number, number] = [bbox.west, bbox.south, bbox.east, bbox.north];
	const key = `${useQueryKey(q)}|${box.join(",")}`;
	let request = sectionAnswers.get(key);
	if (!request) {
		const made = getPesticideSections({
			bbox: box,
			...periodParams(q.period),
			...toUseParams(q.filters),
			classes: true
		}).then(
			(answer) => ({ classes: answer.classes, features: answer.features }),
			(error: unknown) => {
				throw isBadRequest(error) ? new TooLarge() : error;
			}
		);
		const drop = () => {
			if (sectionAnswers.get(key) === made) sectionAnswers.delete(key);
		};
		made.then(drop, drop);
		sectionAnswers.set(key, made);
		request = made;
	}
	const answer = await untilAborted(request, signal);
	const features = answer.features
		.filter((f): f is PesticideSectionFeature & { geometry: Geometry } => f.geometry !== null)
		.map((f) => sectionFeature(f, q.figure));
	return { classes: answer.classes, features };
}

/**
 * Whether a saved chemical, commodity or product the server no longer has, or a code its meta no
 * longer lists, makes use unavailable. Every filter applies to use. Any other failure is left to
 * the fetch, which shows it with Retry.
 */
export async function useFiltersGone(filters: PesticideFilters): Promise<boolean> {
	if (Object.keys(filters).length === 0) return false;
	try {
		const [, known] = await Promise.all([filterLabels(filters), codesKnown(filters)]);
		return !known;
	} catch (error) {
		return error instanceof FilterGone;
	}
}
