import { TZDate } from "@date-fns/tz";
import { TIME_ZONE } from "$lib/format";
import type { ActivitySource } from "$lib/platform/types";
import type { Resolution } from "../schema";
import type { QueryClient, QueryEntryInfo } from "./client";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
/** Raw data arrives every few minutes. */
const RAW_POLL_MS = 3 * MINUTE;
/** Summaries poll at this minute past each Pacific hour, after the server's :50 summary task. */
const SUMMARY_POLL_MINUTE = 55;
const BACKOFF_BASE_MS = 30_000;
const BACKOFF_CAP_MS = 30 * MINUTE;

/** How long after `now` (a fetch settling) the next poll of an entry at `resolution` is due. */
export function nextPollDelay(resolution: Resolution, now: Date): number {
	if (resolution === "raw") return RAW_POLL_MS;
	const local = new TZDate(now.getTime(), TIME_ZONE);
	const intoHour =
		local.getMinutes() * MINUTE + local.getSeconds() * 1_000 + local.getMilliseconds();
	const delay = (SUMMARY_POLL_MINUTE * MINUTE - intoHour + HOUR) % HOUR;
	return delay === 0 ? HOUR : delay;
}

/** The wait before retrying after `failures` consecutive failed fetches (1 or more). */
export function backoffDelay(failures: number): number {
	return Math.min(BACKOFF_BASE_MS * 2 ** (failures - 1), BACKOFF_CAP_MS);
}

export type PollerOptions = {
	now?: () => Date;
	setTimeout?: (fn: () => void, ms: number) => unknown;
	clearTimeout?: (handle: unknown) => void;
};

type Schedule = {
	/** Epoch ms the next poll is due; `Infinity` while a fetch is in flight. */
	due: number;
	failures: number;
	inFlight: boolean;
};

const pollable = (e: QueryEntryInfo) => e.subscribers > 0 && e.polling && e.includesNow;

/**
 * Refetches the client's entries that include now and that some subscriber polls, each on its
 * resolution's cadence, backing off after failures. No timer runs while `activity` is hidden;
 * on becoming visible, each entry whose poll fell due meanwhile is refetched once.
 */
export function startPoller(
	client: QueryClient,
	activity: ActivitySource,
	opts: PollerOptions = {}
): { stop(): void } {
	const now = opts.now ?? (() => new Date());
	const setTimer = opts.setTimeout ?? ((fn, ms) => setTimeout(fn, ms));
	const clearTimer = opts.clearTimeout ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
	const schedules = new Map<string, Schedule>();
	let timer: unknown;
	let timerDue = Infinity;
	let stopped = false;

	/** A fetch settled (or an entry became pollable at rest): set when it is next due. */
	function settle(s: Schedule, e: QueryEntryInfo, at: number) {
		s.inFlight = false;
		if (e.failed) {
			s.failures++;
			s.due = at + backoffDelay(s.failures);
		} else {
			s.failures = 0;
			s.due = at + nextPollDelay(e.resolution, new Date(at));
		}
	}

	function reconcile() {
		if (stopped) return;
		const at = now().getTime();
		const seen = new Set<string>();
		for (const e of client.entries()) {
			if (!pollable(e)) continue;
			seen.add(e.key);
			let s = schedules.get(e.key);
			if (!s) {
				s = { due: Infinity, failures: 0, inFlight: e.inFlight };
				schedules.set(e.key, s);
				// Pollable at rest (a cached entry subscribed again, or polling turned back on):
				// due on the cadence of its last fetch, so data hours old is refetched at once.
				if (!e.inFlight) settle(s, e, e.failed ? at : (e.fetchedAt ?? at));
			} else if (e.inFlight) {
				s.inFlight = true;
				s.due = Infinity;
			} else if (s.inFlight) {
				settle(s, e, at);
			}
		}
		for (const key of schedules.keys()) if (!seen.has(key)) schedules.delete(key);
		arm();
	}

	function disarm() {
		if (timer !== undefined) clearTimer(timer);
		timer = undefined;
		timerDue = Infinity;
	}

	/** Keep one timer, for the earliest due entry, and only while visible. */
	function arm() {
		const next = Math.min(Infinity, ...[...schedules.values()].map((s) => s.due));
		if (stopped || !activity.visible() || next === Infinity) return disarm();
		if (timer !== undefined && timerDue === next) return;
		disarm();
		timerDue = next;
		timer = setTimer(
			() => {
				timer = undefined;
				timerDue = Infinity;
				poll();
			},
			Math.max(0, next - now().getTime())
		);
	}

	/** Refetch every entry that is due, once each; their schedules resume as each settles. */
	function poll() {
		if (stopped || !activity.visible()) return;
		const at = now().getTime();
		const due = [...schedules].filter(([, s]) => !s.inFlight && s.due <= at);
		for (const [key, s] of due) {
			s.inFlight = true;
			s.due = Infinity;
			client.refetch(key);
		}
		reconcile();
	}

	const stopChanges = client.onChange(reconcile);
	const stopActivity = activity.onChange((visible) => (visible ? poll() : disarm()));
	reconcile();

	return {
		stop() {
			stopped = true;
			stopChanges();
			stopActivity();
			disarm();
		}
	};
}
