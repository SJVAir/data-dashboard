import { getMonitorsList, getRegionsList, getRegionsMeta } from "@sjvair/sdk";
import type { RegionResolver } from "$lib/data/adapters/registry";
import type { MetadataSource } from "$lib/data/metadata";
import type { LocationTypeInfo, MonitorOption, RegionOption, RegionTypeInfo } from "./types";

export interface PlaceDirectory {
	/** Browsable types with count > 0, server order. `plural` is the metadata `label_plural`. */
	regionTypes(signal?: AbortSignal): Promise<RegionTypeInfo[]>;
	/** The label of every region type in the metadata (browsable or not), by type. */
	regionTypeLabels(signal?: AbortSignal): Promise<Map<string, string>>;
	locationTypes(signal?: AbortSignal): Promise<LocationTypeInfo[]>;
	/** Monitors that can supply `entryType` (by type), active first then by name; `activeOnly` drops the rest. */
	monitors(
		entryType: string,
		opts: { activeOnly: boolean },
		signal?: AbortSignal
	): Promise<MonitorOption[]>;
	/** `monitors`, narrowed to those inside one region (the server's `monitors/?region=`). */
	monitorsIn(
		entryType: string,
		parent: { type: string; code: string },
		opts: { activeOnly: boolean },
		signal?: AbortSignal
	): Promise<MonitorOption[]>;
	/** A type's current (non-retired) regions, optionally within one parent region. */
	regionsIn(
		type: string,
		parent: { type: string; code: string } | null,
		signal?: AbortSignal
	): Promise<RegionOption[]>;
}

function aborted(signal?: AbortSignal) {
	if (signal?.aborted) throw new DOMException("The operation was aborted.", "AbortError");
}

/** Share one fetch per key and forget failures; the shared fetch carries no caller's signal. */
function memoByKey<T>(fetch: (key: string) => Promise<T>) {
	const cache = new Map<string, Promise<T>>();
	return async (key: string, signal?: AbortSignal): Promise<T> => {
		aborted(signal);
		let p = cache.get(key);
		if (!p) {
			const created = fetch(key);
			p = created;
			cache.set(key, created);
			created.catch(() => {
				if (cache.get(key) === created) cache.delete(key);
			});
		}
		const result = await p;
		aborted(signal);
		return result;
	};
}

export function createPlaceDirectory(ctx: {
	metadata: MetadataSource;
	regions: RegionResolver;
}): PlaceDirectory {
	const regionsMeta = memoByKey(() => getRegionsMeta());

	const regionsIn = memoByKey(async (key) => {
		const [type, parentType, parentCode] = JSON.parse(key) as [string, string?, string?];
		let within: string | undefined;
		if (parentType !== undefined && parentCode !== undefined) {
			const parent = await ctx.regions.resolve(parentType, parentCode);
			if (!parent || parent === "unsupported") return [];
			within = parent.id;
		}
		const meta = await regionsMeta("meta");
		const typeLabel = meta.types[type]?.label ?? type;
		const rows = await getRegionsList({ type: type as never, ...(within ? { within } : {}) });
		return (
			rows
				// A retired region's code still resolves, but it isn't a place to pick.
				.filter((r) => !r.retired && r.external_id !== null)
				.map((r): RegionOption => ({
					kind: "region",
					type,
					code: r.external_id as string,
					name: r.name,
					typeLabel,
					// The regions list doesn't carry the containing county.
					county: null
				}))
		);
	});

	const monitorIdsIn = memoByKey(async (key) => {
		const [type, code] = JSON.parse(key) as [string, string];
		const parent = await ctx.regions.resolve(type, code);
		if (!parent || parent === "unsupported") return new Set<string>();
		return new Set((await getMonitorsList({ region: parent.id })).map((m) => m.id));
	});

	async function monitors(entryType: string, opts: { activeOnly: boolean }, signal?: AbortSignal) {
		const [types, all] = await Promise.all([
			ctx.metadata.monitorTypes(signal),
			ctx.metadata.monitors(signal)
		]);
		const byType = new Map(types.map((t) => [t.type, t]));
		return all
			.filter((m) => byType.get(m.type)?.entryTypes.includes(entryType))
			.filter((m) => m.active || !opts.activeOnly)
			.map((m): MonitorOption => ({
				kind: "monitor",
				id: m.id,
				name: m.name,
				network: byType.get(m.type)!.label,
				county: m.county,
				active: m.active
			}))
			.sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name));
	}

	return {
		async regionTypes(signal) {
			const meta = await regionsMeta("meta", signal);
			return Object.values(meta.types)
				.filter((t) => t.browsable && t.count > 0)
				.map((t) => ({
					type: t.type,
					label: t.label,
					plural: t.label_plural,
					count: t.count,
					parents: [...t.parents]
				}));
		},
		async regionTypeLabels(signal) {
			const meta = await regionsMeta("meta", signal);
			return new Map(Object.values(meta.types).map((t) => [t.type, t.label]));
		},
		async locationTypes(signal) {
			const meta = await regionsMeta("meta", signal);
			return Object.values(meta.location_types).map((t) => ({
				type: t.type,
				label: t.label,
				source: t.source
			}));
		},
		monitors,
		async monitorsIn(entryType, parent, opts, signal) {
			const [ids, list] = await Promise.all([
				monitorIdsIn(JSON.stringify([parent.type, parent.code]), signal),
				monitors(entryType, opts, signal)
			]);
			return list.filter((m) => ids.has(m.id));
		},
		regionsIn(type, parent, signal) {
			const key = JSON.stringify(parent ? [type, parent.type, parent.code] : [type]);
			return regionsIn(key, signal);
		}
	};
}
