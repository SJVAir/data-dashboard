import { tick } from "svelte";
import { toast } from "svelte-sonner";
import type { Level } from "$lib/data/metadata";
import { m } from "$lib/paraglide/messages.js";
import type { Platform, SpaceId } from "$lib/platform/types";
import { decide } from "./firing";
import { setMark, thresholdMarks } from "./marks.svelte";
import { notifyEnabled } from "./notify-pref";
import { readTold, writeTold } from "./told";

/** What a crossing's toast and notification say about a widget, read when it fires. */
export type CrossingText = { title: string; pollutant: string; place: string };

function atOrAbove(level: Level, threshold: Level, levels: Level[]): boolean {
	const index = levels.findIndex((l) => l.key === level.key);
	const limit = levels.findIndex((l) => l.key === threshold.key);
	return index !== -1 && limit !== -1 && index >= limit;
}

/**
 * One dashboard's threshold watching: the marks for each watched widget's current reading, and,
 * for each new reading, whether to tell the person (decided under a lock across this browser's
 * tabs, with "last told" kept as a preference so reloads and other tabs don't repeat it).
 */
export class ThresholdWatch {
	/** The polite announcement of the latest crossing. */
	announcement = $state("");
	/** The latest reading time handled for each widget (this tab only). Not state. */
	// eslint-disable-next-line svelte/prefer-svelte-reactivity
	readonly #lastAt = new Map<string, number>();

	constructor(
		private readonly opts: {
			platform: Platform;
			space: () => SpaceId;
			docId: () => string;
			/** The ids of the widgets still watched (the told map is pruned to them). */
			watching: () => string[];
		}
	) {}

	/**
	 * Shows or clears `id`'s mark for its current reading: shown whenever the level is at or
	 * above the threshold (keeping its pulse count), cleared below it or with no threshold.
	 * Readings that aren't ok, or have no level, leave it as it is.
	 */
	mark(
		id: string,
		reading: { level: Level | undefined; at: number } | undefined,
		threshold: Level | null,
		levels: Level[]
	): void {
		if (!threshold) {
			setMark(id, null);
			return;
		}
		if (!reading?.level) return;
		if (atOrAbove(reading.level, threshold, levels)) {
			setMark(id, { level: reading.level, at: reading.at, pulse: thresholdMarks[id]?.pulse ?? 0 });
		} else {
			setMark(id, null);
		}
	}

	/**
	 * Handles a reading of `id` newer than any handled before here: decides under the lock
	 * whether it fires, stores "last told", and if it fires (and `still()` says the widget is
	 * still watched) toasts, announces, pulses the mark and notifies when the dashboard's switch
	 * is on and permission is granted.
	 */
	async process(
		id: string,
		reading: { level: Level; at: number },
		threshold: Level,
		levels: Level[],
		text: () => CrossingText,
		still: () => boolean
	): Promise<void> {
		const last = this.#lastAt.get(id);
		if (last !== undefined && reading.at <= last) return;
		this.#lastAt.set(id, reading.at);

		const { platform: p } = this.opts;
		const space = this.opts.space();
		const docId = this.opts.docId();
		try {
			await p.locks.run(`thresholds:${docId}`, async () => {
				const told = await readTold(p, space, docId);
				const prev = told[id];
				// Another tab (or this browser before a reload) already handled this reading.
				if (prev && reading.at <= prev.at) return;
				const decision = decide(
					prev,
					{ level: reading.level.key, at: reading.at },
					threshold,
					levels
				);
				const live = still();
				if (live) told[id] = decision.told;
				await writeTold(p, space, docId, told, this.opts.watching());
				if (!decision.fire || !live) return;
				await this.#fire(id, docId, space, reading, text());
			});
		} catch (error) {
			p.errors.report(error, { operation: "threshold-watch" });
		}
	}

	async #fire(
		id: string,
		docId: string,
		space: SpaceId,
		{ level, at }: { level: Level; at: number },
		{ title, pollutant, place }: CrossingText
	): Promise<void> {
		const body = m.threshold_reached({ pollutant, place, level: level.label });
		toast(body);
		// Cleared first, so the same words announce again.
		this.announcement = "";
		await tick();
		this.announcement = body;
		setMark(id, { level, at, pulse: (thresholdMarks[id]?.pulse ?? 0) + 1 });
		const p = this.opts.platform;
		if ((await notifyEnabled(p, space, docId)) && p.notifications.permission() === "granted") {
			p.notifications.show({ title, body, tag: `${docId}:${id}` });
		}
	}
}
