import type { Figure } from "$lib/data/metadata";
import { m } from "$lib/paraglide/messages.js";

/** What the day's figure is called: the server's label, else "Daily value". */
export function figureName(figure: Figure | null): string {
	return figure?.label ?? m.calendar_daily_value();
}
