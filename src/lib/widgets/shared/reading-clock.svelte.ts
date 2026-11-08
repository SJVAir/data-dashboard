import { STALE_MS, type CurrentReading } from "$lib/data/now/current";

type Ok = Extract<CurrentReading, { status: "ok" }>;

/**
 * The clock behind a "now" tile's reading: "Updated N min ago" and staleness change between polls,
 * so time ticks once a minute (and on each new reading). Call during component initialization.
 */
export class ReadingClock {
	now = $state(Date.now());
	readonly ok: Ok | undefined;
	/** An hour that ended too long ago, since the last poll, is "No recent data". */
	readonly stale: boolean;
	readonly minutes: number;

	constructor(reading: () => CurrentReading | undefined) {
		$effect(() => {
			const timer = setInterval(() => (this.now = Date.now()), 60_000);
			return () => clearInterval(timer);
		});
		// A new reading (each poll) is also a fresh look at the clock.
		$effect(() => {
			void reading();
			this.now = Date.now();
		});
		this.ok = $derived.by(() => {
			const r = reading();
			return r?.status === "ok" ? r : undefined;
		});
		this.stale = $derived(!!this.ok && this.now - this.ok.at > STALE_MS);
		this.minutes = $derived(
			this.ok ? Math.max(0, Math.floor((this.now - this.ok.at) / 60_000)) : 0
		);
	}
}
