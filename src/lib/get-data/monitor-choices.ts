import type { MonitorGroup } from "@sjvair/sdk";
import type { MonitorSummary, MonitorTypeInfo } from "$lib/data/metadata";
import { m } from "$lib/paraglide/messages.js";

/**
 * The Air quality section's monitor choices (spec decisions 7, 31, 32, 36): the monitor-type
 * checkboxes in their groups and the searched monitors' rows, each with why it's greyed out.
 * Labels and groups come only from the monitors meta. Kept free of components and the SDK's
 * runtime, so it can be unit-tested.
 */

/**
 * Why a type or a searched monitor is greyed out: no pollutant is chosen (None), or its type's
 * entry types (the monitors meta's) don't include the chosen pollutant. Either way it stays
 * ticked or listed, and isn't fetched.
 */
export type MonitorBlock = "no-pollutant" | "not-supplied";

/** The key of the group of types with no group (or one the meta doesn't list), shown last. */
export const OTHER_GROUP = "__other";

export type MonitorTypeChoice = { type: string; label: string; blocked?: MonitorBlock };
export type MonitorGroupChoice = { key: string; label: string; types: MonitorTypeChoice[] };

/**
 * Why a monitor of a type (`info`; undefined when the meta doesn't list it) is greyed out for
 * `entryType` (undefined: None), or undefined. A type the meta doesn't list isn't known not to
 * measure the pollutant, so it isn't greyed out for it.
 */
export function blockFor(
	info: MonitorTypeInfo | undefined,
	entryType: string | undefined
): MonitorBlock | undefined {
	if (entryType === undefined) return "no-pollutant";
	if (info && !info.entryTypes.includes(entryType)) return "not-supplied";
	return undefined;
}

/**
 * The type checkboxes in their groups: the meta's groups in `order` (any number, spec decision
 * 36), each with its types in the meta's order, then the types with no group (or a group the meta
 * doesn't list) last, in a group of their own. `offered` is which types to show (the catalog's
 * air-quality `monitor_types`, plus any ticked); without it, every type the meta lists. A type the
 * meta doesn't list is labelled by its id (never an invented label) and goes in the last group.
 * Empty groups are left out.
 */
export function monitorGroups(
	groups: MonitorGroup[] | null,
	types: MonitorTypeInfo[],
	entryType: string | undefined,
	offered?: string[]
): MonitorGroupChoice[] {
	const byType = new Map(types.map((t) => [t.type, t]));
	const wanted = offered ? new Set(offered) : null;
	// The meta's order first, then the offered types it doesn't list.
	const ordered = [
		...types.filter((t) => !wanted || wanted.has(t.type)).map((t) => t.type),
		...(offered ?? []).filter((id) => !byType.has(id))
	];
	const keys = new Set((groups ?? []).map((g) => g.key));
	const choice = (type: string): MonitorTypeChoice => {
		const info = byType.get(type);
		const blocked = blockFor(info, entryType);
		return { type, label: info?.label ?? type, ...(blocked && { blocked }) };
	};
	const groupOf = (type: string): string => {
		const group = byType.get(type)?.group;
		return group && keys.has(group) ? group : OTHER_GROUP;
	};
	const unique = [...new Set(ordered)];
	const out: MonitorGroupChoice[] = [...(groups ?? [])]
		.sort((a, b) => a.order - b.order)
		.map((g) => ({
			key: g.key,
			label: g.label,
			types: unique.filter((t) => groupOf(t) === g.key).map(choice)
		}));
	out.push({
		key: OTHER_GROUP,
		label: m.get_data_monitor_group_other(),
		types: unique.filter((t) => groupOf(t) === OTHER_GROUP).map(choice)
	});
	return out.filter((g) => g.types.length > 0);
}

/** A searched monitor's row: its name and its type's label (`null` when unknown). */
export type MonitorRow = {
	id: string;
	name: string;
	network: string | null;
	blocked?: MonitorBlock;
};

/**
 * The searched monitors' rows, in their order, named from the monitors list with their type's
 * label, greyed out as their type would be. A monitor no longer listed is named by its id.
 */
export function monitorRows(
	ids: string[],
	list: MonitorSummary[],
	types: MonitorTypeInfo[],
	entryType: string | undefined
): MonitorRow[] {
	const byId = new Map(list.map((mon) => [mon.id, mon]));
	const byType = new Map(types.map((t) => [t.type, t]));
	return ids.map((id) => {
		const monitor = byId.get(id);
		const info = monitor && byType.get(monitor.type);
		const blocked = blockFor(info, entryType);
		return {
			id,
			name: monitor?.name ?? id,
			network: info?.label ?? null,
			...(blocked && { blocked })
		};
	});
}
