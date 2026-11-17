import type { MetadataSource } from "$lib/data/metadata";
import { getResolvers } from "$lib/data";
import { directoryFor } from "$lib/places/host";
import type { RegionTypeInfo } from "$lib/places/types";
import { report } from "$lib/safety/report";
import { fillRegionType } from "./fill";

/**
 * The region fill: the saved type, drawn only while the place directory lists it (an unknown type
 * draws nothing, offers no row and writes nothing; it applies again if the type returns). Its
 * effect runs in its own root; call `destroy()`.
 */
export class MapFillTypes {
	readonly #saved: () => string | undefined;
	/** The region types a Map can fill; undefined until loaded (or when they can't be). */
	types = $state.raw<RegionTypeInfo[] | undefined>();
	/** The region types couldn't be loaded: the fill's note offers Retry, which asks again. */
	failed = $state(false);
	/** Bumped by Retry, to look the region types up again. */
	#tries = $state(0);
	readonly #stop: () => void;

	constructor(saved: () => string | undefined, metadata: MetadataSource) {
		this.#saved = saved;
		this.#stop = $effect.root(() => {
			$effect(() => {
				void this.#tries;
				if (!this.#saved() || this.types) return;
				const controller = new AbortController();
				this.failed = false;
				directoryFor(metadata, getResolvers().regions)
					.regionTypes(controller.signal)
					.then(
						(types) => {
							if (!controller.signal.aborted) this.types = types;
						},
						(error: unknown) => {
							if (controller.signal.aborted) return;
							this.failed = true;
							report(error);
						}
					);
				return () => controller.abort();
			});
		});
	}

	/** The region type filled, when the metadata lists it; null for no fill. */
	readonly type = $derived.by(() => fillRegionType(this.#saved(), this.types));
	readonly info = $derived(this.type ? this.types?.find((t) => t.type === this.type) : undefined);

	/** Looks the region types up again (after they failed). */
	retry(): void {
		this.#tries++;
	}

	destroy(): void {
		this.#stop();
	}
}
