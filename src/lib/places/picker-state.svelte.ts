import { SvelteMap } from "svelte/reactivity";
import type { PlaceRef } from "$lib/data/schema";
import { formatNumber } from "$lib/format";
import { m } from "$lib/paraglide/messages.js";
import type { GeoResult } from "$lib/platform/types";
import type { PlaceDirectory } from "./directory";
import { MIN_QUERY, searchPlaces, type SearchResult } from "./search";
import { blockReason, toggle, type BlockReason, type PickerMode, type Picks } from "./selection";
import { refOf, type PlaceOption } from "./types";

export const DEBOUNCE_MS = 250;

export type PickerContext = {
	directory: PlaceDirectory;
	entryType: string;
	activeOnly: boolean;
	mode: PickerMode;
	recent: PlaceOption[];
	known: PlaceOption[];
	locate: (signal: AbortSignal) => Promise<GeoResult>;
	pointKeys: (lat: number, lon: number, signal: AbortSignal) => Promise<string[]>;
	ondone: (picks: Picks) => void;
};

export type SectionKey = "recent" | "locations" | "regions" | "monitors";
export type Row = {
	id: string;
	option: PlaceOption;
	ref: PlaceRef;
	reason: string | null;
	selected: boolean;
};
export type Section = { key: SectionKey; label: string; rows: Row[] };
export type GroupKey = "locations" | "regions" | "monitors";
export type GeoState =
	{ status: "idle" } | { status: "locating" } | { status: "message"; text: string };

const GROUPS: GroupKey[] = ["locations", "regions", "monitors"];

function groupLabel(key: SectionKey): string {
	switch (key) {
		case "recent":
			return m.place_picker_recent();
		case "locations":
			return m.place_picker_group_locations();
		case "regions":
			return m.place_picker_group_regions();
		case "monitors":
			return m.place_picker_group_monitors();
	}
}

export function errorText(key: GroupKey): string {
	switch (key) {
		case "locations":
			return m.place_picker_error_locations();
		case "regions":
			return m.place_picker_error_regions();
		case "monitors":
			return m.place_picker_error_monitors();
	}
}

/** A stable key for a ref (names and DOM ids). */
export function refKey(ref: PlaceRef): string {
	switch (ref.kind) {
		case "monitor":
			return `monitor:${ref.id}`;
		case "region":
			return `region:${ref.type}:${ref.code}`;
		case "location":
			return `location:${ref.source}:${ref.code}`;
		case "point":
			return `point:${ref.lat},${ref.lon}`;
		case "default-place":
			return "default-place";
	}
}

/** The picker's search, keyboard, picks, and "Use my location" state; `destroy()` aborts it all. */
export class PickerState {
	query = $state("");
	/** The latest settled search for `query` (kept while a newer one runs). */
	result = $state<SearchResult | null>(null);
	/** Announced once a search settles: whole messages ("12 results", then each failed group's). */
	announcement = $state<string[]>([]);
	picks = $state<Picks>([]);
	activeIndex = $state(-1);
	geo = $state<GeoState>({ status: "idle" });

	readonly #ctx: () => PickerContext;
	readonly #idBase: string;
	readonly #names = new SvelteMap<string, string>();
	#timer: ReturnType<typeof setTimeout> | undefined;
	#search: AbortController | undefined;
	#locate: AbortController | undefined;

	constructor(ctx: () => PickerContext, initial: Picks, idBase: string) {
		this.#ctx = ctx;
		this.#idBase = idBase;
		this.picks = [...initial];
		for (const option of [...ctx().known, ...ctx().recent]) this.#remember(option);
	}

	get typing(): boolean {
		return this.query.trim().length >= MIN_QUERY;
	}

	sections: Section[] = $derived.by(() => {
		const ctx = this.#ctx();
		const lists: { key: SectionKey; options: PlaceOption[] }[] = [];
		if (!this.typing) lists.push({ key: "recent", options: ctx.recent });
		else if (this.result) {
			for (const key of GROUPS) {
				const group = this.result[key];
				if (group.status === "ready") lists.push({ key, options: group.options });
			}
		}
		return lists
			.filter((l) => l.options.length > 0)
			.map(({ key, options }) => ({
				key,
				label: groupLabel(key),
				rows: options.map((option, i) => this.rowFor(option, `${this.#idBase}-${key}-${i}`))
			}));
	});

