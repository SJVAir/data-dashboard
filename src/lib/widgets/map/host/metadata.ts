import type { MetadataProvider } from "@sjvair/map-sdk/data";
import type { MetadataSource } from "$lib/data/metadata";

const UNAVAILABLE = "unavailable" as const;

/** The value, `"unavailable"` for none or a failed read; only the caller's abort rejects. */
async function guarded<T>(
	signal: AbortSignal | undefined,
	read: () => Promise<T | null | undefined>
): Promise<T | "unavailable"> {
	try {
		return (await read()) || UNAVAILABLE;
	} catch (error) {
		if (signal?.aborted) throw error;
		return UNAVAILABLE;
	}
}

const providers = new WeakMap<MetadataSource, MetadataProvider>();

/**
 * map-sdk's metadata, read from the dashboard's own `MetadataSource` so map-sdk fetches nothing.
 * One provider per source (so every map on the page shares it). Not implemented yet:
 * `locationTypeLabel` (`@sjvair/map-sdk` `0.1.0-beta.12`).
 */
export function mapMetadata(source: MetadataSource): MetadataProvider {
	let provider = providers.get(source);
	if (provider) return provider;
	/** The catalog's entry for a dataset's entry type; undefined when the catalog is unavailable. */
	const catalogEntryType = async (dataset: string, entryType: string, signal?: AbortSignal) => {
		const catalog = await source.catalog(signal);
		if (catalog === "unavailable") return undefined;
		return catalog.find((d) => d.id === dataset)?.entryTypes.find((e) => e.id === entryType);
	};
	provider = {
		// The server's raw scale; map-sdk's `Scale` is the SDK's type for the same shape.
		scale: (ref, signal) =>
			guarded(
				signal,
				async () =>
					(await source.serverScale(ref.dataset, ref.entryType, signal)) as Awaited<
						ReturnType<MetadataProvider["scale"]>
					> | null
			),
		entryType: (ref, signal) =>
			guarded(signal, async () => {
				const type = await catalogEntryType(ref.dataset, ref.entryType, signal);
				return type && { label: type.label, units: type.units, precision: type.precision };
			}),
		monitorTypeLabel: (type, signal) =>
			guarded(
				signal,
				async () => (await source.monitorTypes(signal)).find((t) => t.type === type)?.label
			),
		monitorTypeInterval: (type, signal) =>
			guarded(signal, () => source.monitorTypeInterval(type, signal)),
		attribution: (dataset, signal) =>
			guarded(signal, async () => {
				const catalog = await source.catalog(signal);
				return catalog === "unavailable"
					? undefined
					: catalog.find((d) => d.id === dataset)?.source;
			})
	};
	providers.set(source, provider);
	return provider;
}
