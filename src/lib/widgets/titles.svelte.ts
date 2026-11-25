import { untrack } from "svelte";
import { SvelteMap } from "svelte/reactivity";

/**
 * Generated widget titles, by widget id. A widget type's lazily loaded component works out its
 * title (it may need metadata) and sets it here; until then the type's label stands in. Not
 * saved: titles are generated text, worked out again on each load.
 */
const titles = new SvelteMap<string, string>();

export function setGeneratedTitle(widgetId: string, title: string): void {
	// Read untracked: this runs inside each widget's title effect, and two writers on one id (the
	// Get data preview's) would otherwise wake each other forever.
	if (untrack(() => titles.get(widgetId)) !== title) titles.set(widgetId, title);
}

export function generatedTitle(widgetId: string): string | undefined {
	return titles.get(widgetId);
}
