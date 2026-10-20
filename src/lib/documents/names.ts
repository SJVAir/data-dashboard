import { m } from "$lib/paraglide/messages.js";
import type { Dashboard } from "./schema";

export type DashboardSummary = Pick<
	Dashboard,
	"id" | "name" | "copiedFrom" | "createdAt" | "updatedAt" | "deletedAt"
>;

/** Display names for dashboards; `null` names get numbered generated names. */
export function displayNames(
	dashboards: DashboardSummary[],
	starterId: string
): Map<string, string> {
	const result = new Map<string, string>();
	const untitled: DashboardSummary[] = [];
	const mine: DashboardSummary[] = [];

	for (const d of dashboards) {
		if (d.name !== null) result.set(d.id, d.name);
		else if (d.copiedFrom === starterId) mine.push(d);
		else untitled.push(d);
	}

	const assign = (
		group: DashboardSummary[],
		first: () => string,
		numbered: (number: number) => string
	) => {
		group.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
		group.forEach((d, i) => result.set(d.id, i === 0 ? first() : numbered(i + 1)));
	};
	assign(untitled, m.dashboard_untitled, (number) => m.dashboard_untitled_numbered({ number }));
	assign(mine, m.dashboard_my, (number) => m.dashboard_my_numbered({ number }));
	return result;
}