	/** The row for an option, with its block reason and whether it's picked. */
	rowFor(option: PlaceOption, id: string): Row {
		const ref = refOf(option);
		const reason = blockReason(this.picks, ref, this.#ctx().mode);
		return {
			id,
			option,
			ref,
			reason: reason ? this.reasonText(reason) : null,
			selected: this.picks.some((p) => refKey(p) === refKey(ref))
		};
	}

	rows: Row[] = $derived(this.sections.flatMap((s) => s.rows));
	active: Row | null = $derived(this.rows[this.activeIndex] ?? null);

	failed: GroupKey[] = $derived.by(() => {
		const result = this.result;
		if (!this.typing || !result) return [];
		return GROUPS.filter((key) => result[key].status === "error");
	});

	more: boolean = $derived.by(() => {
		const result = this.result;
		if (!this.typing || !result) return false;
		return GROUPS.some((key) => {
			const group = result[key];
			return group.status === "ready" && group.more;
		});
	});

	/** Why "Use my location" can't be used now, or null. */
	locationReason: string | null = $derived.by(() => {
		const reason = blockReason(this.picks, { kind: "point", lat: 0, lon: 0 }, this.#ctx().mode);
		return reason ? this.reasonText(reason) : null;
	});

	reasonText(reason: BlockReason): string {
		switch (reason) {
			case "other-kind-regions":
				return m.place_picker_reason_other_kind_regions();
			case "other-kind-monitors":
				return m.place_picker_reason_other_kind_monitors();
			case "single-only":
				return m.place_picker_reason_single_only();
			case "alone-picked": {
				const alone = this.picks[0];
				const name = alone && alone.kind !== "point" ? this.#names.get(refKey(alone)) : undefined;
				return name
					? m.place_picker_reason_alone_picked({ name })
					: m.place_picker_reason_alone_picked_unnamed();
			}
			case "at-cap": {
				const mode = this.#ctx().mode;
				const max = mode.kind === "multiple" ? mode.max : 1;
				return m.place_picker_reason_at_cap({ max: formatNumber(max) });
			}
		}
	}

	nameOf(ref: PlaceRef): string {
		if (ref.kind === "point") return m.place_picker_your_location();
		return this.#names.get(refKey(ref)) ?? m.place_picker_unnamed();
	}

	setQuery(query: string): void {
		this.query = query;
		this.activeIndex = -1;
		this.announcement = [];
		clearTimeout(this.#timer);
		this.#search?.abort();
		this.#search = undefined;
		if (!this.typing) {
			this.result = null;
			return;
		}
		this.#timer = setTimeout(() => this.#run(), DEBOUNCE_MS);
	}

	retry(): void {
		clearTimeout(this.#timer);
		this.#search?.abort();
		this.#run();
	}

	#run(): void {
		const controller = new AbortController();
		this.#search = controller;
		const ctx = this.#ctx();
		searchPlaces(
			this.query,
			{ directory: ctx.directory, entryType: ctx.entryType, activeOnly: ctx.activeOnly },
			controller.signal
		).then(
			(result) => {
				if (controller.signal.aborted) return;
				this.result = result;
				this.activeIndex = -1;
				this.announcement = this.#announce();
			},
			// Each group settles on its own; the search rejects only when aborted.
			() => {}
		);
	}

	#announce(): string[] {
		const count = this.rows.length;
		const failures = this.failed.map(errorText);
		if (count > 0) {
			return [m.place_picker_count({ count: formatNumber(count), countValue: count }), ...failures];
		}
		return failures.length === 0 ? [m.place_picker_no_matches()] : failures;
	}

	/** Moves the active row by `delta`, wrapping; from none, down starts at the first and up at the last. */
	move(delta: 1 | -1): void {
		const n = this.rows.length;
		if (n === 0) return;
		if (this.activeIndex < 0) this.activeIndex = delta === 1 ? 0 : n - 1;
		else this.activeIndex = (this.activeIndex + delta + n) % n;
	}

	/** Picks (or, in multiple mode, toggles) a row; a blocked row does nothing. */
	pick(row: Row): void {
		if (row.reason) return;
		const ctx = this.#ctx();
		this.#remember(row.option);
		if (ctx.mode.kind === "single") {
			ctx.ondone([row.ref]);
			return;
		}
		this.picks = toggle(this.picks, row.ref, ctx.mode);
	}

	remove(ref: PlaceRef): void {
		this.picks = this.picks.filter((p) => refKey(p) !== refKey(ref));
	}

	async useLocation(): Promise<void> {
		if (this.locationReason || this.geo.status === "locating") return;
		this.#locate?.abort();
		const controller = new AbortController();
		this.#locate = controller;
		const { signal } = controller;
		const ctx = this.#ctx();
		this.geo = { status: "locating" };
		let found: GeoResult;
		try {
			found = await ctx.locate(signal);
		} catch {
			// `locate` rejects only when aborted.
			return;
		}
		if (signal.aborted) return;
		if (!found.ok) {
			const off = found.reason === "denied" || found.reason === "unsupported";
			this.geo = {
				status: "message",
				text: off ? m.place_picker_location_off() : m.place_picker_location_failed()
			};
			return;
		}
		let keys: string[];
		try {
			keys = await ctx.pointKeys(found.lat, found.lon, signal);
		} catch {
			if (!signal.aborted) {
				this.geo = { status: "message", text: m.place_picker_location_check_failed() };
			}
			return;
		}
		if (signal.aborted) return;
		if (keys.length === 0) {
			this.geo = { status: "message", text: m.place_picker_location_outside() };
			return;
		}
		this.geo = { status: "idle" };
		ctx.ondone([{ kind: "point", lat: found.lat, lon: found.lon }]);
	}

	destroy(): void {
		clearTimeout(this.#timer);
		this.#search?.abort();
		this.#locate?.abort();
	}

	#remember(option: PlaceOption): void {
		this.#names.set(refKey(refOf(option)), option.name);
	}
}
