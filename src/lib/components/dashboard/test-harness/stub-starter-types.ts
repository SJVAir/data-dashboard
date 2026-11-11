import { starterTemplate } from "$lib/starter/starter";
import { placeholderType } from "$lib/widgets/placeholder";
import { getWidgetType, registerWidgetType } from "$lib/widgets/registry";

/**
 * Gives the starter's widget types the placeholder's code (keeping their sizes and menus), so a
 * test of the dashboard around them loads no data. Call it after `initApp`, which registers the
 * real ones.
 */
export function stubStarterTypes(): void {
	for (const type of new Set(starterTemplate().body.widgets.map((w) => w.type))) {
		const real = getWidgetType(type);
		if (real) registerWidgetType({ ...real, load: placeholderType.load });
	}
}
