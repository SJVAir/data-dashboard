import { m } from "$lib/paraglide/messages.js";
import type { Dashboard } from "./schema";

export type DashboardSummary = Pick<
	Dashboard,
	"id" | "name" | "copiedFrom" | "createdAt" | "updatedAt" | "deletedAt"
>;

/** Display names for dashboards; `null` names get generated names, numbered when they repeat. */
export function displayNames(
	dashboards: DashboardSummary[],
	starterId: string
): Map<string, string> {
	const byId = new Map(dashboards.map((d) => [d.id, d]));
	const result = new Map<string, string>();
	const untitled: DashboardSummary[] = [];
	const mine: DashboardSummary[] = [];
	// Unnamed copies of another listed dashboard, grouped by that source.
	const copies = new Map<string, DashboardSummary[]>();

	/** Whether following `copiedFrom` through unnamed dashboards ends without a loop. */
	const resolvable = (d: DashboardSummary): boolean => {
		const seen = new Set<string>([d.id]);
		let source = d.copiedFrom;
		while (source !== undefined) {
			const next = byId.get(source);
			if (!next || next.name !== null) return true;
			if (seen.has(next.id)) return false;
			seen.add(next.id);
			source = next.copiedFrom;
		}
		return true;
	};

	for (const d of dashboards) {
		if (d.name !== null) result.set(d.id, d.name);
		else if (d.copiedFrom !== undefined && byId.has(d.copiedFrom) && resolvable(d)) {
			copies.set(d.copiedFrom, [...(copies.get(d.copiedFrom) ?? []), d]);
		} else if (d.copiedFrom === starterId) mine.push(d);
		else untitled.push(d);
	}

	const byCreation = (group: DashboardSummary[]) =>
		group.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
	const assign = (
		group: DashboardSummary[],
		first: () => string,
		numbered: (number: number) => string
	) => {
		byCreation(group).forEach((d, i) => result.set(d.id, i === 0 ? first() : numbered(i + 1)));
	};
	assign(untitled, m.dashboard_untitled, (number) => m.dashboard_untitled_numbered({ number }));
	assign(mine, m.dashboard_my, (number) => m.dashboard_my_numbered({ number }));

	// A copy's name needs its source's, which may itself be a copy: name sources first.
	const nameCopiesOf = (sourceId: string) => {
		const group = copies.get(sourceId);
		if (!group) return;
		copies.delete(sourceId);
		const name = result.get(sourceId)!;
		assign(
			group,
			() => m.dashboard_copy_of({ name }),
			(number) => m.dashboard_copy_of_numbered({ name, number })
		);
	};
	const ensure = (id: string) => {
		if (result.has(id)) return;
		const source = byId.get(id)!.copiedFrom!;
		ensure(source);
		nameCopiesOf(source);
	};
	for (const sourceId of [...copies.keys()]) {
		ensure(sourceId);
		nameCopiesOf(sourceId);
	}
	return result;
}
