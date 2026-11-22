import { m } from "$lib/paraglide/messages.js";
import type { ChartEmpty } from "./input";

/** What a Chart or Table's idle state says for `empty` (`chartInput`); undefined: the general one. */
export function idleText(empty: ChartEmpty | undefined): string | undefined {
	if (empty === "add-layers") return m.widget_empty_add_layers();
	if (empty === "add-where-or-monitors") return m.widget_empty_add_where_or_monitors();
	return undefined;
}
